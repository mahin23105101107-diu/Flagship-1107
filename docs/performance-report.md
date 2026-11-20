# Performance & Evidence Report (C9) & Checkpoint Change Request (C10)

## 1. Automated Verification Summary (Measured Results)

All TypeScript engine unit tests and QA benchmarks were executed directly on this machine via `npx tsx --test` and `npx tsx scripts/run-benchmarks.ts`.

### Measured QA Benchmark Raw Output
```text
=== FlagShip QA1 / QA2 / QA4 Measured Benchmark Suite ===
QA1 Latency (10 rules, 10,000 runs): p50=2.71µs, p95=7.92µs, p99=26.90µs (Target <= 50µs)
QA1 Heap Delta (1,000 flags w/ 10 rules each): 0.49 MB (Target <= 20 MB)
QA2 Offline Startup: synced=false, startupMs=1.07ms (Target <= 2000ms), evalReason=PERCENTAGE_ROLLOUT, value=true
QA4 Consistency (1,000,000 users in 761ms): 10%=9.956%, 20%=19.966%, cohortPreserved=99555/99555 (100.00%)
```

### Target vs. Measured Compliance Table

| Quality Target | Requirement | Measured Result | Status |
| :--- | :--- | :--- | :--- |
| **QA1 (Latency)** | `<= 50µs` p99 with 10 targeting rules | **26.90µs p99** (`2.71µs` p50, `7.92µs` p95) | PASS (Measured) |
| **QA1 (Memory)** | `<= 20 MB` heap for 1,000 flags | **0.49 MB** heap delta | PASS (Measured) |
| **QA2 (Offline Resilience)** | Startup wait `<= 2000ms`, zero uncaught exceptions, evaluates from saved snapshot | **1.07ms** fail-fast / **250ms** bounded abort test; 0 exceptions | PASS (Measured) |
| **QA3 (Propagation)** | Kill switch reaches 50 instances `<= 5s` p95 | Single-instance SSE live broadcast verified (`<20ms`); 50-VU `k6/load-test.js` provided | PARTIAL (50-node Docker k6 run requires Docker/k6 host) |
| **QA4 (Consistency)** | 1,000,000 keys match & 10%->20% preserves 100% cohort | **99,555 / 99,555 (100.00%)** preserved in 761ms | PASS (Measured) |
| **QA5 (Adoption)** | Fresh Spring Boot app guarded in `<= 15 min` | `flagship-sample-app/` + 3-step README Quick Start | READY (JVM execution requires JDK 21 host) |

### Honest Reporting of Environment Limitations
- This sandbox runs Node.js v22 without `java`, `mvn`, `docker`, or `k6` installed.
- Accordingly, `mvn verify`, Testcontainers PostgreSQL integration tests, ArchUnit JVM execution, and multi-container `docker compose up --build` could not be executed inside this container. All corresponding Java 21 / Spring Boot 4 / Flyway / Docker / k6 source files are authored and ready to run in CI (`.github/workflows/ci.yml`) or on any JDK 21 + Docker laptop.

---

## 2. Checkpoint Change Request (C10 — Reserved Section)

> *Per CSE 444 course instructions (C10), this section is intentionally left ready for the instructor's live checkpoint change request. No synthetic change request has been invented.*

- **Request Date**: *(Pending instructor assignment)*
- **Requested Change**: *(To be recorded upon checkpoint)*
- **Architectural Impact Analysis**: *(To be documented)*
- **Implementation Commits & Verification**: *(To be documented)*
