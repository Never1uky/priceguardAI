import { describe, expect, it } from 'vitest';
import { evaluateCalibration, type MatchCalibrationCase } from '@/lib/match-calibration';

const GOLDEN_CASES: MatchCalibrationCase[] = [
  { id: 'v1', bestMatch: 96, secondMatch: 62, alternativeCount: 0, expected: 'verified' },
  { id: 'v2', bestMatch: 93, secondMatch: 70, alternativeCount: 0, expected: 'verified' },
  { id: 'v3', bestMatch: 91, secondMatch: 63, alternativeCount: 0, expected: 'verified' },
  { id: 'p1', bestMatch: 78, secondMatch: 65, alternativeCount: 2, expected: 'needs_choice' },
  { id: 'p2', bestMatch: 74, secondMatch: 60, alternativeCount: 1, expected: 'probable' },
  { id: 'p3', bestMatch: 71, secondMatch: 61, alternativeCount: 1, expected: 'probable' },
  { id: 'n1', bestMatch: 54, secondMatch: 51, alternativeCount: 2, expected: 'not_found' },
  { id: 'n2', bestMatch: 47, secondMatch: 44, alternativeCount: 3, expected: 'not_found' },
  { id: 'n3', bestMatch: 52, secondMatch: 49, alternativeCount: 0, expected: 'not_found' },
  { id: 'c1', bestMatch: 88, secondMatch: 86, alternativeCount: 2, expected: 'needs_choice' },
  { id: 'c2', bestMatch: 82, secondMatch: 81, alternativeCount: 4, expected: 'needs_choice' },
  { id: 'c3', bestMatch: 69, secondMatch: 66, alternativeCount: 3, expected: 'needs_choice' },
];

describe('match threshold calibration', () => {
  it('produces stable baseline and calibrated metrics', () => {
    const baseline = evaluateCalibration(GOLDEN_CASES, {
      enableCalibratedThresholds: false,
    });
    const calibrated = evaluateCalibration(GOLDEN_CASES, {
      enableCalibratedThresholds: true,
    });

    expect(baseline.falseAutoPickRate).toBeGreaterThanOrEqual(0);
    expect(calibrated.falseAutoPickRate).toBeLessThanOrEqual(baseline.falseAutoPickRate);
    expect(calibrated.precisionVerified).toBeGreaterThanOrEqual(baseline.precisionVerified);
    expect(calibrated.needsChoiceRate).toBeGreaterThan(0);
  });
});
