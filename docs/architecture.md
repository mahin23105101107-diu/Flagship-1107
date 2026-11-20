# FlagShip Software Architecture (C4 Model)

## 1. C4 Level 1 — System Context Diagram

```mermaid
C4Context
    title FlagShip System Context Diagram
    Person(dev, "Developer / Release Manager", "Creates flags, configures targeting rules, monitors experiments")
    Person(approver, "Release Approver / Admin", "Reviews and approves Production change requests, manages RBAC")
    System(flagship, "FlagShip Platform", "Self-hosted feature flag, gradual rollout, approval, and experiment analytics platform")
    System_Ext(clientApp, "Client Spring Boot Microservices", "Consumes flagship-spring-boot-starter for sub-50µs local flag evaluation")
    System_Ext(endUser, "Application End Users", "Receives deterministic feature variations based on targeting and sticky rollout")

    Rel(dev, flagship, "Manages flags, segments, rollouts via Admin Dashboard (HTTPS)")
    Rel(approver, flagship, "Reviews diffs & approves Prod changes (HTTPS)")
    Rel(clientApp, flagship, "Downloads snapshots & subscribes to SSE live updates (HTTP/SSE)")
    Rel(endUser, clientApp, "Uses product features")
```

## 2. C4 Level 2 — Container Diagram

```mermaid
C4Container
    title FlagShip Container Diagram
    Person(operator, "Engineering Team", "VIEWER / EDITOR / APPROVER / ADMIN")
    System_Boundary(fs, "FlagShip Control Plane") {
        Container(spa, "Admin Web Dashboard", "React 19, TypeScript, Tailwind CSS, Recharts", "18-page responsive SaaS UI with live SSE updates")
        Container(api, "FlagShip Backend Server", "Modular Monolith (Java 21 Spring Boot 4 / Express TS Runtime)", "REST /api/v1/*, JWT/RBAC, SSE Broadcaster, Approval Gate, Analytics")
        ContainerDb(db, "FlagShip Database", "PostgreSQL 16 (Flyway V1 20 tables)", "Normalized persistence for flags, versions, CRs, events, audit logs")
    }
    System_Boundary(client, "Host Spring Boot Application") {
        Container(sdk, "FlagShip Spring Boot Starter", "Java 21 Auto-Config + AOP + Local Disk Snapshot", "Local evaluation (<50µs), SSE client, polling fallback, offline resilience")
    }

    Rel(operator, spa, "Uses", "HTTPS")
    Rel(spa, api, "Calls REST API & SSE stream", "JSON / SSE")
    Rel(api, db, "Reads & writes transactional state", "JDBC / SQL")
    Rel(sdk, api, "Syncs snapshots, subscribes SSE, batches events", "HTTPS / SSE")
```

## 3. C4 Level 3 — Backend Modular Monolith Component Diagram

```mermaid
flowchart TB
    subgraph API["REST & SSE Layer (/api/v1/*)"]
        AuthC["Auth & RBAC Controller"]
        FlagC["Flags, Targeting & Rollout Controller"]
        GovC["Approvals, Versions & Schedules Controller"]
        InsC["Analytics, Hygiene & Health Controller"]
        SseC["SDK Snapshot & SSE Stream Controller"]
    end

    subgraph Core["Domain Modules"]
        Eval["Shared Evaluation Engine<br/>(Chain of Resp. + Strategy + Composite + Visitor)"]
        Cmd["Command Processor<br/>(Versioned Apply & Rollback)"]
        Approval["Dual-Control Approval Gate<br/>(Self-Approval Guard)"]
        Stats["Experiment Stats Engine<br/>(Two-Prop Z-Test + Chi-Square SRM)"]
        Hygiene["Flag Hygiene Detector<br/>(30d Unused / 14d @ 100%)"]
        Bus["Observer Event Bus<br/>(SSE Fan-Out + Audit Listener)"]
    end

    subgraph Data["Persistence Layer"]
        Store["PostgreSQL / Persistent Store"]
    end

    AuthC --> Store
    FlagC --> Eval
    FlagC --> Approval
    FlagC --> Cmd
    GovC --> Approval
    GovC --> Cmd
    Approval --> Cmd
    Cmd --> Bus
    Cmd --> Store
    InsC --> Stats
    InsC --> Hygiene
    SseC --> Bus
    SseC --> Store
```

## 4. Module Boundaries (Enforced via ArchUnit C6)
- Controllers strictly delegate to Domain Services/Commands and never access repositories directly.
- `flagship-shared` has zero dependency on Spring Web, JPA, or database drivers so both server preview and client SDK share identical evaluation semantics.
