/**
 * Targeting Engine — Strategy, Composite, and Visitor Patterns (FR2).
 *
 * - Strategy: OperatorStrategy registry supporting all 8 required operators
 *   (EQUALS, NOT_EQUALS, IN, CONTAINS, SEMVER_GREATER_THAN, REGEX, DATE_BEFORE, DATE_AFTER)
 *   and extensible at runtime via registerOperator().
 * - Composite: RuleNode (ConditionLeaf | RuleGroup) supporting arbitrarily nested AND/OR trees.
 * - Visitor: RuleNodeVisitor<T> decoupled from tree structure (EvaluationVisitor & ValidationVisitor).
 */

import type {
  ConditionLeaf,
  EvaluationContext,
  RuleGroup,
  RuleNode,
  TargetingOperator,
  UserSegment,
} from '../types/flagship';

export interface OperatorStrategy {
  readonly operator: TargetingOperator;
  evaluate(attributeValue: unknown, targetValues: string[]): boolean;
}

function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.trim().replace(/^v/i, '').split('-')[0];
  const parts = cleaned.split('.');
  if (parts.length === 0 || parts.length > 3) return null;
  const nums = [0, 0, 0];
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0) return null;
    nums[i] = n;
  }
  return [nums[0], nums[1], nums[2]];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const regexCache = new Map<string, RegExp | null>();

function getCompiledRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) {
    return regexCache.get(pattern) ?? null;
  }
  try {
    const compiled = new RegExp(pattern);
    regexCache.set(pattern, compiled);
    return compiled;
  } catch {
    regexCache.set(pattern, null);
    return null;
  }
}

export class OperatorRegistry {
  private readonly strategies = new Map<TargetingOperator, OperatorStrategy>();

  constructor() {
    this.register({
      operator: 'EQUALS',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        return String(attr) === vals[0];
      },
    });

    this.register({
      operator: 'NOT_EQUALS',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        return String(attr) !== vals[0];
      },
    });

    this.register({
      operator: 'IN',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null) return false;
        if (Array.isArray(attr)) {
          return attr.some((item) => vals.includes(String(item)));
        }
        return vals.includes(String(attr));
      },
    });

    this.register({
      operator: 'CONTAINS',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        if (Array.isArray(attr)) {
          return vals.some((v) => attr.map(String).includes(v));
        }
        const str = String(attr);
        return vals.some((v) => str.includes(v));
      },
    });

    this.register({
      operator: 'SEMVER_GREATER_THAN',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        const left = parseSemver(String(attr));
        const right = parseSemver(vals[0]);
        if (!left || !right) return false;
        return compareSemver(left, right) > 0;
      },
    });

    this.register({
      operator: 'REGEX',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        const regex = getCompiledRegex(vals[0]);
        if (!regex) return false;
        return regex.test(String(attr));
      },
    });

    this.register({
      operator: 'DATE_BEFORE',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        const left = Date.parse(String(attr));
        const right = Date.parse(vals[0]);
        if (Number.isNaN(left) || Number.isNaN(right)) return false;
        return left < right;
      },
    });

    this.register({
      operator: 'DATE_AFTER',
      evaluate: (attr, vals) => {
        if (attr === undefined || attr === null || vals.length === 0) return false;
        const left = Date.parse(String(attr));
        const right = Date.parse(vals[0]);
        if (Number.isNaN(left) || Number.isNaN(right)) return false;
        return left > right;
      },
    });
  }

  register(strategy: OperatorStrategy): void {
    this.strategies.set(strategy.operator, strategy);
  }

  get(operator: TargetingOperator): OperatorStrategy | undefined {
    return this.strategies.get(operator);
  }
}

export const defaultOperatorRegistry = new OperatorRegistry();

// Visitor Pattern interface for traversing Composite RuleNode trees
export interface RuleNodeVisitor<T> {
  visitCondition(node: ConditionLeaf): T;
  visitGroup(node: RuleGroup): T;
}

export function acceptRuleNode<T>(node: RuleNode, visitor: RuleNodeVisitor<T>): T {
  if (node.kind === 'condition') {
    return visitor.visitCondition(node);
  }
  return visitor.visitGroup(node);
}

export class RuleEvaluationVisitor implements RuleNodeVisitor<boolean> {
  constructor(
    private readonly context: EvaluationContext,
    private readonly registry: OperatorRegistry = defaultOperatorRegistry,
  ) {}

  visitCondition(node: ConditionLeaf): boolean {
    const strategy = this.registry.get(node.operator);
    if (!strategy) return false;
    const rawValue =
      node.attribute === 'userKey'
        ? this.context.userKey
        : this.context.attributes[node.attribute];
    return strategy.evaluate(rawValue, node.values);
  }

  visitGroup(node: RuleGroup): boolean {
    if (node.children.length === 0) return true;
    if (node.logicalOp === 'AND') {
      for (let i = 0; i < node.children.length; i++) {
        if (!acceptRuleNode(node.children[i], this)) return false;
      }
      return true;
    }
    for (let i = 0; i < node.children.length; i++) {
      if (acceptRuleNode(node.children[i], this)) return true;
    }
    return false;
  }
}

export class RuleValidationVisitor implements RuleNodeVisitor<string[]> {
  visitCondition(node: ConditionLeaf): string[] {
    const errors: string[] = [];
    if (!node.attribute.trim()) {
      errors.push(`Condition ${node.id}: attribute is required`);
    }
    if (!node.values || node.values.length === 0 || node.values.every((v) => !v.trim())) {
      errors.push(`Condition ${node.id}: at least one value is required`);
    }
    if (node.operator === 'REGEX' && node.values[0]) {
      try {
        new RegExp(node.values[0]);
      } catch {
        errors.push(`Condition ${node.id}: invalid regex "${node.values[0]}"`);
      }
    }
    if ((node.operator === 'DATE_BEFORE' || node.operator === 'DATE_AFTER') && node.values[0]) {
      if (Number.isNaN(Date.parse(node.values[0]))) {
        errors.push(`Condition ${node.id}: invalid ISO date "${node.values[0]}"`);
      }
    }
    return errors;
  }

  visitGroup(node: RuleGroup): string[] {
    return node.children.flatMap((child) => acceptRuleNode(child, this));
  }
}

export function evaluateSegment(
  segment: UserSegment,
  context: EvaluationContext,
  registry: OperatorRegistry = defaultOperatorRegistry,
): boolean {
  if (segment.excludedUsers.includes(context.userKey)) {
    return false;
  }
  if (segment.includedUsers.includes(context.userKey)) {
    return true;
  }
  if (segment.rootGroup.children.length === 0) {
    return false;
  }
  const visitor = new RuleEvaluationVisitor(context, registry);
  return acceptRuleNode(segment.rootGroup, visitor);
}
