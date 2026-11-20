# ADR-001: Modular Monolith Backend Architecture

- **Status**: Accepted
- **Date**: 2026-11-20

## Context
FlagShip requires 12 cohesive domain capabilities (auth, projects, environments, flags, targeting, rollouts, approvals, versioning, analytics, hygiene, SDK sync, audit) while running cleanly on an 8 GB RAM laptop via a single `docker compose up --build` command (C1).

## Problem
How should backend responsibilities be structured to preserve clean architectural boundaries without introducing operational overhead or distributed consistency bugs?

## Options Considered
1. **Microservices (6+ Spring Boot services + Kafka + API Gateway)**: High RAM footprint (>4 GB idle), complex distributed transactions across flags/versions/approvals, slow local setup.
2. **Unstructured Layered Monolith**: Simple to start, but business logic bleeds across domains over time.
3. **Modular Monolith with ArchUnit Boundary Enforcement**: Single deployable unit with strict domain package boundaries and shared transactional PostgreSQL database.

## Decision
Adopt a **Modular Monolith** with a separate `flagship-shared` evaluation library and ArchUnit boundary verification (`ArchitectureRulesTest`).

## Consequences
- **Positive**: ACID transactions across flag updates, version snapshots, and audit logs; <512 MB backend RAM; single-command Docker startup; easy to comprehend and defend.
- **Negative**: Horizontal scaling of SSE streams across multiple backend replicas will eventually require a shared pub/sub broker (e.g. Redis or PostgreSQL `LISTEN/NOTIFY`).
