/**
 * Experiment Analytics Engine (FR8).
 * Computes exposure counts, conversion rates, relative lift, two-proportion z-test p-value,
 * and Pearson Chi-square Sample Ratio Mismatch (SRM) detection.
 */

import type {
  ConversionEvent,
  Experiment,
  ExposureEvent,
  FeatureFlag,
} from '../types/flagship';

export interface VariationMetrics {
  variationId: string;
  variationKey: string;
  variationName: string;
  exposures: number;
  conversions: number;
  conversionRate: number; // 0..100%
  expectedShare: number; // 0..100%
  observedShare: number; // 0..100%
  liftVsControl: number | null; // percentage points or relative %
}

export interface ExperimentAnalyticsSummary {
  experimentId: string;
  experimentName: string;
  flagKey: string;
  metricName: string;
  status: Experiment['status'];
  totalExposures: number;
  totalConversions: number;
  overallConversionRate: number;
  variations: VariationMetrics[];
  zScore: number;
  pValue: number;
  statisticallySignificant: boolean; // p < 0.05
  srmChiSquare: number;
  srmPValue: number;
  srmDetected: boolean; // p < 0.01 standard threshold
  winnerVariationName: string | null;
}

// Standard normal CDF via Abramowitz & Stegun approximation
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const prob =
    d *
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - prob : prob;
}

// Upper-tail p-value for Chi-square with df=1 (erfc(sqrt(x/2))) and general df via Wilson-Hilferty
export function chiSquarePValue(chiSq: number, df: number): number {
  if (chiSq <= 0 || df <= 0) return 1;
  if (df === 1) {
    return 2 * (1 - normalCdf(Math.sqrt(chiSq)));
  }
  // Wilson-Hilferty normal approximation for df >= 2
  const z = (Math.pow(chiSq / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

export function computeExperimentAnalytics(
  experiment: Experiment,
  flag: FeatureFlag | undefined,
  exposures: ExposureEvent[],
  conversions: ConversionEvent[],
): ExperimentAnalyticsSummary {
  const expExposures = exposures.filter((e) => e.experimentId === experiment.id);
  const expConversions = conversions.filter((c) => c.experimentId === experiment.id);

  // Deduplicate unique user exposures per variation
  const variationIds = Object.keys(experiment.expectedSplit);
  if (variationIds.length === 0 && flag) {
    flag.variations.forEach((v) => variationIds.push(v.id));
  }

  const exposureCounts = new Map<string, number>();
  const conversionCounts = new Map<string, number>();
  variationIds.forEach((id) => {
    exposureCounts.set(id, 0);
    conversionCounts.set(id, 0);
  });

  for (const ev of expExposures) {
    exposureCounts.set(ev.variationId, (exposureCounts.get(ev.variationId) ?? 0) + 1);
  }
  for (const ev of expConversions) {
    conversionCounts.set(ev.variationId, (conversionCounts.get(ev.variationId) ?? 0) + 1);
  }

  const totalExposures = Array.from(exposureCounts.values()).reduce((a, b) => a + b, 0);
  const totalConversions = Array.from(conversionCounts.values()).reduce((a, b) => a + b, 0);
  const overallConversionRate =
    totalExposures > 0 ? Number(((totalConversions / totalExposures) * 100).toFixed(2)) : 0;

  const controlExposures = exposureCounts.get(experiment.controlVariationId) ?? 0;
  const controlConversions = conversionCounts.get(experiment.controlVariationId) ?? 0;
  const controlRate = controlExposures > 0 ? controlConversions / controlExposures : 0;

  const variations: VariationMetrics[] = variationIds.map((vid) => {
    const vDef = flag?.variations.find((v) => v.id === vid);
    const exp = exposureCounts.get(vid) ?? 0;
    const conv = conversionCounts.get(vid) ?? 0;
    const rate = exp > 0 ? conv / exp : 0;
    const expectedShare = experiment.expectedSplit[vid] ?? 100 / Math.max(1, variationIds.length);
    const observedShare = totalExposures > 0 ? (exp / totalExposures) * 100 : 0;

    let liftVsControl: number | null = null;
    if (vid !== experiment.controlVariationId && controlRate > 0) {
      liftVsControl = Number((((rate - controlRate) / controlRate) * 100).toFixed(2));
    }

    return {
      variationId: vid,
      variationKey: vDef?.key ?? vid,
      variationName: vDef?.name ?? vid,
      exposures: exp,
      conversions: conv,
      conversionRate: Number((rate * 100).toFixed(2)),
      expectedShare: Number(expectedShare.toFixed(1)),
      observedShare: Number(observedShare.toFixed(1)),
      liftVsControl,
    };
  });

  // Two-proportion z-test between control and treatment
  const treatExposures = exposureCounts.get(experiment.treatmentVariationId) ?? 0;
  const treatConversions = conversionCounts.get(experiment.treatmentVariationId) ?? 0;

  let zScore = 0;
  let pValue = 1;
  if (controlExposures > 0 && treatExposures > 0) {
    const p1 = controlConversions / controlExposures;
    const p2 = treatConversions / treatExposures;
    const pooled = (controlConversions + treatConversions) / (controlExposures + treatExposures);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / controlExposures + 1 / treatExposures));
    if (se > 0) {
      zScore = Number(((p2 - p1) / se).toFixed(3));
      pValue = Number((2 * (1 - normalCdf(Math.abs(zScore)))).toFixed(4));
    }
  }

  // Pearson Chi-Square test for Sample Ratio Mismatch (SRM)
  let srmChiSquare = 0;
  if (totalExposures >= 20) {
    for (const v of variations) {
      const expected = totalExposures * (v.expectedShare / 100);
      if (expected > 0) {
        srmChiSquare += Math.pow(v.exposures - expected, 2) / expected;
      }
    }
  }
  srmChiSquare = Number(srmChiSquare.toFixed(3));
  const df = Math.max(1, variations.length - 1);
  const srmPValue = totalExposures >= 20 ? Number(chiSquarePValue(srmChiSquare, df).toFixed(5)) : 1;
  const srmDetected = totalExposures >= 20 && srmPValue < 0.01;

  const statisticallySignificant = pValue < 0.05 && totalExposures >= 30;
  let winnerVariationName: string | null = null;
  if (statisticallySignificant && !srmDetected) {
    const best = [...variations].sort((a, b) => b.conversionRate - a.conversionRate)[0];
    winnerVariationName = best?.variationName ?? null;
  }

  return {
    experimentId: experiment.id,
    experimentName: experiment.name,
    flagKey: experiment.flagKey,
    metricName: experiment.metricName,
    status: experiment.status,
    totalExposures,
    totalConversions,
    overallConversionRate,
    variations,
    zScore,
    pValue,
    statisticallySignificant,
    srmChiSquare,
    srmPValue,
    srmDetected,
    winnerVariationName,
  };
}
