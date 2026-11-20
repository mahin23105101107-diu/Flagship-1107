# ADR-004: Local In-Memory Evaluation with Disk Snapshot Persistence for Offline Resilience

- **Status**: Accepted
- **Date**: 2026-11-20

## Context
FR6, QA1, and QA2 require the FlagShip SDK to evaluate flags locally in `<=50µs`, never propagate network failures to application business code, start up in `<=2s` even when the central FlagShip server is offline, and survive 30+ minute outages across client restarts.

## Problem
Remote HTTP evaluation per flag check fails both QA1 (network RTT is ~2–20ms vs 50µs budget) and QA2 (central server outage brings down every client microservice).

## Options Considered
1. **Remote REST Evaluation per Request**: Violates QA1 and turns FlagShip into a single point of failure.
2. **In-Memory Cache Only**: Survives outages while running, but fails if a client pod restarts during an outage.
3. **In-Memory Atomic Snapshot + Local Disk Persistence + Bounded Startup Timeout (`<=2s`)**: Loads disk snapshot first, attempts bounded startup sync, and shields all exceptions behind safe fallback defaults.

## Decision
Implement **Local Atomic Snapshot Evaluation + Disk Persistence** (`FlagShipClient.java` and `src/engine/sdkClient.ts`).

## Consequences & Measured Evidence
- **Measured (QA1)**: Local evaluation with 10 rules achieves `p99 = 26.90µs`; 1,000 flags consume only `0.49 MB` heap.
- **Measured (QA2)**: Restarting against an unreachable server completes within `1.07ms` (or bounded timeout cap) and serves persisted snapshot variations with zero uncaught exceptions.
- **Trade-off**: During an outage, flag changes made on the server cannot propagate until connectivity recovers (eventual consistency).
