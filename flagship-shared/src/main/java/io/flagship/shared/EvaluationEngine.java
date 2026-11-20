package io.flagship.shared;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Shared 5-stage Chain of Responsibility + Strategy + Composite Evaluation Engine.
 * Identical semantics to src/engine/evaluation.ts.
 */
public class EvaluationEngine {

    public enum Operator {
        EQUALS, NOT_EQUALS, IN, CONTAINS, SEMVER_GREATER_THAN, REGEX, DATE_BEFORE, DATE_AFTER
    }

    public enum LogicalOp { AND, OR }

    public enum Reason {
        KILL_SWITCH, FLAG_DISABLED, INDIVIDUAL_TARGET, SEGMENT_RULE,
        PERCENTAGE_ROLLOUT, DEFAULT_VARIATION, FALLBACK_DEFAULT
    }

    public record EvaluationContext(String userKey, Map<String, Object> attributes) {
        public static Builder builder(String userKey) {
            return new Builder(userKey);
        }

        public static final class Builder {
            private final String userKey;
            private final Map<String, Object> attrs = new HashMap<>();

            private Builder(String userKey) {
                if (userKey == null || userKey.isBlank()) {
                    throw new IllegalArgumentException("userKey must not be blank");
                }
                this.userKey = userKey;
            }

            public Builder attribute(String key, Object value) {
                this.attrs.put(key, value);
                return this;
            }

            public EvaluationContext build() {
                return new EvaluationContext(userKey, Map.copyOf(attrs));
            }
        }
    }

    public record Condition(String attribute, Operator operator, List<String> values) {}

    public record RuleGroup(LogicalOp logicalOp, List<Condition> conditions, List<RuleGroup> nestedGroups) {}

    public record TargetingRule(
            String id,
            String name,
            int priority,
            boolean enabled,
            RuleGroup rootGroup,
            String serveVariationId
    ) {}

    public record FlagSnapshotItem(
            String flagKey,
            boolean enabled,
            boolean killSwitchActive,
            String killSwitchVariationId,
            String defaultVariationId,
            int rolloutPercentage,
            String rolloutVariationId,
            Map<String, Object> variations,
            Map<String, Set<String>> individualTargets,
            List<TargetingRule> targetingRules
    ) {}

    public record EvaluationResult(
            String flagKey,
            String variationId,
            Object value,
            Reason reason,
            double bucket
    ) {}

    private static final Map<String, Pattern> REGEX_CACHE = new ConcurrentHashMap<>();

    public EvaluationResult evaluate(FlagSnapshotItem flag, EvaluationContext ctx) {
        double bucket = MurmurHash3.computeBucket(flag.flagKey(), ctx.userKey());

        // 1. Kill Switch & Disabled Gate
        if (flag.killSwitchActive()) {
            String vid = flag.killSwitchVariationId() != null ? flag.killSwitchVariationId() : flag.defaultVariationId();
            return new EvaluationResult(flag.flagKey(), vid, flag.variations().get(vid), Reason.KILL_SWITCH, bucket);
        }
        if (!flag.enabled()) {
            String vid = flag.defaultVariationId();
            return new EvaluationResult(flag.flagKey(), vid, flag.variations().get(vid), Reason.FLAG_DISABLED, bucket);
        }

        // 2. Individual User Targets
        if (flag.individualTargets() != null) {
            for (var entry : flag.individualTargets().entrySet()) {
                if (entry.getValue().contains(ctx.userKey())) {
                    return new EvaluationResult(
                            flag.flagKey(), entry.getKey(), flag.variations().get(entry.getKey()), Reason.INDIVIDUAL_TARGET, bucket);
                }
            }
        }

        // 3. Segment & Targeting Rules (priority order)
        if (flag.targetingRules() != null && !flag.targetingRules().isEmpty()) {
            List<TargetingRule> ordered = flag.targetingRules().stream()
                    .filter(TargetingRule::enabled)
                    .sorted(Comparator.comparingInt(TargetingRule::priority))
                    .toList();
            for (TargetingRule rule : ordered) {
                if (evaluateGroup(rule.rootGroup(), ctx)) {
                    String vid = rule.serveVariationId();
                    return new EvaluationResult(
                            flag.flagKey(), vid, flag.variations().get(vid), Reason.SEGMENT_RULE, bucket);
                }
            }
        }

        // 4. Sticky Percentage Rollout
        if (flag.rolloutPercentage() > 0 && bucket < flag.rolloutPercentage()) {
            String vid = flag.rolloutVariationId() != null ? flag.rolloutVariationId() : flag.defaultVariationId();
            return new EvaluationResult(
                    flag.flagKey(), vid, flag.variations().get(vid), Reason.PERCENTAGE_ROLLOUT, bucket);
        }

        // 5. Default Variation
        String vid = flag.defaultVariationId();
        return new EvaluationResult(flag.flagKey(), vid, flag.variations().get(vid), Reason.DEFAULT_VARIATION, bucket);
    }

    private boolean evaluateGroup(RuleGroup group, EvaluationContext ctx) {
        if (group == null) return true;
        List<Boolean> results = new ArrayList<>();
        if (group.conditions() != null) {
            for (Condition c : group.conditions()) {
                results.add(evaluateCondition(c, ctx));
            }
        }
        if (group.nestedGroups() != null) {
            for (RuleGroup child : group.nestedGroups()) {
                results.add(evaluateGroup(child, ctx));
            }
        }
        if (results.isEmpty()) return true;
        return group.logicalOp() == LogicalOp.AND
                ? results.stream().allMatch(Boolean::booleanValue)
                : results.stream().anyMatch(Boolean::booleanValue);
    }

    private boolean evaluateCondition(Condition c, EvaluationContext ctx) {
        Object raw = "userKey".equals(c.attribute()) ? ctx.userKey() : ctx.attributes().get(c.attribute());
        if (raw == null || c.values() == null || c.values().isEmpty()) return false;
        String str = String.valueOf(raw);
        return switch (c.operator()) {
            case EQUALS -> str.equals(c.values().get(0));
            case NOT_EQUALS -> !str.equals(c.values().get(0));
            case IN -> c.values().contains(str);
            case CONTAINS -> c.values().stream().anyMatch(str::contains);
            case SEMVER_GREATER_THAN -> compareSemver(str, c.values().get(0)) > 0;
            case REGEX -> {
                Pattern p = REGEX_CACHE.computeIfAbsent(c.values().get(0), Pattern::compile);
                yield p.matcher(str).find();
            }
            case DATE_BEFORE -> Instant.parse(str).isBefore(Instant.parse(c.values().get(0)));
            case DATE_AFTER -> Instant.parse(str).isAfter(Instant.parse(c.values().get(0)));
        };
    }

    private int compareSemver(String a, String b) {
        String[] pa = a.replaceFirst("^v", "").split("-")[0].split("\\.");
        String[] pb = b.replaceFirst("^v", "").split("-")[0].split("\\.");
        for (int i = 0; i < 3; i++) {
            int na = i < pa.length ? Integer.parseInt(pa[i]) : 0;
            int nb = i < pb.length ? Integer.parseInt(pb[i]) : 0;
            if (na != nb) return Integer.compare(na, nb);
        }
        return 0;
    }
}
