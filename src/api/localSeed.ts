import type {
  AuditLog,
  ChangeRequest,
  ConversionEvent,
  Environment,
  Experiment,
  ExposureEvent,
  FeatureFlag,
  FlagEnvironmentConfig,
  FlagVersion,
  Project,
  ProjectMember,
  ScheduledChange,
  SdkInstance,
  User,
  UserSegment,
} from '../types/flagship';

export interface LocalFlagShipDatabase {
  users: User[];
  projects: Project[];
  projectMembers: ProjectMember[];
  environments: Environment[];
  flags: FeatureFlag[];
  flagConfigs: FlagEnvironmentConfig[];
  segments: UserSegment[];
  versions: FlagVersion[];
  changeRequests: ChangeRequest[];
  scheduledChanges: ScheduledChange[];
  sdkInstances: SdkInstance[];
  experiments: Experiment[];
  exposures: ExposureEvent[];
  conversions: ConversionEvent[];
  auditLogs: AuditLog[];
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/** Browser-safe deterministic password hash for static GitHub Pages demo runtime */
export function hashBrowserPassword(password: string): string {
  let h1 = 0xdeadbeef ^ password.length;
  let h2 = 0x41c6ce57 ^ password.length;
  for (let i = 0; i < password.length; i++) {
    const ch = password.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `browser:${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export function randomHex(bytes = 6): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildLocalSeedDatabase(): LocalFlagShipDatabase {
  const demoPass = hashBrowserPassword('flagship123');

  const users: User[] = [
    {
      id: 'usr-admin',
      email: 'admin@flagship.io',
      name: 'Nadia Rahman',
      role: 'ADMIN',
      passwordHash: demoPass,
      createdAt: daysAgoIso(90),
      active: true,
    },
    {
      id: 'usr-approver',
      email: 'approver@flagship.io',
      name: 'Marcus Chen',
      role: 'APPROVER',
      passwordHash: demoPass,
      createdAt: daysAgoIso(85),
      active: true,
    },
    {
      id: 'usr-editor',
      email: 'editor@flagship.io',
      name: 'Elena Rostova',
      role: 'EDITOR',
      passwordHash: demoPass,
      createdAt: daysAgoIso(70),
      active: true,
    },
    {
      id: 'usr-viewer',
      email: 'viewer@flagship.io',
      name: 'Tariq Hassan',
      role: 'VIEWER',
      passwordHash: demoPass,
      createdAt: daysAgoIso(60),
      active: true,
    },
  ];

  const projects: Project[] = [
    {
      id: 'proj-commerce',
      key: 'core-commerce',
      name: 'Core Commerce',
      description: 'Storefront checkout, pricing tiers, and order fulfillment services.',
      ownerId: 'usr-admin',
      archived: false,
      createdAt: daysAgoIso(90),
      updatedAt: daysAgoIso(1),
    },
    {
      id: 'proj-mobile',
      key: 'mobile-platform',
      name: 'Mobile Platform',
      description: 'iOS and Android BFF gateway, push notifications, and offline caching.',
      ownerId: 'usr-approver',
      archived: false,
      createdAt: daysAgoIso(75),
      updatedAt: daysAgoIso(2),
    },
  ];

  const projectMembers: ProjectMember[] = [
    { id: 'pm-1', projectId: 'proj-commerce', userId: 'usr-admin', role: 'ADMIN', assignedAt: daysAgoIso(90) },
    { id: 'pm-2', projectId: 'proj-commerce', userId: 'usr-approver', role: 'APPROVER', assignedAt: daysAgoIso(85) },
    { id: 'pm-3', projectId: 'proj-commerce', userId: 'usr-editor', role: 'EDITOR', assignedAt: daysAgoIso(70) },
    { id: 'pm-4', projectId: 'proj-commerce', userId: 'usr-viewer', role: 'VIEWER', assignedAt: daysAgoIso(60) },
    { id: 'pm-5', projectId: 'proj-mobile', userId: 'usr-admin', role: 'ADMIN', assignedAt: daysAgoIso(75) },
    { id: 'pm-6', projectId: 'proj-mobile', userId: 'usr-approver', role: 'APPROVER', assignedAt: daysAgoIso(75) },
    { id: 'pm-7', projectId: 'proj-mobile', userId: 'usr-editor', role: 'EDITOR', assignedAt: daysAgoIso(65) },
  ];

  const environments: Environment[] = [
    {
      id: 'env-com-dev',
      projectId: 'proj-commerce',
      key: 'development',
      name: 'Development',
      type: 'DEVELOPMENT',
      sdkKey: 'fs_dev_com_8a7f91c2e4b0',
      requiresApproval: false,
      createdAt: daysAgoIso(90),
    },
    {
      id: 'env-com-stg',
      projectId: 'proj-commerce',
      key: 'staging',
      name: 'Staging',
      type: 'STAGING',
      sdkKey: 'fs_stg_com_3d12e8f7b9a1',
      requiresApproval: false,
      createdAt: daysAgoIso(90),
    },
    {
      id: 'env-com-prod',
      projectId: 'proj-commerce',
      key: 'production',
      name: 'Production',
      type: 'PRODUCTION',
      sdkKey: 'fs_prod_com_9f44c1d8a7e2',
      requiresApproval: true,
      createdAt: daysAgoIso(90),
    },
    {
      id: 'env-mob-dev',
      projectId: 'proj-mobile',
      key: 'development',
      name: 'Development',
      type: 'DEVELOPMENT',
      sdkKey: 'fs_dev_mob_4c21a9b8e1f0',
      requiresApproval: false,
      createdAt: daysAgoIso(75),
    },
    {
      id: 'env-mob-stg',
      projectId: 'proj-mobile',
      key: 'staging',
      name: 'Staging',
      type: 'STAGING',
      sdkKey: 'fs_stg_mob_6e33b2c4d9f1',
      requiresApproval: false,
      createdAt: daysAgoIso(75),
    },
    {
      id: 'env-mob-prod',
      projectId: 'proj-mobile',
      key: 'production',
      name: 'Production',
      type: 'PRODUCTION',
      sdkKey: 'fs_prod_mob_7b91e5a2c3d4',
      requiresApproval: true,
      createdAt: daysAgoIso(75),
    },
  ];

  const segments: UserSegment[] = [
    {
      id: 'seg-enterprise-beta',
      projectId: 'proj-commerce',
      key: 'enterprise-beta',
      name: 'Enterprise Beta Cohort',
      description: 'Enterprise tier accounts running client version > 2.0.0 in NA/EU.',
      includedUsers: ['vip-acme-01', 'cto@globex.io'],
      excludedUsers: ['qa-blocked-01'],
      rootGroup: {
        kind: 'group',
        id: 'sg-1',
        logicalOp: 'AND',
        children: [
          { kind: 'condition', id: 'sc-1', attribute: 'plan', operator: 'EQUALS', values: ['enterprise'] },
          { kind: 'condition', id: 'sc-2', attribute: 'appVersion', operator: 'SEMVER_GREATER_THAN', values: ['2.0.0'] },
          { kind: 'condition', id: 'sc-3', attribute: 'country', operator: 'IN', values: ['US', 'CA', 'GB', 'DE'] },
        ],
      },
      createdAt: daysAgoIso(45),
      updatedAt: daysAgoIso(3),
    },
    {
      id: 'seg-internal-qa',
      projectId: 'proj-commerce',
      key: 'internal-qa',
      name: 'Internal QA & Staff',
      description: 'FlagShip staff accounts verified via company domain regex.',
      includedUsers: ['qa-lead@flagship.io'],
      excludedUsers: [],
      rootGroup: {
        kind: 'group',
        id: 'sg-2',
        logicalOp: 'OR',
        children: [
          { kind: 'condition', id: 'sc-4', attribute: 'email', operator: 'REGEX', values: ['^.+@flagship\\.io$'] },
          { kind: 'condition', id: 'sc-5', attribute: 'role', operator: 'EQUALS', values: ['qa_engineer'] },
        ],
      },
      createdAt: daysAgoIso(60),
      updatedAt: daysAgoIso(10),
    },
    {
      id: 'seg-mobile-early',
      projectId: 'proj-mobile',
      key: 'mobile-early-adopters',
      name: 'Mobile Early Adopters',
      description: 'Users who joined before mid-2026 running iOS/Android >= 4.2.0.',
      includedUsers: [],
      excludedUsers: [],
      rootGroup: {
        kind: 'group',
        id: 'sg-3',
        logicalOp: 'AND',
        children: [
          { kind: 'condition', id: 'sc-6', attribute: 'appVersion', operator: 'SEMVER_GREATER_THAN', values: ['4.1.9'] },
          { kind: 'condition', id: 'sc-7', attribute: 'joinedAt', operator: 'DATE_BEFORE', values: ['2026-07-01T00:00:00Z'] },
        ],
      },
      createdAt: daysAgoIso(40),
      updatedAt: daysAgoIso(4),
    },
  ];

  const flags: FeatureFlag[] = [
    {
      id: 'flg-checkout',
      projectId: 'proj-commerce',
      key: 'new-checkout-flow',
      name: 'One-Step Checkout Flow',
      description: 'Streamlined single-page checkout with saved payment intents and express shipping.',
      type: 'BOOLEAN',
      variations: [
        { id: 'v-chk-on', key: 'enabled', name: 'One-Step Checkout', value: true },
        { id: 'v-chk-off', key: 'disabled', name: 'Legacy Multi-Step', value: false },
      ],
      defaultVariationId: 'v-chk-off',
      ownerId: 'usr-editor',
      tags: ['checkout', 'revenue'],
      archived: false,
      createdAt: daysAgoIso(35),
      updatedAt: daysAgoIso(1),
    },
    {
      id: 'flg-homepage',
      projectId: 'proj-commerce',
      key: 'homepage-layout',
      name: 'Homepage Layout Variant',
      description: 'Multivariate storefront hero layout for Q4 conversion experiment.',
      type: 'STRING',
      variations: [
        { id: 'v-hp-classic', key: 'classic', name: 'Classic Grid', value: 'classic-grid' },
        { id: 'v-hp-editorial', key: 'editorial', name: 'Editorial Split', value: 'editorial-split' },
        { id: 'v-hp-compact', key: 'compact', name: 'Compact Catalog', value: 'compact-catalog' },
      ],
      defaultVariationId: 'v-hp-classic',
      ownerId: 'usr-admin',
      tags: ['storefront', 'experiment'],
      archived: false,
      createdAt: daysAgoIso(28),
      updatedAt: daysAgoIso(2),
    },
    {
      id: 'flg-ratelimit',
      projectId: 'proj-commerce',
      key: 'api-rate-limit-rpm',
      name: 'Checkout API Rate Limit (RPM)',
      description: 'Dynamic per-tenant requests-per-minute threshold enforced at gateway.',
      type: 'NUMBER',
      variations: [
        { id: 'v-rl-std', key: 'standard', name: 'Standard (120 RPM)', value: 120 },
        { id: 'v-rl-burst', key: 'burst', name: 'Burst (600 RPM)', value: 600 },
        { id: 'v-rl-ent', key: 'enterprise', name: 'Enterprise (2400 RPM)', value: 2400 },
      ],
      defaultVariationId: 'v-rl-std',
      ownerId: 'usr-approver',
      tags: ['gateway', 'ops'],
      archived: false,
      createdAt: daysAgoIso(50),
      updatedAt: daysAgoIso(5),
    },
    {
      id: 'flg-pricing',
      projectId: 'proj-commerce',
      key: 'shipping-rules-config',
      name: 'Dynamic Shipping Rules JSON',
      description: 'Structured free-shipping thresholds and express carrier multipliers.',
      type: 'JSON',
      variations: [
        {
          id: 'v-pr-default',
          key: 'standard',
          name: 'Standard Shipping Rules',
          value: { freeThresholdUsd: 75, expressMultiplier: 1.5, carriers: ['UPS', 'FedEx'] },
        },
        {
          id: 'v-pr-holiday',
          key: 'holiday',
          name: 'Holiday Free Express',
          value: { freeThresholdUsd: 40, expressMultiplier: 1.0, carriers: ['UPS', 'FedEx', 'DHL'] },
        },
      ],
      defaultVariationId: 'v-pr-default',
      ownerId: 'usr-editor',
      tags: ['fulfillment', 'config'],
      archived: false,
      createdAt: daysAgoIso(22),
      updatedAt: daysAgoIso(2),
    },
    {
      id: 'flg-refund',
      projectId: 'proj-commerce',
      key: 'instant-refund-engine',
      name: 'Instant Refund Engine',
      description: 'Automated sub-second store credit refund pipeline with circuit breaker kill switch.',
      type: 'BOOLEAN',
      variations: [
        { id: 'v-ref-on', key: 'enabled', name: 'Automated Refunds', value: true },
        { id: 'v-ref-off', key: 'disabled', name: 'Manual Review Queue', value: false },
      ],
      defaultVariationId: 'v-ref-off',
      ownerId: 'usr-admin',
      tags: ['payments', 'critical'],
      archived: false,
      createdAt: daysAgoIso(18),
      updatedAt: daysAgoIso(1),
    },
    {
      id: 'flg-legacy-banner',
      projectId: 'proj-commerce',
      key: 'legacy-summer-banner',
      name: 'Summer Clearance Banner',
      description: 'Seasonal campaign flag no longer referenced by storefront.',
      type: 'BOOLEAN',
      variations: [
        { id: 'v-lb-on', key: 'on', name: 'Visible', value: true },
        { id: 'v-lb-off', key: 'off', name: 'Hidden', value: false },
      ],
      defaultVariationId: 'v-lb-off',
      ownerId: 'usr-editor',
      tags: ['marketing', 'cleanup'],
      archived: false,
      createdAt: daysAgoIso(110),
      updatedAt: daysAgoIso(62),
    },
    {
      id: 'flg-dark-mobile',
      projectId: 'proj-mobile',
      key: 'mobile-offline-sync-v2',
      name: 'Mobile Offline Queue Sync v2',
      description: 'Background SQLite queue synchronization for intermittent networks.',
      type: 'BOOLEAN',
      variations: [
        { id: 'v-ms-on', key: 'on', name: 'Sync v2', value: true },
        { id: 'v-ms-off', key: 'off', name: 'Legacy Sync', value: false },
      ],
      defaultVariationId: 'v-ms-off',
      ownerId: 'usr-approver',
      tags: ['mobile', 'resilience'],
      archived: false,
      createdAt: daysAgoIso(48),
      updatedAt: daysAgoIso(25),
    },
  ];

  const makeConfig = (
    id: string,
    flag: FeatureFlag,
    envId: string,
    overrides: Partial<FlagEnvironmentConfig> = {},
  ): FlagEnvironmentConfig => ({
    id,
    flagId: flag.id,
    environmentId: envId,
    enabled: true,
    killSwitchActive: false,
    killSwitchVariationId: flag.defaultVariationId,
    defaultVariationId: flag.defaultVariationId,
    rolloutPercentage: 100,
    rolloutVariationId: flag.variations[0].id,
    rolloutWeights: [],
    individualTargets: [],
    targetingRules: [],
    version: 1,
    updatedAt: daysAgoIso(2),
    updatedBy: 'usr-admin',
    lastEvaluatedAt: daysAgoIso(0),
    fullRolloutSince: null,
    ...overrides,
  });

  const flagConfigs: FlagEnvironmentConfig[] = [
    makeConfig('cfg-chk-dev', flags[0], 'env-com-dev', { rolloutPercentage: 100, version: 4 }),
    makeConfig('cfg-chk-stg', flags[0], 'env-com-stg', { rolloutPercentage: 75, version: 3 }),
    makeConfig('cfg-chk-prod', flags[0], 'env-com-prod', {
      rolloutPercentage: 50,
      version: 5,
      individualTargets: [{ variationId: 'v-chk-on', userKeys: ['vip-user-01', 'alice@acme.io'] }],
      targetingRules: [
        {
          id: 'rule-chk-1',
          name: 'Enterprise Beta Early Access',
          priority: 1,
          segmentIds: ['seg-enterprise-beta'],
          serveVariationId: 'v-chk-on',
          enabled: true,
          rootGroup: {
            kind: 'group',
            id: 'rg-chk-1',
            logicalOp: 'AND',
            children: [
              { kind: 'condition', id: 'rc-chk-1', attribute: 'country', operator: 'NOT_EQUALS', values: ['AQ'] },
            ],
          },
        },
        {
          id: 'rule-chk-2',
          name: 'Internal QA Override',
          priority: 2,
          segmentIds: ['seg-internal-qa'],
          serveVariationId: 'v-chk-on',
          enabled: true,
          rootGroup: { kind: 'group', id: 'rg-chk-2', logicalOp: 'AND', children: [] },
        },
      ],
    }),
    makeConfig('cfg-hp-dev', flags[1], 'env-com-dev', { rolloutPercentage: 100, rolloutVariationId: 'v-hp-editorial', version: 2 }),
    makeConfig('cfg-hp-stg', flags[1], 'env-com-stg', { rolloutPercentage: 50, rolloutVariationId: 'v-hp-editorial', version: 2 }),
    makeConfig('cfg-hp-prod', flags[1], 'env-com-prod', {
      rolloutPercentage: 0,
      rolloutWeights: [
        { variationId: 'v-hp-classic', percentage: 50 },
        { variationId: 'v-hp-editorial', percentage: 35 },
        { variationId: 'v-hp-compact', percentage: 15 },
      ],
      version: 3,
    }),
    makeConfig('cfg-rl-dev', flags[2], 'env-com-dev', { rolloutPercentage: 100, rolloutVariationId: 'v-rl-ent' }),
    makeConfig('cfg-rl-stg', flags[2], 'env-com-stg', { rolloutPercentage: 100, rolloutVariationId: 'v-rl-burst' }),
    makeConfig('cfg-rl-prod', flags[2], 'env-com-prod', {
      rolloutPercentage: 20,
      rolloutVariationId: 'v-rl-burst',
      targetingRules: [
        {
          id: 'rule-rl-ent',
          name: 'Enterprise High Throughput',
          priority: 1,
          segmentIds: ['seg-enterprise-beta'],
          serveVariationId: 'v-rl-ent',
          enabled: true,
          rootGroup: { kind: 'group', id: 'rg-rl-1', logicalOp: 'AND', children: [] },
        },
      ],
      version: 2,
    }),
    makeConfig('cfg-pr-dev', flags[3], 'env-com-dev', { rolloutPercentage: 100, rolloutVariationId: 'v-pr-holiday' }),
    makeConfig('cfg-pr-stg', flags[3], 'env-com-stg', { rolloutPercentage: 100, rolloutVariationId: 'v-pr-holiday' }),
    makeConfig('cfg-pr-prod', flags[3], 'env-com-prod', { rolloutPercentage: 30, rolloutVariationId: 'v-pr-holiday', version: 2 }),
    makeConfig('cfg-ref-dev', flags[4], 'env-com-dev', { rolloutPercentage: 100 }),
    makeConfig('cfg-ref-stg', flags[4], 'env-com-stg', { rolloutPercentage: 50 }),
    makeConfig('cfg-ref-prod', flags[4], 'env-com-prod', { rolloutPercentage: 15, version: 3 }),
    makeConfig('cfg-lb-dev', flags[5], 'env-com-dev', { enabled: false, rolloutPercentage: 0, lastEvaluatedAt: daysAgoIso(58) }),
    makeConfig('cfg-lb-stg', flags[5], 'env-com-stg', { enabled: false, rolloutPercentage: 0, lastEvaluatedAt: daysAgoIso(55) }),
    makeConfig('cfg-lb-prod', flags[5], 'env-com-prod', { enabled: false, rolloutPercentage: 0, lastEvaluatedAt: daysAgoIso(54) }),
    makeConfig('cfg-ms-dev', flags[6], 'env-mob-dev', { rolloutPercentage: 100, fullRolloutSince: daysAgoIso(32) }),
    makeConfig('cfg-ms-stg', flags[6], 'env-mob-stg', { rolloutPercentage: 100, fullRolloutSince: daysAgoIso(28) }),
    makeConfig('cfg-ms-prod', flags[6], 'env-mob-prod', { rolloutPercentage: 100, fullRolloutSince: daysAgoIso(26), version: 6 }),
  ];

  const prodCheckoutCfg = flagConfigs.find((c) => c.id === 'cfg-chk-prod')!;
  const prodRefundCfg = flagConfigs.find((c) => c.id === 'cfg-ref-prod')!;

  const versions: FlagVersion[] = [
    {
      id: 'ver-1',
      flagId: 'flg-checkout',
      environmentId: 'env-com-prod',
      version: 4,
      authorId: 'usr-editor',
      authorName: 'Elena Rostova',
      reason: 'Expanded sticky rollout from 10% to 25% after zero checkout error spike.',
      beforeSnapshot: { ...prodCheckoutCfg, rolloutPercentage: 10, version: 3 },
      afterSnapshot: { ...prodCheckoutCfg, rolloutPercentage: 25, version: 4 },
      createdAt: daysAgoIso(5),
    },
    {
      id: 'ver-2',
      flagId: 'flg-checkout',
      environmentId: 'env-com-prod',
      version: 5,
      authorId: 'usr-approver',
      authorName: 'Marcus Chen',
      reason: 'Approved rollout expansion from 25% to 50% for Q4 conversion experiment.',
      beforeSnapshot: { ...prodCheckoutCfg, rolloutPercentage: 25, version: 4 },
      afterSnapshot: prodCheckoutCfg,
      createdAt: daysAgoIso(1),
    },
    {
      id: 'ver-3',
      flagId: 'flg-refund',
      environmentId: 'env-com-prod',
      version: 3,
      authorId: 'usr-admin',
      authorName: 'Nadia Rahman',
      reason: 'Initial 15% canary rollout of automated refunds.',
      beforeSnapshot: { ...prodRefundCfg, rolloutPercentage: 0, enabled: false, version: 2 },
      afterSnapshot: prodRefundCfg,
      createdAt: daysAgoIso(2),
    },
  ];

  const changeRequests: ChangeRequest[] = [
    {
      id: 'cr-101',
      flagId: 'flg-checkout',
      flagKey: 'new-checkout-flow',
      flagName: 'One-Step Checkout Flow',
      projectId: 'proj-commerce',
      environmentId: 'env-com-prod',
      environmentName: 'Production',
      authorId: 'usr-editor',
      authorName: 'Elena Rostova',
      reason: 'Increase Production rollout from 50% to 75% following statistically significant +24% conversion lift.',
      status: 'PENDING',
      beforeConfig: prodCheckoutCfg,
      proposedConfig: { ...prodCheckoutCfg, rolloutPercentage: 75, version: prodCheckoutCfg.version + 1 },
      createdAt: daysAgoIso(0),
    },
    {
      id: 'cr-102',
      flagId: 'flg-refund',
      flagKey: 'instant-refund-engine',
      flagName: 'Instant Refund Engine',
      projectId: 'proj-commerce',
      environmentId: 'env-com-prod',
      environmentName: 'Production',
      authorId: 'usr-admin',
      authorName: 'Nadia Rahman',
      reason: 'Expand automated refund canary from 15% to 35% (authored by Admin — demonstrates self-approval guard).',
      status: 'PENDING',
      beforeConfig: prodRefundCfg,
      proposedConfig: { ...prodRefundCfg, rolloutPercentage: 35, version: prodRefundCfg.version + 1 },
      createdAt: daysAgoIso(0),
    },
  ];

  const scheduledChanges: ScheduledChange[] = [
    {
      id: 'sch-1',
      flagId: 'flg-pricing',
      flagKey: 'shipping-rules-config',
      environmentId: 'env-com-stg',
      environmentName: 'Staging',
      authorId: 'usr-editor',
      authorName: 'Elena Rostova',
      reason: 'Enable Holiday Free Express shipping rules for weekend load test.',
      scheduledFor: hoursFromNowIso(24),
      status: 'SCHEDULED',
      patch: { rolloutPercentage: 100, rolloutVariationId: 'v-pr-holiday' },
      createdAt: daysAgoIso(1),
    },
    {
      id: 'sch-2',
      flagId: 'flg-checkout',
      flagKey: 'new-checkout-flow',
      environmentId: 'env-com-dev',
      environmentName: 'Development',
      authorId: 'usr-admin',
      authorName: 'Nadia Rahman',
      reason: 'Full enablement in dev ahead of integration sprint.',
      scheduledFor: daysAgoIso(3),
      status: 'EXECUTED',
      patch: { enabled: true, rolloutPercentage: 100 },
      createdAt: daysAgoIso(4),
      executedAt: daysAgoIso(3),
    },
  ];

  const sdkInstances: SdkInstance[] = [
    {
      id: 'sdk-inst-1',
      instanceName: 'checkout-service-prod-01',
      sdkKey: 'fs_prod_com_9f44c1d8a7e2',
      environmentId: 'env-com-prod',
      projectId: 'proj-commerce',
      sdkVersion: 'flagship-spring-boot-starter:1.0.0',
      transport: 'SSE',
      status: 'CONNECTED',
      lastSyncAt: new Date(Date.now() - 8_000).toISOString(),
      lastSyncLatencyMs: 14,
      connectedAt: daysAgoIso(4),
    },
    {
      id: 'sdk-inst-2',
      instanceName: 'checkout-service-prod-02',
      sdkKey: 'fs_prod_com_9f44c1d8a7e2',
      environmentId: 'env-com-prod',
      projectId: 'proj-commerce',
      sdkVersion: 'flagship-spring-boot-starter:1.0.0',
      transport: 'SSE',
      status: 'CONNECTED',
      lastSyncAt: new Date(Date.now() - 11_000).toISOString(),
      lastSyncLatencyMs: 19,
      connectedAt: daysAgoIso(4),
    },
    {
      id: 'sdk-inst-3',
      instanceName: 'gateway-staging-01',
      sdkKey: 'fs_stg_com_3d12e8f7b9a1',
      environmentId: 'env-com-stg',
      projectId: 'proj-commerce',
      sdkVersion: 'flagship-spring-boot-starter:1.0.0',
      transport: 'POLLING',
      status: 'CONNECTED',
      lastSyncAt: new Date(Date.now() - 25_000).toISOString(),
      lastSyncLatencyMs: 42,
      connectedAt: daysAgoIso(2),
    },
    {
      id: 'sdk-inst-4',
      instanceName: 'mobile-bff-prod-01',
      sdkKey: 'fs_prod_mob_7b91e5a2c3d4',
      environmentId: 'env-mob-prod',
      projectId: 'proj-mobile',
      sdkVersion: 'flagship-spring-boot-starter:1.0.0',
      transport: 'SSE',
      status: 'CONNECTED',
      lastSyncAt: new Date(Date.now() - 5_000).toISOString(),
      lastSyncLatencyMs: 12,
      connectedAt: daysAgoIso(6),
    },
  ];

  const experiments: Experiment[] = [
    {
      id: 'exp-checkout-q4',
      projectId: 'proj-commerce',
      environmentId: 'env-com-prod',
      flagId: 'flg-checkout',
      flagKey: 'new-checkout-flow',
      name: 'One-Step Checkout Conversion Lift',
      hypothesis: 'Reducing checkout from 3 pages to 1 page increases completed order rate by at least 15%.',
      metricName: 'order_completed',
      controlVariationId: 'v-chk-off',
      treatmentVariationId: 'v-chk-on',
      expectedSplit: { 'v-chk-off': 50, 'v-chk-on': 50 },
      status: 'RUNNING',
      startedAt: daysAgoIso(12),
    },
    {
      id: 'exp-homepage-hero',
      projectId: 'proj-commerce',
      environmentId: 'env-com-prod',
      flagId: 'flg-homepage',
      flagKey: 'homepage-layout',
      name: 'Homepage Hero Layout Split',
      hypothesis: 'Editorial split hero drives higher product click-through than classic grid.',
      metricName: 'product_click_through',
      controlVariationId: 'v-hp-classic',
      treatmentVariationId: 'v-hp-editorial',
      expectedSplit: { 'v-hp-classic': 50, 'v-hp-editorial': 50 },
      status: 'RUNNING',
      startedAt: daysAgoIso(7),
    },
  ];

  const exposures: ExposureEvent[] = [];
  const conversions: ConversionEvent[] = [];

  for (let i = 0; i < 620; i++) {
    exposures.push({
      id: `exp1-c-${i}`,
      experimentId: 'exp-checkout-q4',
      flagKey: 'new-checkout-flow',
      userKey: `buyer-c-${i}`,
      variationId: 'v-chk-off',
      timestamp: daysAgoIso(i % 12),
    });
    if (i < 72) {
      conversions.push({
        id: `conv1-c-${i}`,
        experimentId: 'exp-checkout-q4',
        flagKey: 'new-checkout-flow',
        userKey: `buyer-c-${i}`,
        variationId: 'v-chk-off',
        value: 1,
        timestamp: daysAgoIso(i % 12),
      });
    }
  }
  for (let i = 0; i < 614; i++) {
    exposures.push({
      id: `exp1-t-${i}`,
      experimentId: 'exp-checkout-q4',
      flagKey: 'new-checkout-flow',
      userKey: `buyer-t-${i}`,
      variationId: 'v-chk-on',
      timestamp: daysAgoIso(i % 12),
    });
    if (i < 104) {
      conversions.push({
        id: `conv1-t-${i}`,
        experimentId: 'exp-checkout-q4',
        flagKey: 'new-checkout-flow',
        userKey: `buyer-t-${i}`,
        variationId: 'v-chk-on',
        value: 1,
        timestamp: daysAgoIso(i % 12),
      });
    }
  }

  for (let i = 0; i < 440; i++) {
    exposures.push({
      id: `exp2-c-${i}`,
      experimentId: 'exp-homepage-hero',
      flagKey: 'homepage-layout',
      userKey: `visitor-c-${i}`,
      variationId: 'v-hp-classic',
      timestamp: daysAgoIso(i % 7),
    });
    if (i < 58) {
      conversions.push({
        id: `conv2-c-${i}`,
        experimentId: 'exp-homepage-hero',
        flagKey: 'homepage-layout',
        userKey: `visitor-c-${i}`,
        variationId: 'v-hp-classic',
        value: 1,
        timestamp: daysAgoIso(i % 7),
      });
    }
  }
  for (let i = 0; i < 310; i++) {
    exposures.push({
      id: `exp2-t-${i}`,
      experimentId: 'exp-homepage-hero',
      flagKey: 'homepage-layout',
      userKey: `visitor-t-${i}`,
      variationId: 'v-hp-editorial',
      timestamp: daysAgoIso(i % 7),
    });
    if (i < 49) {
      conversions.push({
        id: `conv2-t-${i}`,
        experimentId: 'exp-homepage-hero',
        flagKey: 'homepage-layout',
        userKey: `visitor-t-${i}`,
        variationId: 'v-hp-editorial',
        value: 1,
        timestamp: daysAgoIso(i % 7),
      });
    }
  }

  const auditLogs: AuditLog[] = [
    {
      id: 'aud-1',
      actorId: 'usr-approver',
      actorName: 'Marcus Chen',
      actorRole: 'APPROVER',
      action: 'APPROVAL_APPROVED',
      entityType: 'FlagEnvironmentConfig',
      entityId: 'cfg-chk-prod',
      summary: 'Approved rollout of new-checkout-flow to 50% in Production.',
      timestamp: daysAgoIso(1),
    },
    {
      id: 'aud-2',
      actorId: 'usr-editor',
      actorName: 'Elena Rostova',
      actorRole: 'EDITOR',
      action: 'CHANGE_REQUEST_CREATED',
      entityType: 'ChangeRequest',
      entityId: 'cr-101',
      summary: 'Submitted Production rollout request (50% -> 75%) for new-checkout-flow.',
      timestamp: daysAgoIso(0),
    },
    {
      id: 'aud-3',
      actorId: 'usr-admin',
      actorName: 'Nadia Rahman',
      actorRole: 'ADMIN',
      action: 'CHANGE_REQUEST_CREATED',
      entityType: 'ChangeRequest',
      entityId: 'cr-102',
      summary: 'Submitted Production canary expansion (15% -> 35%) for instant-refund-engine.',
      timestamp: daysAgoIso(0),
    },
  ];

  return {
    users,
    projects,
    projectMembers,
    environments,
    flags,
    flagConfigs,
    segments,
    versions,
    changeRequests,
    scheduledChanges,
    sdkInstances,
    experiments,
    exposures,
    conversions,
    auditLogs,
  };
}
