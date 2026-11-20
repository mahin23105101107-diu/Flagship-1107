export type Role = 'VIEWER' | 'EDITOR' | 'APPROVER' | 'ADMIN';

export type FlagType = 'BOOLEAN' | 'STRING' | 'NUMBER' | 'JSON';

export type EnvironmentType = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

export type TargetingOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'IN'
  | 'CONTAINS'
  | 'SEMVER_GREATER_THAN'
  | 'REGEX'
  | 'DATE_BEFORE'
  | 'DATE_AFTER';

export type LogicalOperator = 'AND' | 'OR';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ScheduleStatus = 'SCHEDULED' | 'EXECUTED' | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
  active: boolean;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export interface Project {
  id: string;
  key: string;
  name: string;
  description: string;
  ownerId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: Role;
  assignedAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  key: string;
  name: string;
  type: EnvironmentType;
  sdkKey: string;
  requiresApproval: boolean;
  createdAt: string;
}

export interface FlagVariation {
  id: string;
  key: string;
  name: string;
  value: boolean | string | number | Record<string, unknown>;
  description?: string;
}

export interface ConditionLeaf {
  kind: 'condition';
  id: string;
  attribute: string;
  operator: TargetingOperator;
  values: string[];
}

export interface RuleGroup {
  kind: 'group';
  id: string;
  logicalOp: LogicalOperator;
  children: RuleNode[];
}

export type RuleNode = ConditionLeaf | RuleGroup;

export interface TargetingRule {
  id: string;
  name: string;
  priority: number;
  segmentIds: string[];
  rootGroup: RuleGroup;
  serveVariationId: string;
  enabled: boolean;
}

export interface IndividualTarget {
  variationId: string;
  userKeys: string[];
}

export interface RolloutWeight {
  variationId: string;
  percentage: number; // 0 to 100
}

export interface FlagEnvironmentConfig {
  id: string;
  flagId: string;
  environmentId: string;
  enabled: boolean;
  killSwitchActive: boolean;
  killSwitchVariationId: string;
  defaultVariationId: string;
  rolloutPercentage: number; // 0..100 for primary rollout variation
  rolloutVariationId: string;
  rolloutWeights: RolloutWeight[];
  individualTargets: IndividualTarget[];
  targetingRules: TargetingRule[];
  version: number;
  updatedAt: string;
  updatedBy: string;
  lastEvaluatedAt: string | null;
  fullRolloutSince: string | null;
}

export interface FeatureFlag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string;
  type: FlagType;
  variations: FlagVariation[];
  defaultVariationId: string;
  ownerId: string;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSegment {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string;
  includedUsers: string[];
  excludedUsers: string[];
  rootGroup: RuleGroup;
  createdAt: string;
  updatedAt: string;
}

export interface FlagVersion {
  id: string;
  flagId: string;
  environmentId: string;
  version: number;
  authorId: string;
  authorName: string;
  reason: string;
  beforeSnapshot: FlagEnvironmentConfig | null;
  afterSnapshot: FlagEnvironmentConfig;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  flagId: string;
  flagKey: string;
  flagName: string;
  projectId: string;
  environmentId: string;
  environmentName: string;
  authorId: string;
  authorName: string;
  reason: string;
  status: ApprovalStatus;
  beforeConfig: FlagEnvironmentConfig;
  proposedConfig: FlagEnvironmentConfig;
  reviewerId?: string;
  reviewerName?: string;
  reviewComment?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface ScheduledChange {
  id: string;
  flagId: string;
  flagKey: string;
  environmentId: string;
  environmentName: string;
  authorId: string;
  authorName: string;
  reason: string;
  scheduledFor: string;
  status: ScheduleStatus;
  patch: Partial<FlagEnvironmentConfig>;
  createdAt: string;
  executedAt?: string;
}

export interface SdkInstance {
  id: string;
  instanceName: string;
  sdkKey: string;
  environmentId: string;
  projectId: string;
  sdkVersion: string;
  transport: 'SSE' | 'POLLING';
  status: 'CONNECTED' | 'DEGRADED' | 'OFFLINE';
  lastSyncAt: string;
  lastSyncLatencyMs: number;
  connectedAt: string;
}

export interface Experiment {
  id: string;
  projectId: string;
  environmentId: string;
  flagId: string;
  flagKey: string;
  name: string;
  hypothesis: string;
  metricName: string;
  controlVariationId: string;
  treatmentVariationId: string;
  expectedSplit: Record<string, number>; // variationId -> expected % (e.g. 50/50)
  status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
  startedAt: string;
}

export interface ExposureEvent {
  id: string;
  experimentId: string;
  flagKey: string;
  userKey: string;
  variationId: string;
  timestamp: string;
}

export interface ConversionEvent {
  id: string;
  experimentId: string;
  flagKey: string;
  userKey: string;
  variationId: string;
  value: number;
  timestamp: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface EvaluationContext {
  userKey: string;
  attributes: Record<string, string | number | boolean | string[]>;
}

export type EvaluationReason =
  | 'KILL_SWITCH'
  | 'FLAG_DISABLED'
  | 'INDIVIDUAL_TARGET'
  | 'SEGMENT_RULE'
  | 'PERCENTAGE_ROLLOUT'
  | 'DEFAULT_VARIATION'
  | 'FALLBACK_DEFAULT';

export interface EvaluationResult {
  flagKey: string;
  variationId: string;
  variationKey: string;
  value: boolean | string | number | Record<string, unknown>;
  reason: EvaluationReason;
  matchedRuleId?: string;
  matchedRuleName?: string;
  bucket?: number;
  evaluationTimeMicros: number;
}

export interface SdkSnapshot {
  environmentId: string;
  environmentKey: string;
  projectId: string;
  generatedAt: string;
  revision: number;
  flags: Array<{
    flag: FeatureFlag;
    config: FlagEnvironmentConfig;
  }>;
  segments: UserSegment[];
}

export interface StaleFlagReport {
  flagId: string;
  flagKey: string;
  flagName: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  ownerName: string;
  lastEvaluatedAt: string | null;
  daysSinceEvaluation: number | null;
  rolloutPercentage: number;
  daysAtFullRollout: number | null;
  staleReason: 'NOT_EVALUATED_30D' | 'FULL_ROLLOUT_14D' | 'BOTH';
  recommendation: string;
}
