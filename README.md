# tide

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-ElianCodes-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ElianCodes)
[![Discord](https://img.shields.io/discord/1495441903297237043?label=Discord&logo=discord&logoColor=white&color=5865F2)](https://discord.gg/M3wzFpGbzp)

> A [Coral](https://getcoral.dev) ecosystem module — built on TanStack Start, Tailwind v4, and the Jellyfin API.

---

## Getting started

### 1. Rename the module

Replace `tide` with your module name throughout:

```bash
# package.json → "name"
# .github/workflows/docker-publish.yml → IMAGE_NAME
# .github/workflows/release-please.yml → image_name
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Set your downloads directory, optional auth, and any other Tide settings
```

### 4. Start developing

```bash
pnpm dev
```

App runs at `http://localhost:3000`.

---

## Stack

| Tool | Purpose |
|------|---------|
| [TanStack Start](https://tanstack.com/start) | Full-stack React framework |
| [TanStack Router](https://tanstack.com/router) | Type-safe file-based routing |
| [TanStack Query](https://tanstack.com/query) | Server state management |
| [Tailwind v4](https://tailwindcss.com) | Styling |
| [Biome](https://biomejs.dev) | Linting & formatting |
| [@get-coral/jellyfin](https://github.com/Get-Coral/jellyfin) | Jellyfin API client |
| [Vitest](https://vitest.dev) | Testing |

---

## Scripts

```bash
pnpm dev        # Start dev server on :3000
pnpm build      # Production build
pnpm start      # Run production server
pnpm typecheck  # TypeScript check
pnpm check      # Biome lint + format check
pnpm lint       # Biome lint with auto-fix
pnpm test       # Run tests
```

---

## Docker

```bash
# Build
docker build -t tide .

# Run
docker run -p 3000:3000 \
  -e TIDE_DOWNLOADS_DIR=/downloads \
  -e TIDE_MEMORY_LIMIT_MB=8192 \
  -e TIDE_MEMORY_PAUSE_MB=7168 \
  -e TIDE_MEMORY_RESUME_MB=6144 \
  -e TIDE_AUTH_USERNAME=admin \
  -e TIDE_AUTH_PASSWORD=change-me \
  tide
```

## Memory safety

Tide now includes an RSS-based memory guard for torrent activity.

- If Tide can read the container memory cap from cgroups, the guard enables itself automatically.
- You can override or force thresholds with `TIDE_MEMORY_LIMIT_MB`, `TIDE_MEMORY_PAUSE_MB`, and `TIDE_MEMORY_RESUME_MB`.
- When RSS crosses the pause threshold, Tide pauses active torrents and disconnects peers.
- Activity resumes only after RSS falls below the lower resume threshold.
- `TIDE_MEMORY_CHECK_INTERVAL_MS` controls how often Tide re-checks memory usage. Default is `5000`.

For an 8 GB container limit on a NAS, a reasonable starting point is:

```bash
TIDE_MEMORY_LIMIT_MB=8192
TIDE_MEMORY_PAUSE_MB=7168
TIDE_MEMORY_RESUME_MB=6144
```

Published automatically to `ghcr.io/get-coral/<module-name>` on every release via GitHub Actions.

---

## CI / CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | Every PR + push to main | Typecheck, lint, test, build, Docker build check |
| `docker-publish.yml` | Push to main + version tags | Publishes to GHCR |
| `release-please.yml` | Push to main | Opens release PR, publishes Docker on merge |

Releases are fully automated via [Release Please](https://github.com/googleapis/release-please). Use conventional commits:

| Commit prefix | Version bump |
|--------------|-------------|
| `feat:` | Minor |
| `fix:` | Patch |
| `feat!:` / `fix!:` | Major |
| `chore:`, `docs:` | No bump |

---

## Part of Coral

This module is part of the [Coral](https://getcoral.dev) ecosystem. See the [contributing guide](https://github.com/Get-Coral/.github/blob/main/CONTRIBUTING.md) before opening PRs.
