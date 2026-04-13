# tide

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
  -e TIDE_AUTH_USERNAME=admin \
  -e TIDE_AUTH_PASSWORD=change-me \
  tide
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
