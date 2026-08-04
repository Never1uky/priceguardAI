/**
 * Build redacted diagnostics.json for Copy / Export.
 */

import { pipelineMetrics } from '@/lib/pipeline-metrics';
import { getBrowserLabel, getExtensionVersion, ensureSessionId, loadTelemetrySettings } from './context';
import { readTelemetryEvents } from './ring';
import type { TelemetryEvent } from './types';

function pickByStages(events: TelemetryEvent[], stages: string[], limit: number): TelemetryEvent[] {
  return events.filter((e) => stages.includes(e.stage)).slice(-limit);
}

function stripStacks(events: TelemetryEvent[]): TelemetryEvent[] {
  return events.map(({ stack: _s, ...rest }) => rest);
}

export async function buildDiagnosticsPackage(): Promise<Record<string, unknown>> {
  const sessionId = await ensureSessionId();
  const settings = await loadTelemetrySettings();
  const events = await readTelemetryEvents(200);
  const metrics = await pipelineMetrics.get();

  const lastErrors = events.filter((e) => e.level === 'error' || e.level === 'warn').slice(-40);
  const lastSearches = pickByStages(events, ['search', 'serp', 'job'], 40);
  const lastParser = pickByStages(events, ['parser', 'cascade', 'card'], 40);
  const lastAi = pickByStages(events, ['ai'], 30);
  const lastNetwork = events
    .filter(
      (e) =>
        e.stage === 'edge' ||
        e.errorCode === 'network' ||
        e.name.includes('network') ||
        e.name.includes('EDGE'),
    )
    .slice(-30);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      extensionVersion: getExtensionVersion(),
      browser: getBrowserLabel(),
      sessionId,
      telemetryMode: settings.mode,
      remoteEnabled: settings.remoteEnabled,
    },
    pipelineMetrics: metrics,
    lastSearches: stripStacks(lastSearches),
    lastParserEvents: stripStacks(lastParser),
    lastAiEvents: stripStacks(lastAi),
    lastNetworkFailures: stripStacks(lastNetwork),
    lastEdgeFailures: stripStacks(
      events.filter((e) => e.stage === 'edge' && e.level !== 'info').slice(-30),
    ),
    lastErrors: stripStacks(lastErrors),
    last200Events: stripStacks(events),
  };
}

export async function diagnosticsJsonString(): Promise<string> {
  const pkg = await buildDiagnosticsPackage();
  return JSON.stringify(pkg, null, 2);
}
