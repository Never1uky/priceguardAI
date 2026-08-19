import { decideMatchOutcome } from '@/lib/match-status';

export interface MatchCalibrationCase {
  id: string;
  bestMatch: number;
  secondMatch?: number;
  alternativeCount: number;
  expected: 'verified' | 'probable' | 'needs_choice' | 'not_found';
}

export interface MatchCalibrationMetrics {
  falseAutoPickRate: number;
  precisionVerified: number;
  needsChoiceRate: number;
  verifiedCount: number;
  total: number;
}

export function evaluateCalibration(
  cases: MatchCalibrationCase[],
  featureFlags?: {
    enableCalibratedThresholds?: boolean;
  },
): MatchCalibrationMetrics {
  let falseAutoPick = 0;
  let verifiedPred = 0;
  let verifiedTruePositive = 0;
  let needsChoice = 0;

  for (const sample of cases) {
    const outcome = decideMatchOutcome({
      bestMatch: sample.bestMatch,
      secondMatch: sample.secondMatch,
      alternativeCount: sample.alternativeCount,
      featureFlags,
    });
    if (outcome.autoPick && sample.expected !== 'verified') falseAutoPick += 1;
    if (outcome.status === 'verified') {
      verifiedPred += 1;
      if (sample.expected === 'verified') verifiedTruePositive += 1;
    }
    if (outcome.status === 'needs_choice') needsChoice += 1;
  }

  const total = Math.max(1, cases.length);
  return {
    falseAutoPickRate: falseAutoPick / total,
    precisionVerified:
      verifiedPred > 0 ? verifiedTruePositive / verifiedPred : 1,
    needsChoiceRate: needsChoice / total,
    verifiedCount: verifiedPred,
    total: cases.length,
  };
}
