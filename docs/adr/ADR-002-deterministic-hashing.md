# ADR-002: Deterministic MurmurHash3 32-Bit Rollout Bucketing

- **Status**: Accepted
- **Date**: 2026-11-20

## Context
FR3 and QA4 mandate sticky percentage rollouts (1%–100%) that produce identical results on the server preview and every SDK instance across 1,000,000 users, preserve the original 10% cohort when raised to 20%, and keep different flags independent.

## Problem
Random assignment flickers per request, while naive modulo on user IDs correlates cohorts across different flags. Cryptographic hashes (SHA-256) allocate byte arrays and increase latency per evaluation.

## Options Considered
1. `java.lang.String.hashCode()` / DJB2: Poor avalanche distribution; not portable across languages without drift.
2. SHA-256 truncated to 32 bits: Uniform and portable, but ~8–12x slower and allocates buffers.
3. **MurmurHash3 32-bit (x86, seed=0)** over `"${flagKey}:${userKey}"` mapped to `(uint32 % 10000) / 100.0`.

## Decision
Standardize on **MurmurHash3 32-bit (seed=0)** implemented bit-identically in `flagship-shared/.../MurmurHash3.java` and `src/engine/hashing.ts`.

## Consequences & Measured Evidence
- **Measured (QA4)**: Across 1,000,000 keys in 761ms, 10% rollout hit `9.956%`, 20% hit `19.966%`, and `99,555 / 99,555` (**100.00%**) of the 10% cohort was preserved at 20%.
- **Measured (QA1)**: Contributes <1µs to total evaluation time (`p99 = 26.90µs` with 10 targeting rules).
