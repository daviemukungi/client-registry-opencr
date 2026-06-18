#!/usr/bin/env python3
"""Import PMRS Cambodia CSV data into OpenCR as FHIR Patient resources."""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import ssl
import sys
from pathlib import Path

import aiohttp

from lib.khmer_name_parser import (
    normalize_dob,
    normalize_khmer_string,
    normalize_phone,
    parse_khmer_name,
)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "demo-data" / "pmrs_female_data.csv"
PMRS_TAG = {
    "system": "http://openclientregistry.org/fhir/tag/csv",
    "code": "pmrs-cambodia-female-import",
    "display": "PMRS Cambodia Female CSV",
}


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import PMRS Cambodia CSV data into OpenCR as FHIR Patient resources.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/import_pmrs_csv.py --dry-run
  python scripts/import_pmrs_csv.py
  python scripts/import_pmrs_csv.py demo-data/pmrs_female_data.csv
  python scripts/import_pmrs_csv.py --count 250 --offset 500
  python scripts/import_pmrs_csv.py -n 100 --batch-size 25 --concurrency 8
""",
    )
    parser.add_argument("count", nargs="?", type=positive_int, help="number of records to import (default: all)")
    parser.add_argument(
        "csv_file",
        nargs="?",
        default=str(DEFAULT_CSV),
        help="path to CSV (default: demo-data/pmrs_female_data.csv)",
    )
    parser.add_argument("-n", "--count", dest="count_flag", type=positive_int, help="number of records to import")
    parser.add_argument("--limit", type=positive_int, help="alias for --count")
    parser.add_argument("--offset", type=positive_int, default=0, help="skip first N data rows")
    parser.add_argument("--dry-run", action="store_true", help="parse and print sample patients only")
    parser.add_argument("--batch-size", type=positive_int, default=10, help="patients per FHIR bundle POST")
    parser.add_argument("--concurrency", type=positive_int, default=2, help="max concurrent batch uploads")
    parser.add_argument("--retries", type=int, default=5, help="max retries per batch on connection error")
    parser.add_argument("--host", default="localhost", help="OpenCR host")
    parser.add_argument("--port", type=int, default=8081, help="OpenCR port")
    parser.add_argument("--delay-ms", type=int, default=500, help="stagger delay between batch launches in ms")
    return parser


def resolve_args(argv: list[str]) -> argparse.Namespace:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.count = args.count_flag or args.limit or args.count
    args.csv_file = str(Path(args.csv_file).expanduser().resolve())
    return args


def row_to_patient(row: dict) -> dict:
    pid = normalize_khmer_string(row.get("pid", ""))
    names = parse_khmer_name(row.get("name", ""))
    birth_date = normalize_dob(row.get("dob", ""))
    phone = normalize_phone(row.get("phone", ""))
    village = normalize_khmer_string(row.get("village", ""))

    resource: dict = {
        "resourceType": "Patient",
        "active": True,
        "meta": {"tag": [PMRS_TAG]},
        "identifier": [
            {"system": "http://clientregistry.org/openmrs", "value": pid},
            {"system": "http://pmrs.gov.kh/patientid", "value": pid},
        ],
    }

    if names:
        resource["name"] = names
    if birth_date:
        resource["birthDate"] = birth_date
    if phone:
        resource["telecom"] = [{"system": "phone", "value": phone}]
    if village:
        resource["address"] = [{"use": "home", "line": [village]}]

    return resource


def read_patients_from_csv(csv_file: str, offset: int, limit: int | None) -> list[dict]:
    patients: list[dict] = []
    skipped = 0

    with open(csv_file, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if skipped < offset:
                skipped += 1
                continue
            if limit is not None and len(patients) >= limit:
                break
            patient = row_to_patient(row)
            if patient.get("telecom"):
                patients.append(patient)

    return patients


def cert_paths() -> tuple[str, str]:
    cert_dir = ROOT / "server" / "clientCertificates"
    return (
        str(cert_dir / "openmrs_cert.pem"),
        str(cert_dir / "openmrs_key.pem"),
    )


def is_batch_success(status_code: int, body: str) -> bool:
    if 200 <= status_code < 300:
        return True
    if not body:
        return False
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return False

    entries = payload.get("entry") or []
    return any(
        str((entry.get("response") or {}).get("status", "")).startswith("201")
        for entry in entries
    )


def build_ssl_context() -> ssl.SSLContext:
    cert, key = cert_paths()
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.load_cert_chain(cert, key)
    return ctx


async def _post_with_retry(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    url: str,
    ssl_ctx: ssl.SSLContext,
    bundle: dict,
    retries: int,
) -> tuple[int, str]:
    status, body = 0, ""
    for attempt in range(1, retries + 2):
        async with sem:
            try:
                async with session.post(url, json=bundle, ssl=ssl_ctx, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                    status, body = resp.status, await resp.text()
            except Exception as exc:
                status, body = 0, str(exc)
        if status != 0:
            break
        if attempt <= retries:
            wait = 2 ** (attempt - 1)
            print(f"Retry {attempt}/{retries} in {wait}s: {body}", file=sys.stderr)
            await asyncio.sleep(wait)
    return status, body


async def upload_patients(patients: list[dict], args: argparse.Namespace) -> tuple[int, int]:
    url = f"https://{args.host}:{args.port}/fhir"
    ssl_ctx = build_ssl_context()
    batch_size = max(1, args.batch_size)
    batches = [patients[i : i + batch_size] for i in range(0, len(patients), batch_size)]
    sem = asyncio.Semaphore(args.concurrency)
    uploaded = 0
    failed = 0

    async def send_batch(batch: list[dict]) -> None:
        nonlocal uploaded, failed
        bundle = {"resourceType": "Bundle", "type": "batch", "entry": [{"resource": p} for p in batch]}
        status, body = await _post_with_retry(session, sem, url, ssl_ctx, bundle, args.retries)
        if is_batch_success(status, body):
            uploaded += len(batch)
            print(f"Uploaded {uploaded}/{len(patients)} (HTTP {status})")
        else:
            failed += len(batch)
            print(f"Batch failed (HTTP {status or 'n/a'}): {body or 'unknown error'}", file=sys.stderr)

    connector = aiohttp.TCPConnector(ssl=ssl_ctx, force_close=True)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for batch in batches:
            tasks.append(asyncio.create_task(send_batch(batch)))
            if args.delay_ms > 0:
                await asyncio.sleep(args.delay_ms / 1000)
        await asyncio.gather(*tasks)

    return uploaded, failed


async def async_main(argv: list[str] | None = None) -> int:
    args = resolve_args(argv or sys.argv[1:])

    csv_path = Path(args.csv_file)
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}", file=sys.stderr)
        return 1

    limit_label = args.count if args.count is not None else "all"
    print(f"Reading {csv_path}")
    print(f"offset={args.offset} count={limit_label} dry_run={args.dry_run}")

    patients = read_patients_from_csv(str(csv_path), args.offset, args.count)
    print(f"Parsed {len(patients)} patients")

    if not patients:
        print("No patients to import.")
        return 0

    if args.dry_run:
        sample_count = min(3, len(patients))
        print(f"\n--- Dry run: first {sample_count} FHIR Patient resources ---\n")
        for index, patient in enumerate(patients[:sample_count], start=1):
            print(f"#{index}")
            print(json.dumps(patient, ensure_ascii=False, indent=2))
            print()
        return 0

    uploaded, failed = await upload_patients(patients, args)
    print(f"Done. uploaded={uploaded} failed={failed}")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(async_main(argv))


if __name__ == "__main__":
    raise SystemExit(main())
