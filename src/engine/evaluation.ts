/**
 * FlagShip Evaluation Engine — Chain of Responsibility & Builder Patterns (FR2, FR3, QA1, QA4).
 *
 * Strict 5-stage evaluation order:
 *   1. Kill Switch (and global disabled check)
 *   2. Individual User Targets
 *   3. Segment & Targeting Rules (sorted by priority)
 *   4. Sticky Percentage Rollout (deterministic MurmurHash3)
 *   5. Default Variation
 */

import type {
  EvaluationContext,
  EvaluationReason,
  EvaluationResult,
  FeatureFlag,
  FlagEnvironmentConfig,
  FlagVariation,
  UserSegment,
} from '../types/flagship';
import { type BucketingStrategy, defaultBucketingStrategy } from './hashing';
import {
  acceptRuleNode,
  defaultOperatorRegistry,
  evaluateSegment,
  type OperatorRegistry,
  RuleEvaluationVisitor,
} from './targeting';

// Builder Pattern for EvaluationContext construction
export class EvaluationContextBuilder {
  private userKey = '';
  private attributes: Record<string, string | number | boolean | string[]> = {};

  static create(userKey: string): EvaluationContextBuilder {
    return new EvaluationContextBuilder().withUserKey(userKey);
  }

  withUserKey(userKey: string): this {
    this.userKey = userKey;
    return this;
  }

  withAttribute(key: string, value: string | number | boolean | string[]): this {
    this.attributes[key] = value;
    return this;
  }

  withAttributes(attrs: Record<string, string | number | boolean | string[]>): this {
    Object.assign(this.attributes, attrs);
    return this;
  }

  build(): EvaluationContext {
    if (!this.userKey.trim()) {
      throw new Error('EvaluationContext requires a non-empty userKey');
    }
    return {
      userKey: this.userKey,
      attributes: { ...this.attributes },
    };
  }
}

interface EvaluationRequest {
  flag: FeatureFlag;
  config: FlagEnvironmentConfig;
  context: EvaluationContext;
  segmentsById: Map<string, UserSegment>;
  variationMap: Map<string, FlagVariation>;
  bucketing: BucketingStrategy;
  operators: OperatorRegistry;
}

interface PartialEval {
  variationId: string;
  reason: EvaluationReason;
  matchedRuleId?: string;
  matchedRuleName?: string;
  bucket?: number;
}

abstract class EvaluationHandler {
  private nextHandler: EvaluationHandler | null = null;

  setNext(handler: EvaluationHandler): EvaluationHandler {
    this.nextHandler = handler;
    return handler;
  }

  handle(req: EvaluationRequest): PartialEval | null {
    const result = this.process(req);
    if (result) return result;
    return this.nextHandler ? this.nextHandler.handle(req) : null;
  }

  protected abstract process(req: EvaluationRequest): PartialEval | null;
}

class KillSwitchHandler extends EvaluationHandler {
  protected process(req: EvaluationRequest): PartialEval | null {
    if (req.config.killSwitchActive) {
      return {
        variationId: req.config.killSwitchVariationId || req.config.defaultVariationId,
        reason: 'KILL_SWITCH',
      };
    }
    if (!req.config.enabled) {
      return {
        variationId: req.config.defaultVariationId || req.flag.defaultVariationId,
        reason: 'FLAG_DISABLED',
      };
    }
    return null;
  }
}

class IndividualTargetHandler extends EvaluationHandler {
  protected process(req: EvaluationRequest): PartialEval | null {
    const { userKey } = req.context;
    for (let i = 0; i < req.config.individualTargets.length; i++) {
      const target = req.config.individualTargets[i];
      if (target.userKeys.includes(userKey)) {
        return {
          variationId: target.variationId,
          reason: 'INDIVIDUAL_TARGET',
        };
      }
    }
    return null;
  }
}

class SegmentAndRuleHandler extends EvaluationHandler {
  protected process(req: EvaluationRequest): PartialEval | null {
    const rules = req.config.targetingRules;
    if (!rules || rules.length === 0) return null;

    // Evaluate enabled rules in ascending priority order
    const ordered = rules.length > 1 ? [...rules].sort((a, b) => a.priority - b.priority) : rules;
    const visitor = new RuleEvaluationVisitor(req.context, req.operators);

    for (let i = 0; i < ordered.length; i++) {
      const rule = ordered[i];
      if (!rule.enabled) continue;

      let segmentsMatch = true;
      if (rule.segmentIds && rule.segmentIds.length > 0) {
        segmentsMatch = rule.segmentIds.every((segId) => {
          const seg = req.segmentsById.get(segId);
          return seg ? evaluateSegment(seg, req.context, req.operators) : false;
        });
      }

      if (!segmentsMatch) continue;

      const conditionsMatch =
        rule.rootGroup.children.length === 0 || acceptRuleNode(rule.rootGroup, visitor);

      if (conditionsMatch) {
        return {
          variationId: rule.serveVariationId,
          reason: 'SEGMENT_RULE',
          matchedRuleId: rule.id,
          matchedRuleName: rule.name,
        };
      }
    }
    return null;
  }
}

class PercentageRolloutHandler extends EvaluationHandler {
  protected process(req: EvaluationRequest): PartialEval | null {
    const { config, flag, context, bucketing } = req;
    const bucket = bucketing.computeBucket(flag.key, context.userKey);

    // Multi-variation weighted rollout takes precedence if configured with > 0 total weight
    if (config.rolloutWeights && config.rolloutWeights.length > 0) {
      const totalWeight = config.rolloutWeights.reduce((acc, w) => acc + Math.max(0, w.percentage), 0);
      if (totalWeight > 0) {
        let cumulative = 0;
        for (let i = 0; i < config.rolloutWeights.length; i++) {
          const weight = config.rolloutWeights[i];
          cumulative += Math.max(0, weight.percentage);
          if (bucket < cumulative) {
            return {
              variationId: weight.variationId,
              reason: 'PERCENTAGE_ROLLOUT',
              bucket,
            };
          }
        }
        return {
          variationId: config.defaultVariationId || flag.defaultVariationId,
          reason: 'DEFAULT_VARIATION',
          bucket,
        };
      }
    }

    // Simple 0..100% sticky gradual rollout
    if (config.rolloutPercentage > 0) {
      if (bucket < config.rolloutPercentage) {
        return {
          variationId: config.rolloutVariationId || config.defaultVariationId,
          reason: 'PERCENTAGE_ROLLOUT',
          bucket,
        };
      }
      return {
        variationId: config.defaultVariationId || flag.defaultVariationId,
        reason: 'DEFAULT_VARIATION',
        bucket,
      };
    }

    return null;
  }
}

class DefaultVariationHandler extends EvaluationHandler {
  protected process(req: EvaluationRequest): PartialEval {
    return {
      variationId: req.config.defaultVariationId || req.flag.defaultVariationId,
      reason: 'DEFAULT_VARIATION',
    };
  }
}

export class FlagEvaluationEngine {
  private readonly chain: EvaluationHandler;

  constructor(
    private readonly bucketing: BucketingStrategy = defaultBucketingStrategy,
    private readonly operators: OperatorRegistry = defaultOperatorRegistry,
  ) {
    const killSwitch = new KillSwitchHandler();
    const individual = new IndividualTargetHandler();
    const segmentRules = new SegmentAndRuleHandler();
    const rollout = new PercentageRolloutHandler();
    const fallback = new DefaultVariationHandler();

    killSwitch.setNext(individual).setNext(segmentRules).setNext(rollout).setNext(fallback);
    this.chain = killSwitch;
  }

  evaluate(
    flag: FeatureFlag,
    config: FlagEnvironmentConfig,
    context: EvaluationContext,
    segmentsById: Map<string, UserSegment>,
  ): EvaluationResult {
    const start = performance.now();
    const variationMap = new Map<string, FlagVariation>();
    for (let i = 0; i < flag.variations.length; i++) {
      variationMap.set(flag.variations[i].id, flag.variations[i]);
    }

    const partial = this.chain.handle({
      flag,
      config,
      context,
      segmentsById,
      variationMap,
      bucketing: this.bucketing,
      operators: this.operators,
    });

    const chosenId = partial?.variationId ?? flag.defaultVariationId;
    const variation = variationMap.get(chosenId) ?? flag.variations[0];
    const elapsedMicros = Math.max(0.1, Number(((performance.now() - start) * 1000).toFixed(2)));

    return {
      flagKey: flag.key,
      variationId: variation.id,
      variationKey: variation.key,
      value: variation.value,
      reason: partial?.reason ?? 'DEFAULT_VARIATION',
      matchedRuleId: partial?.matchedRuleId,
      matchedRuleName: partial?.matchedRuleName,
      bucket: partial?.bucket,
      evaluationTimeMicros: elapsedMicros,
    };
  }
}

export const defaultEvaluationEngine = new FlagEvaluationEngine();
