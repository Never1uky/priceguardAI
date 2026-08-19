export interface MatchFeatureFlags {
  enableRemoteRulePack: boolean;
  enableFeedbackBias: boolean;
  enableCalibratedThresholds: boolean;
}

export const DEFAULT_MATCH_FEATURE_FLAGS: MatchFeatureFlags = {
  enableRemoteRulePack: false,
  enableFeedbackBias: false,
  enableCalibratedThresholds: false,
};

export function resolveMatchFeatureFlags(
  overrides?: Partial<MatchFeatureFlags>,
): MatchFeatureFlags {
  return {
    ...DEFAULT_MATCH_FEATURE_FLAGS,
    ...(overrides ?? {}),
  };
}
