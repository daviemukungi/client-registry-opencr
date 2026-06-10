# OpenCR Import Scripts

Python import scripts for OpenCR.

## Setup

```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Ensure OpenCR is running with TLS. Docker CICD setup uses port **3002** (`https://localhost:3002`).

## PMRS Cambodia CSV import

Data file (gitignored): `demo-data/pmrs_female_data.csv`

**Record count is required** — pass it as the first argument or with `--count` / `-n`:

```bash
# Dry run — parse 5 rows, print FHIR JSON (no upload)
python scripts/import_pmrs_csv.py 5 --dry-run

# Import 100 records (default CSV: demo-data/pmrs_female_data.csv)
python scripts/import_pmrs_csv.py 100

# Import 500 records with explicit CSV path
python scripts/import_pmrs_csv.py 500 demo-data/pmrs_female_data.csv

# Next batch using offset
python scripts/import_pmrs_csv.py 500 --offset 500

# Alternative count flags
python scripts/import_pmrs_csv.py --count 250
python scripts/import_pmrs_csv.py -n 100 --batch-size 25
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `<count>` | required | Number of records to import |
| `--count`, `-n` | — | Record count (alternative to positional) |
| `--limit` | — | Alias for `--count` |
| `--offset` | 0 | Skip first N data rows |
| `--dry-run` | false | Parse only, no HTTP upload |
| `--batch-size` | 10 | Patients per FHIR bundle POST |
| `--host` | localhost | OpenCR hostname |
| `--port` | 3002 | OpenCR port |
| `--delay-ms` | 100 | Delay between batch uploads |

### CSV → FHIR mapping

- `pid` → identifiers (`openmrs` + `pmrs.gov.kh/patientid`)
- `name` → Khmer `family` + `given` (first token = family); aliases in `()` / `[]` → `use: old`
- `sex` → `gender`
- `dob` → `birthDate` (omits `*-01-01` placeholders)
- `phone` → `telecom` (omits empty / `0000000000`)

### Matching rules

Use the Cambodia decision rules profile before importing:

```bash
cp server/config/decisionRules.cambodia.json server/config/decisionRules.json
docker restart opencr
```

Matching fields: `pmrsid`, Khmer `given`/`family`, alias names, `birthDate`, `phone`, `gender` filter.
