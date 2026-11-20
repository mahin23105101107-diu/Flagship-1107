# FlagShip Database Design (PostgreSQL 16 + Flyway)

FlagShip uses a normalized 20-table PostgreSQL schema (`flagship-server/src/main/resources/db/migration/V1__initial_schema.sql`) enforcing referential integrity, unique keys, check constraints, indexes for hot paths, and optimistic locking (`optimistic_lock_version`).

## Entity-Relationship Diagram

```mermaid
erDiagram
    ROLES ||--o{ USERS : assigns
    USERS ||--o{ PROJECTS : owns
    PROJECTS ||--o{ PROJECT_MEMBERS : has
    USERS ||--o{ PROJECT_MEMBERS : joins
    PROJECTS ||--o{ ENVIRONMENTS : contains
    PROJECTS ||--o{ FEATURE_FLAGS : contains
    PROJECTS ||--o{ USER_SEGMENTS : defines

    FEATURE_FLAGS ||--o{ FLAG_VARIATIONS : defines
    FEATURE_FLAGS ||--o{ FLAG_CONFIGURATIONS : configured_per_env
    ENVIRONMENTS ||--o{ FLAG_CONFIGURATIONS : scopes

    FLAG_CONFIGURATIONS ||--o{ TARGETING_RULES : evaluates
    FLAG_CONFIGURATIONS ||--o{ FLAG_TARGETS : overrides
    USER_SEGMENTS ||--o{ SEGMENT_CONDITIONS : composed_of

    FEATURE_FLAGS ||--o{ FLAG_VERSIONS : snapshots
    FEATURE_FLAGS ||--o{ CHANGE_REQUESTS : governs
    CHANGE_REQUESTS ||--o| APPROVALS : reviewed_by
    FEATURE_FLAGS ||--o{ SCHEDULED_CHANGES : schedules

    ENVIRONMENTS ||--o{ SDK_INSTANCES : connects
    FEATURE_FLAGS ||--o{ EXPOSURE_EVENTS : logs
    FEATURE_FLAGS ||--o{ CONVERSION_EVENTS : converts
    USERS ||--o{ AUDIT_LOGS : performs
```

## Key Design Decisions
- **Optimistic Locking**: `feature_flags.version` and `flag_configurations.optimistic_lock_version` prevent silent lost updates during concurrent admin edits.
- **Immutable Version Snapshots**: `flag_versions` stores both `before_snapshot` and `after_snapshot` JSONB documents enabling zero-loss side-by-side diffs and deterministic rollback.
- **Hygiene Indexes**: Composite index `idx_flag_cfg_hygiene (last_evaluated_at, full_rollout_since)` makes FR9 stale-flag queries O(log N).
- **Analytics Partition-Ready Tables**: `exposure_events` and `conversion_events` are append-only with `(experiment_id, variation_id)` composite indexes for fast aggregation.
