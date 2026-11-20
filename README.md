# FlagShip — Feature Flag & Gradual Rollout Platform

> **Ship Features. Control Releases. Stay Resilient.**

FlagShip is a self-hosted feature flag and gradual rollout platform built for **CSE 444 (Software Architecture and Design Patterns)**. It enables engineering teams to toggle features, target user segments, run deterministic percentage rollouts, gate Production changes behind dual-control approvals, measure A/B experiments with SRM detection, and keep applications evaluating flags locally even during central server outages.

---

## Architecture at a Glance

1. **FlagShip Control Plane Server** (`/api/v1/*`) — Modular monolith handling authentication (JWT + RBAC), projects, environments, flags, targeting, sticky rollouts, versioning/rollback, production approvals, experiment analytics, stale flag hygiene, and live SSE broadcasting.
2. **FlagShip Admin Dashboard** (`src/`) — Responsive 18-page React + TypeScript + Tailwind CSS + Recharts SaaS console with light/dark mode and live SSE updates.
3. **FlagShip Spring Boot Starter SDK** (`flagship-sdk/` + `flagship-shared/`) — Reusable Maven starter with `@AutoConfiguration`, `@ConfigurationProperties`, local snapshot persistence, <=2s startup timeout, SSE + polling fallback, `@FeatureFlag` AOP guard, custom Actuator endpoint, and Micrometer metrics.

---

## Quick Start (Live Full-Stack Web App — Node.js / Express + React)

```bash
npm install
npm test        # Runs FR2/FR3/FR6/FR8/FR9 + QA1/QA2/QA4 (1,000,000-user) test suite
npm run build   # Builds production React bundle
npm run dev     # Starts FlagShip on http://localhost:3000
```

### Demo Accounts (Password: `flagship123`)
| Role | Email | Capabilities |
| :--- | :--- | :--- |
| `ADMIN` | `admin@flagship.io` | Full platform, RBAC, environments, reset demo |
| `APPROVER` | `approver@flagship.io` | Approve/reject Production change requests (cannot self-approve) |
| `EDITOR` | `editor@flagship.io` | Create/edit flags, rules, rollouts, submit Prod change requests |
| `VIEWER` | `viewer@flagship.io` | Read-only access across projects & analytics |

---

## Quick Start (Docker Compose + Java 21 Spring Boot Stack)

On any host with Docker & JDK 21:

```bash
docker compose up --build
```

- PostgreSQL 16 starts with persistent volume `flagship_pgdata` and Flyway `V1__initial_schema.sql`.
- Spring Boot 4 server listens on `http://localhost:8080` (`/actuator/health`, `/swagger-ui.html`).
- Admin Dashboard listens on `http://localhost:3000`.

---

## Going Live on GitHub Pages

FlagShip includes an automated GitHub Actions deployment workflow (`.github/workflows/deploy-pages.yml`) and a browser-native runtime engine (`src/api/localBackend.ts`) so all 18 dashboard pages, RBAC roles, sticky MurmurHash3 rollouts, production self-approval guards, experiment analytics (Z-test + Chi-square SRM), stale flag hygiene, and the interactive SDK offline simulator run live on GitHub Pages with `localStorage` persistence—no separate backend server required.

### Enable GitHub Pages (3 Steps)
1. Push this repository to the `main` branch on GitHub.
2. Open your repository on GitHub and go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.

Every push to `main` (or manual trigger in **Actions → Deploy FlagShip to GitHub Pages**) builds with `npm run build:pages` (relative `./` asset paths, `404.html`, and `.nojekyll`) and publishes your live site at `https://<username>.github.io/<repository>/`.

---

## QA5 — 15-Minute Spring Boot Starter Integration Guide

1. Add the starter dependency to your Spring Boot `pom.xml`:
```xml
<dependency>
  <groupId>io.flagship</groupId>
  <artifactId>flagship-spring-boot-starter</artifactId>
  <version>1.0.0</version>
</dependency>
```
2. Add your Environment SDK Key to `application.yml`:
```yaml
flagship:
  server-url: http://localhost:8080
  sdk-key: fs_prod_com_9f44c1d8a7e2
  startup-timeout-ms: 1500
  snapshot-path: ./data/flagship-snapshot.json
```
3. Guard any controller or service method with `@FeatureFlag` or inject `FlagShipClient`:
```java
@FeatureFlag(value = "new-checkout-flow", fallbackMethod = "legacyCheckout")
public ResponseEntity<String> expressCheckout(String userId) { ... }
```
See `flagship-sample-app/` for a complete runnable reference application.

---

## Documentation Index
- [AGENT.md](./AGENT.md) · [MEMORY.md](./MEMORY.md) · [ERROR.md](./ERROR.md)
- [Architecture & C4 Diagrams](./docs/architecture.md)
- [Database Design & ER Diagram](./docs/database-design.md)
- [Design Patterns Justification (C8)](./docs/design-patterns.md)
- [Utility Tree & Mini-ATAM (C7)](./docs/utility-tree.md)
- [Performance & Evidence Report (C9 & C10)](./docs/performance-report.md)
- [Testing Guide](./docs/testing-guide.md)
- [AI Usage Log (C11)](./docs/ai-usage-log.md)
- [15-Minute Live Defence Guide (C12)](./docs/live-defence-guide.md)
- ADRs: [ADR-001](./docs/adr/ADR-001-modular-monolith.md), [ADR-002](./docs/adr/ADR-002-deterministic-hashing.md), [ADR-003](./docs/adr/ADR-003-sse-with-polling-fallback.md), [ADR-004](./docs/adr/ADR-004-offline-snapshot-resilience.md)
