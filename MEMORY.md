# MEMORY.md — FlagShip Project Context & Progress

## Current Phase
**Phase 9: Final Verification Complete**

## Environment Inspection Notes
- Runtime container provides **Node.js v22.23.2**, **npm**, **git**, and headless Chromium (`playwright-cli`).
- `java`, `mvn`, `docker`, and `psql` are **not installed** in this execution sandbox (logged honestly in `ERROR.md` under `ENV-001`).

## Completed Features
- [x] **Phase 1**: Workspace inspection, `AGENT.md`, `MEMORY.md`, `ERROR.md`, `metadata.json`, `index.html`
- [x] **Phase 2 & 3**: Core Evaluation Engine (`src/engine/` — Strategy, Composite, Visitor, Chain of Responsibility, Builder, MurmurHash3 32-bit) + Full-stack Express API (`server.ts`, `server/routes.ts`, `server/auth.ts`, `server/commands.ts`, `server/eventBus.ts`, `server/store.ts`)
- [x] **Phase 4**: Spring Boot Starter SDK (`flagship-sdk/flagship-spring-boot-autoconfigure`, `flagship-spring-boot-starter`, `@FeatureFlag` AOP, Actuator Endpoint, Micrometer, `flagship-sample-app`) + TypeScript offline-resilient `FlagShipClient`
- [x] **Phase 5 & 6**: Complete 18-page React + TypeScript + Tailwind CSS v4 + Recharts Admin Dashboard with light/dark mode, live SSE stream, visual Targeting Rules builder, User Segments, Sticky Rollout simulator, Diff/Rollback/Schedules, Approval Center (with server-enforced self-approval guard), Experiment Analytics (z-test + Chi-square SRM), Flag Hygiene, RBAC Team management, SDK Setup + Live Offline Simulator, System Health, and Settings
- [x] **Phase 7**: Automated `node:test` suite (`src/engine/evaluation.test.ts`, `src/engine/sdkClient.test.ts`), measured QA1/QA2/QA4 benchmark suite (`scripts/run-benchmarks.ts`), Java JUnit 5 & ArchUnit test files, k6 load test (`k6/load-test.js`), and Playwright Round 1 & Round 2 visual + functional verification
- [x] **Phase 8**: Complete CSE 444 documentation (`README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/design-patterns.md`, `docs/utility-tree.md`, `docs/performance-report.md`, `docs/testing-guide.md`, `docs/ai-usage-log.md`, `docs/live-defence-guide.md`, and `docs/adr/ADR-001` through `ADR-004`)
- [x] **Phase 9**: Final `compile_applet`, `lint_applet`, `npm test`, and browser verification passed with zero console errors
- [x] **Phase 10 (CI Fix)**: Fixed both GitHub Actions CI jobs (`frontend-and-engine` missing `package-lock.json` for `setup-node` `cache: npm` / `npm ci`, and `java-backend-and-sdk` migration from `4.0.0-M2` milestone to Maven Central Spring Boot `4.0.0` GA, `spring-boot-starter-aspectj`, `spring-boot-starter-flyway`, Jackson 3 `tools.jackson.*`, `springdoc` `3.0.0`, and JUnit 6-safe core ArchUnit `1.4.1` with `.withOptionalLayers(true)`)

## Measured QA Results
- **QA1 Latency (10 rules)**: `p50=2.71µs`, `p95=7.92µs`, `p99=26.90µs` (Target `<= 50µs`) — PASS
- **QA1 Heap (1,000 flags)**: `0.49 MB` delta (Target `<= 20 MB`) — PASS
- **QA2 Offline Startup**: `1.07ms` fail-fast / bounded `<= 2000ms`, zero uncaught exceptions — PASS
- **QA4 Consistency (1,000,000 keys)**: `99,555/99,555 (100.00%)` cohort preserved from 10% -> 20% — PASS

## Known Limitations
- Java 21 / Maven (`mvn verify`) and Docker Compose (`docker compose up --build`) could not be executed in this Node.js-only sandbox container and require a JDK 21 + Docker host or GitHub Actions CI run.
