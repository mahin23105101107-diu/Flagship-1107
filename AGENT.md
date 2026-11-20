# AGENT.md — FlagShip Development Agent Guidelines

## 1. Project Overview
**FlagShip** (*Ship Features. Control Releases. Stay Resilient.*) is a self-hosted feature flag and gradual rollout platform built for CSE 444 (Software Architecture and Design Patterns). It allows engineering teams to decouple feature deployment from release via:
1. **FlagShip Backend Server** — Modular monolith exposing `/api/v1/*` REST APIs, Server-Sent Events (SSE) live push streams, RBAC & approval workflows, experiment analytics, and flag hygiene detection.
2. **FlagShip Admin Dashboard** — Responsive 18-page React + TypeScript + Tailwind CSS developer console with light/dark mode, Recharts analytics, visual rule/segment builders, diff/rollback views, and live SDK simulator.
3. **FlagShip Spring Boot Starter (Client SDK)** — Reusable Maven starter (`flagship-spring-boot-starter` + `flagship-spring-boot-autoconfigure`) with deterministic local evaluation, disk snapshot offline resilience, SSE + polling fallback, `@FeatureFlag` AOP guard, Actuator endpoint, and Micrometer metrics.

## 2. Functional Requirements Checklist (FR1–FR10)
- **FR1**: Projects, Environments (Development, Staging, Production), Flags (`BOOLEAN`, `STRING`, `NUMBER`, `JSON`), named variations, default variation, archive/search.
- **FR2**: Targeting Engine with strict evaluation order: `Kill Switch -> Individual User Targets -> Segment Rules -> Percentage Rollout -> Default Variation`; operators `EQUALS`, `NOT_EQUALS`, `IN`, `CONTAINS`, `SEMVER_GREATER_THAN`, `REGEX`, `DATE_BEFORE`, `DATE_AFTER`; nested `AND`/`OR` groups.
- **FR3**: Sticky Percentage Rollout (1–100%) using deterministic MurmurHash3 32-bit over `flagKey:userKey`; cohort-preserving expansion (10% -> 20% retains original 10%); verified over 1,000,000 user keys.
- **FR4**: Spring Boot Starter with `@AutoConfiguration`, `@ConfigurationProperties`, typed client API, `@FeatureFlag` AOP annotation, Actuator endpoint, Micrometer metrics, and sample app.
- **FR5**: Live Updates via SSE (`/api/v1/sdk/stream`) with polling fallback, target <5s propagation.
- **FR6**: Offline Resilience — in-memory cache + disk snapshot persistence, <=2s startup timeout, zero uncaught connectivity exceptions, safe defaults.
- **FR7**: Change Control & Approval — versioned snapshots, before/after diff, rollback, scheduled changes, production approvals, RBAC (`VIEWER`, `EDITOR`, `APPROVER`, `ADMIN`), strict self-approval prevention.
- **FR8**: Experiment Analytics — exposure & conversion events, conversion rate, lift, two-proportion z-test significance, Chi-square Sample Ratio Mismatch (SRM), batched ingestion.
- **FR9**: Flag Hygiene — stale flag detection (>30d unevaluated or >=14d at 100% rollout) with cleanup actions.
- **FR10**: Complete 18-page responsive Admin Web Application connected to live backend APIs.

## 3. Architecture & Coding Rules
- **Modular Monolith**: Clear domain module boundaries (Auth, Projects, Environments, Flags, Targeting, Rollout, SDK, Versioning, Approvals, Analytics, Hygiene, Audit). No unnecessary microservices.
- **Single Source of Truth for Evaluation**: The exact same MurmurHash3 32-bit bucketing algorithm and 5-stage Chain of Responsibility logic must be implemented identically in both the TypeScript runtime engine (`src/engine/`) and the Java shared engine (`flagship-shared/`).
- **Design Patterns**: Apply only where justified — Strategy (operators/bucketing), Composite (nested rule groups), Visitor (rule tree evaluation & validation), Chain of Responsibility (5-stage evaluation pipeline), Observer (flag change -> SSE broadcast & audit), Proxy/Decorator (SDK caching & telemetry), Command (versioned changes & rollback), Builder (EvaluationContext construction).
- **Security**: Never store plaintext passwords (`scrypt` / `BCrypt`). Signed JWT tokens. Strict RBAC and self-approval checks enforced server-side. RFC 9457 Problem Details error payloads.
- **UI/UX**: Clean developer console, tabular numerals (`tabular-nums`), accessible semantic HTML, light & dark themes, zero fake stubs or dead buttons.

## 4. Development Workflow & Quality Gates
1. Read `AGENT.md`, `MEMORY.md`, and `ERROR.md` before starting work.
2. Implement phase-by-phase (Planning -> Core Engine & Persistence -> Backend API -> Spring Boot Starter & Java Monolith -> Admin Dashboard -> Tests & Benchmarks -> Docs -> Live Verification).
3. Run automated unit tests (`npx tsx --test`), TypeScript lint (`npm run lint`), production build (`npm run build`), and real headless browser UI verification before completing.
4. Record every real error encountered and its verified resolution in `ERROR.md`. Never fabricate test results or claim untested binaries executed.
5. Update `MEMORY.md` after each major phase.
