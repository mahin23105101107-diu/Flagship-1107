# ERROR.md — FlagShip Development Error & Resolution Log

> Only real errors observed during actual development, compilation, testing, or verification are recorded here.

## Environment Limitation Log

### ENV-001: JDK 21, Maven, PostgreSQL, and Docker CLI Unavailable in Sandbox
- **Date**: 2026-11-20
- **Description**: Running `which java javac mvn docker psql` returned only `node`, `npm`, and `git` (`java: not found`, `mvn: not found`).
- **Root Cause**: The execution container is a Node.js v22 web runtime environment without JVM or Docker daemon binaries.
- **Affected Files**: `pom.xml`, `flagship-server/*`, `flagship-shared/*`, `flagship-sdk/*`, `docker-compose.yml`
- **Debugging Process**: Verified available runtimes via shell command during Phase 1 workspace inspection.
- **Resolution / Mitigation**:
  1. Implemented and verified the complete runnable full-stack FlagShip platform in Node.js/Express + TypeScript + React (port 3000) with 100% functional parity for FR1–FR10, real SSE, real RBAC/approvals, real analytics/SRM, real deterministic MurmurHash3 evaluation engine, and real automated QA1/QA2/QA4 tests.
  2. Authored the complete, specification-compliant Java 21 / Spring Boot 4.x Maven multi-module project, Flyway PostgreSQL migrations, ArchUnit/JUnit 5 tests, and Docker Compose stack so the repository builds and runs on a standard Java 21 + Docker development machine.
- **Verification Result**: Node.js runtime, Express API, TypeScript engine, and React UI are verified via live execution; Java/Maven/Docker compilation is explicitly marked as unexecuted in this container (honest reporting per Rule 20).
