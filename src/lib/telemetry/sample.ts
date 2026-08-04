import type { TelemetryLevel, TelemetryMode } from './types';

/** INFO sampling rate in Normal mode (Verbose = 100%, Silent = 0% INFO). */
const INFO_SAMPLE_RATE = 0.1;

export function shouldStoreLevel(level: TelemetryLevel, mode: TelemetryMode): boolean {
  if (mode === 'verbose') return true;
  if (mode === 'silent') return level === 'error';
  // normal
  if (level === 'error' || level === 'warn') return true;
  return Math.random() < INFO_SAMPLE_RATE;
}

export function shouldConsoleLog(level: TelemetryLevel, mode: TelemetryMode): boolean {
  if (mode === 'verbose') return true;
  if (mode === 'silent') return level === 'error';
  return level === 'warn' || level === 'error';
}
