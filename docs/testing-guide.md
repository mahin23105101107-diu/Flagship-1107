# FlagShip Testing Guide

## 1. Automated Unit & Quality Attribute Tests (Node.js / TypeScript)
Run the fast deterministic suite (`node:test` via `tsx`):
```bash
npm test
```
Covers:
- **FR2**: 5-stage Chain of Responsibility order (`Kill Switch > Individual Target > Segment Rule > Rollout > Default`) + all 8 targeting operators + nested `AND`/`OR` rule groups + segment exclusions.
- **FR3 & QA4**: 1,000,000-user deterministic MurmurHash3 sticky rollout, 100% cohort preservation from 10% -> 20%, and cross-flag independence.
- **QA1**: 10-rule local evaluation latency (`p99 <= 50µs`).
- **FR6 & QA2**: Local disk snapshot persistence, offline restart bounded under `<= 2000ms`, zero uncaught exceptions, and fallback safe defaults.
- **FR8**: Two-proportion z-test significance and Pearson Chi-square SRM detection.
- **FR9**: Stale flag detection (`>=30d` unevaluated or `>=14d` at 100% rollout).

## 2. QA Benchmark Suite
```bash
npx tsx scripts/run-benchmarks.ts
```

## 3. Java / Spring Boot / ArchUnit Tests (On JDK 21 Host)
```bash
mvn -B verify
```
Runs `StickyRolloutConsistencyTest` (JUnit 5, 1,000,000 keys) and `ArchitectureRulesTest` (ArchUnit C6 layered modular monolith enforcement).

## 4. Load Testing (k6)
```bash
k6 run k6/load-test.js
```
Simulates 50 concurrent SDK instances fetching snapshots with `p95 < 200ms` and `<1%` error thresholds.
