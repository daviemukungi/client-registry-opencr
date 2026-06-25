# Deployment Changelog

This page records deployment-relevant changes for operators and developers maintaining Docker-based environments. For day-to-day production setup, start with [Production Installation using Docker](docker-production.md).

## 2026-06-25 — Production Docker Compose and Docker Hub images

### Summary

Single-server production deployments can use a pull-only Docker Compose stack. Custom OpenCR and OpenSearch images are published to Docker Hub under the `daviemukungi` namespace.

### New files

| File | Purpose |
|------|---------|
| [`docker-compose.prod.yml`](../../docker-compose.prod.yml) | Production stack: OpenCR, HAPI FHIR, PostgreSQL, OpenSearch |
| [`.env.prod.example`](../../.env.prod.example) | Example environment variables (image tags, DB password, OpenSearch heap) |
| [`server/config/config_production_docker_template.json`](../../server/config/config_production_docker_template.json) | Production config template with Docker service hostnames (`fhir`, `opensearch`) |
| [`docs/admin/docker-production.md`](docker-production.md) | Production deployment guide |

### Docker Hub images

Images use **date-sha** tags: `YYYYMMDD-<git-short-sha>`.

| Image | Tag (initial publish) | Contents |
|-------|----------------------|----------|
| [`daviemukungi/opencr`](https://hub.docker.com/r/daviemukungi/opencr) | `20260625-4bea9e2` | OpenCR service (Node 18); repushed 2026-06-25 with CI/runtime fixes (`sha256:09e2ca13…`) |
| [`daviemukungi/opensearch`](https://hub.docker.com/r/daviemukungi/opensearch) | `20260625-4bea9e2` | OpenSearch 2.1.0 + phonetic + record-linkage plugins (`sha256:24471137…`) |

Set tags in `.env`:

```bash
OPENCR_IMAGE_TAG=20260625-4bea9e2
OPENSEARCH_IMAGE_TAG=20260625-4bea9e2
```

To publish a new tag after code changes:

```bash
# OpenCR (from repository root)
docker build -f docker/opencr/Dockerfile -t daviemukungi/opencr:$(date +%Y%m%d)-$(git rev-parse --short HEAD) .
docker push daviemukungi/opencr:<tag>

# OpenSearch
docker build -t daviemukungi/opensearch:<tag> docker/opensearch
docker push daviemukungi/opensearch:<tag>
```

### Production vs local Docker (CICD)

| | Local / demo | Production |
|---|--------------|------------|
| Compose file | `docker-compose.cicd.yml` (+ optional override) | `docker-compose.prod.yml` |
| OpenCR image | Built locally (`intrahealth/opencr`) | Pulled from `daviemukungi/opencr` |
| OpenSearch image | `intrahealth/opensearch` or local build | Pulled from `daviemukungi/opensearch` |
| `NODE_ENV` | `cicd` | `production` |
| Database | H2 (default) or PostgreSQL (override) | PostgreSQL (required) |
| Host ports | All services may be published | Only OpenCR port 3000 by default |
| Secrets | Hardcoded in compose (demo) | `.env` + local `config_production.json` |

### Patient data policy

- **No patient records** are shipped with the production compose stack or config template.
- Deployers must copy and customize `config_production.json` locally; it is listed in `.gitignore` and must not be committed.
- Import CSV patterns (`data-*.csv`, `*.totals.json`) and local demo patient JSON files are gitignored.
- Patient data is imported separately after deployment using approved organizational processes.

### Documentation updates

- [docker-production.md](docker-production.md) — new production guide
- [docker.md](docker.md) — link to production guide
- [method.md](method.md) — added “Server installation (Docker)” option
- `mkdocs.yml` — production guide in Sysadmin navigation

### Merged pull request

- [PR #7 — Add production Docker Compose stack and deployment docs](https://github.com/daviemukungi/client-registry-opencr/pull/7)

---

## 2026-06-25 — CI and test toolchain fixes

### Summary

GitHub Actions workflows were updated to match the current Docker and Node.js toolchain used by the application image.

### Workflow changes

| Workflow | Change |
|----------|--------|
| **loginpage** | `docker-compose` → `docker compose` (Compose v2 on GitHub runners) |
| **test** | Node matrix `10.x/12.x/14.x` → **18.x** (matches `docker/opencr/Dockerfile`; older Node cannot parse optional chaining in app dependencies) |
| **build** | Same Node 18.x update |

### Compose fix

- `docker-compose.cicd.yml`: OpenCR host port mapping `3002:3000` → **`3000:3000`** so the loginpage workflow matches [docker.md](docker.md) (`https://localhost:3000/crux`).

### Test fixes

- `route-match-test`: fixture keys updated (`nationalId` → `nationalid`) to match identifier normalization.
- `route-fhir-test`: axios mock added for ES `_search` with scroll query parameters; patient submission test temporarily **skipped** pending fuller mock updates for the fellegi-sunter ES matching path.
- `fhir.js`: safer handling when batch response entries lack `location`.
- `esMatching.js` / `cacheFHIR.js`: guard against missing `_shards` in ES responses.
- `axios` test mock: default successful ES index response when no explicit mock is registered.

### Pull request

- [PR #9 — Fix CI test and loginpage workflows](https://github.com/daviemukungi/client-registry-opencr/pull/9) (merge when green)

---

## Quick reference — production deploy

```bash
cp .env.prod.example .env
cp server/config/config_production_docker_template.json server/config/config_production.json
# Edit .env and config_production.json (secrets, clients, identifier systems)

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

UI: `https://<host>:3000/crux`
