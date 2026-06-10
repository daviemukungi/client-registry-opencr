#!/usr/bin/env python3
"""Import PMRS Cambodia CSV data into OpenCR as FHIR Patient resources."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import requests
import urllib3

from lib.khmer_name_parser import (
    normalize_dob,
    normalize_gender,
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

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


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
  python scripts/import_pmrs_csv.py 5 --dry-run
  python scripts/import_pmrs_csv.py 500
  python scripts/import_pmrs_csv.py 500 demo-data/pmrs_female_data.csv
  python scripts/import_pmrs_csv.py --count 250 --offset 500
  python scripts/import_pmrs_csv.py -n 100 --batch-size 25
""",
    )
    parser.add_argument("count", nargs="?", type=positive_int, help="number of records to import")
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
    parser.add_argument("--host", default="localhost", help="OpenCR host")
    parser.add_argument("--port", type=int, default=3002, help="OpenCR port")
    parser.add_argument("--delay-ms", type=int, default=100, help="delay between batch uploads in ms")
    return parser


def resolve_args(argv: list[str]) -> argparse.Namespace:
    parser = build_parser()
    args = parser.parse_args(argv)

    count = args.count_flag or args.limit or args.count
    if count is None:
        parser.error("record count is required. Pass a number or use --count / -n")

    args.count = count
    args.csv_file = str(Path(args.csv_file).expanduser().resolve())
    return args


def row_to_patient(row: dict) -> dict:
    pid = normalize_khmer_string(row.get("pid", ""))
    names = parse_khmer_name(row.get("name", ""))
    gender = normalize_gender(row.get("sex", ""))
    birth_date = normalize_dob(row.get("dob", ""))
    phone = normalize_phone(row.get("phone", ""))

    resource: dict = {
        "resourceType": "Patient",
        "active": True,
        "meta": {"tag": [PMRS_TAG]},
        "identifier": [
            {"system": "http://clientregistry.org/openmrs", "value": pid},
            {"system": "http://pmrs.gov.kh/patientid", "value": pid},
        ],
        "gender": gender,
    }

    if names:
        resource["name"] = names
    if birth_date:
        resource["birthDate"] = birth_date
    if phone:
        resource["telecom"] = [{"system": "phone", "value": phone}]

    return resource


def read_patients_from_csv(csv_file: str, offset: int, limit: int) -> list[dict]:
    patients: list[dict] = []
    skipped = 0

    with open(csv_file, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if skipped < offset:
                skipped += 1
                continue
            if len(patients) >= limit:
                break
            patients.append(row_to_patient(row))

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


def post_bundle(bundle: dict, host: str, port: int, session: requests.Session) -> tuple[int, str]:
    url = f"https://{host}:{port}/fhir"
    try:
        response = session.post(url, json=bundle, timeout=120)
        return response.status_code, response.text
    except requests.RequestException as exc:
        return 0, str(exc)


def upload_patients(patients: list[dict], args: argparse.Namespace) -> tuple[int, int]:
    session = requests.Session()
    session.cert = cert_paths()
    session.verify = False

    batch_size = max(1, args.batch_size)
    uploaded = 0
    failed = 0

    for start in range(0, len(patients), batch_size):
        batch = patients[start : start + batch_size]
        bundle = {
            "resourceType": "Bundle",
            "type": "batch",
            "entry": [{"resource": patient} for patient in batch],
        }

        status_code, body = post_bundle(bundle, args.host, args.port, session)
        if is_batch_success(status_code, body):
            uploaded += len(batch)
            print(f"Uploaded {uploaded}/{len(patients)} (HTTP {status_code})")
        else:
            failed += len(batch)
            print(f"Batch failed (HTTP {status_code or 'n/a'}): {body or 'unknown error'}", file=sys.stderr)

        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000)

    return uploaded, failed


def main(argv: list[str] | None = None) -> int:
    args = resolve_args(argv or sys.argv[1:])

    csv_path = Path(args.csv_file)
    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}", file=sys.stderr)
        return 1

    print(f"Reading {csv_path}")
    print(f"offset={args.offset} count={args.count} dry_run={args.dry_run}")

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

    uploaded, failed = upload_patients(patients, args)
    print(f"Done. uploaded={uploaded} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
