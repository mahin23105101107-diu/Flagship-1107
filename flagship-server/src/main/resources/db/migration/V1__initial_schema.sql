-- FlagShip Normalized PostgreSQL Schema (Flyway V1)
-- Covers all 20 required domain tables with PKs, FKs, unique constraints, indexes, and optimistic locking.

CREATE TABLE roles (
    id          VARCHAR(32) PRIMARY KEY,
    name        VARCHAR(32) NOT NULL UNIQUE,
    description TEXT
);

INSERT INTO roles (id, name, description) VALUES
  ('VIEWER', 'VIEWER', 'Read-only access to projects and flags'),
  ('EDITOR', 'EDITOR', 'Create and edit flags, rules, segments, and submit Prod CRs'),
  ('APPROVER', 'APPROVER', 'Review and approve Production change requests'),
  ('ADMIN', 'ADMIN', 'Full platform administration and RBAC control');

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    full_name     VARCHAR(160) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id       VARCHAR(32)  NOT NULL REFERENCES roles(id),
    active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_key VARCHAR(100) NOT NULL UNIQUE,
    name        VARCHAR(160) NOT NULL,
    description TEXT,
    owner_id    UUID         NOT NULL REFERENCES users(id),
    archived    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE project_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     VARCHAR(32) NOT NULL REFERENCES roles(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, user_id)
);

CREATE TABLE environments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    env_key           VARCHAR(64)  NOT NULL,
    name              VARCHAR(100) NOT NULL,
    env_type          VARCHAR(24)  NOT NULL CHECK (env_type IN ('DEVELOPMENT', 'STAGING', 'PRODUCTION')),
    sdk_key           VARCHAR(128) NOT NULL UNIQUE,
    requires_approval BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, env_key)
);

CREATE TABLE feature_flags (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    flag_key             VARCHAR(128) NOT NULL,
    name                 VARCHAR(200) NOT NULL,
    description          TEXT,
    flag_type            VARCHAR(16)  NOT NULL CHECK (flag_type IN ('BOOLEAN', 'STRING', 'NUMBER', 'JSON')),
    default_variation_id UUID,
    owner_id             UUID         NOT NULL REFERENCES users(id),
    archived             BOOLEAN      NOT NULL DEFAULT FALSE,
    version              BIGINT       NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, flag_key)
);

CREATE TABLE flag_variations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id     UUID         NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    var_key     VARCHAR(100) NOT NULL,
    name        VARCHAR(160) NOT NULL,
    value_json  JSONB        NOT NULL,
    description TEXT,
    UNIQUE (flag_id, var_key)
);

CREATE TABLE flag_configurations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id                  UUID        NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    environment_id           UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    enabled                  BOOLEAN     NOT NULL DEFAULT FALSE,
    kill_switch_active       BOOLEAN     NOT NULL DEFAULT FALSE,
    kill_switch_variation_id UUID        REFERENCES flag_variations(id),
    default_variation_id     UUID        NOT NULL REFERENCES flag_variations(id),
    rollout_percentage       INT         NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
    rollout_variation_id     UUID        REFERENCES flag_variations(id),
    rollout_weights_json     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    config_version           INT         NOT NULL DEFAULT 1,
    optimistic_lock_version  BIGINT      NOT NULL DEFAULT 0,
    last_evaluated_at        TIMESTAMPTZ,
    full_rollout_since       TIMESTAMPTZ,
    updated_by               UUID        REFERENCES users(id),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (flag_id, environment_id)
);

CREATE TABLE user_segments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    segment_key    VARCHAR(100) NOT NULL,
    name           VARCHAR(160) NOT NULL,
    description    TEXT,
    included_users JSONB        NOT NULL DEFAULT '[]'::jsonb,
    excluded_users JSONB        NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, segment_key)
);

CREATE TABLE segment_conditions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id    UUID        NOT NULL REFERENCES user_segments(id) ON DELETE CASCADE,
    logical_op    VARCHAR(8)  NOT NULL DEFAULT 'AND' CHECK (logical_op IN ('AND', 'OR')),
    attribute     VARCHAR(100) NOT NULL,
    operator      VARCHAR(32) NOT NULL,
    values_json   JSONB       NOT NULL,
    sort_order    INT         NOT NULL DEFAULT 0
);

CREATE TABLE targeting_rules (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_config_id     UUID         NOT NULL REFERENCES flag_configurations(id) ON DELETE CASCADE,
    name               VARCHAR(160) NOT NULL,
    priority           INT          NOT NULL DEFAULT 1,
    enabled            BOOLEAN      NOT NULL DEFAULT TRUE,
    segment_ids_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    rule_tree_json     JSONB        NOT NULL,
    serve_variation_id UUID         NOT NULL REFERENCES flag_variations(id)
);

CREATE TABLE flag_targets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_config_id UUID         NOT NULL REFERENCES flag_configurations(id) ON DELETE CASCADE,
    variation_id   UUID         NOT NULL REFERENCES flag_variations(id),
    user_key       VARCHAR(255) NOT NULL,
    UNIQUE (flag_config_id, user_key)
);

CREATE TABLE flag_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id         UUID        NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    environment_id  UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    version_number  INT         NOT NULL,
    author_id       UUID        NOT NULL REFERENCES users(id),
    reason          TEXT        NOT NULL,
    before_snapshot JSONB,
    after_snapshot  JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE change_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id         UUID        NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    environment_id  UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    author_id       UUID        NOT NULL REFERENCES users(id),
    reason          TEXT        NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    before_config   JSONB       NOT NULL,
    proposed_config JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approvals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    change_request_id UUID        NOT NULL UNIQUE REFERENCES change_requests(id) ON DELETE CASCADE,
    reviewer_id       UUID        NOT NULL REFERENCES users(id),
    decision          VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    comment           TEXT,
    decided_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scheduled_changes (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id        UUID        NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    environment_id UUID        NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    author_id      UUID        NOT NULL REFERENCES users(id),
    reason         TEXT        NOT NULL,
    scheduled_for  TIMESTAMPTZ NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'EXECUTED', 'CANCELLED')),
    patch_json     JSONB       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at    TIMESTAMPTZ
);

CREATE TABLE sdk_instances (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    environment_id       UUID         NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    instance_name        VARCHAR(160) NOT NULL,
    sdk_version          VARCHAR(100) NOT NULL,
    transport            VARCHAR(16)  NOT NULL CHECK (transport IN ('SSE', 'POLLING')),
    status               VARCHAR(16)  NOT NULL CHECK (status IN ('CONNECTED', 'DEGRADED', 'OFFLINE')),
    last_sync_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_sync_latency_ms INT          NOT NULL DEFAULT 0,
    connected_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (environment_id, instance_name)
);

CREATE TABLE exposure_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id VARCHAR(100) NOT NULL,
    flag_key      VARCHAR(128) NOT NULL,
    user_key      VARCHAR(255) NOT NULL,
    variation_id  VARCHAR(100) NOT NULL,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE conversion_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id VARCHAR(100) NOT NULL,
    flag_key      VARCHAR(128) NOT NULL,
    user_key      VARCHAR(255) NOT NULL,
    variation_id  VARCHAR(100) NOT NULL,
    metric_value  DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID         NOT NULL REFERENCES users(id),
    action      VARCHAR(64)  NOT NULL,
    entity_type VARCHAR(64)  NOT NULL,
    entity_id   VARCHAR(100) NOT NULL,
    summary     TEXT         NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_flags_project ON feature_flags(project_id);
CREATE INDEX idx_flag_cfg_env ON flag_configurations(environment_id);
CREATE INDEX idx_flag_cfg_hygiene ON flag_configurations(last_evaluated_at, full_rollout_since);
CREATE INDEX idx_versions_flag_env ON flag_versions(flag_id, environment_id, created_at DESC);
CREATE INDEX idx_cr_status ON change_requests(status, created_at DESC);
CREATE INDEX idx_exposures_exp ON exposure_events(experiment_id, variation_id);
CREATE INDEX idx_conversions_exp ON conversion_events(experiment_id, variation_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
