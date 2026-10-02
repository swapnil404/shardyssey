export interface Span {
  id: string;
  parent_id: string | null;
  service: string | null;
  operation: string | null;
  start: number | null;
  end: number | null;
  duration_us: number | null;
  status: string | null;
  evidence_path: string;
  evidence_pointer: string;
}
export interface Branch {
  shard: string;
  tablet: string;
  rpc_span_id: string;
  supporting_span_ids: string[];
  identity_source: string;
  topology_evidence_path: string;
  start: number | null;
  end: number | null;
  duration_us: number | null;
}
export interface Tablet { alias: string; keyspace: string | null; shard: string | null; type: string | null; evidence_path: string }
export interface Recording {
  schema_version: number;
  run_id: string | null;
  experiment_id: string;
  vitess_version: string | null;
  query_template: string | null;
  query_result: { columns: string[]; rows: string[][]; evidence_path: string } | null;
  client_elapsed_ms: number | null;
  fault_configuration: { type: string; shard: string; delay_ms: number } | null;
  capture_status: string;
  timing_available: boolean;
  timestamp_unit: string;
  root_span_id: string | null;
  clock_uncertainty_us: number | null;
  topology_snapshot: { tablets: Tablet[]; layout: string | null };
  spans: Span[];
  branches: Branch[];
  warnings: { code: string; message: string; span_id: string | null }[];
  explain_runs: { run_id: string | null; format: string; raw_output: string | null; evidence_path: string }[];
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const nullableTime = (v: unknown) => v === null || (typeof v === 'number' && Number.isSafeInteger(v));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === 'string');

export function parseRecording(value: unknown): Recording {
  if (!object(value) || value.schema_version !== 1 || !['one-shard', 'fan-out', 'slow-branch'].includes(value.experiment_id as string) || value.timestamp_unit !== 'unix_microseconds' || typeof value.capture_status !== 'string' || typeof value.timing_available !== 'boolean') throw new Error('Unsupported recording format.');
  for (const key of ['run_id', 'trace_id', 'vitess_version', 'query_template', 'root_span_id']) if (!nullableString(value[key])) throw new Error(`Invalid recording field: ${key}.`);
  if (!object(value.topology_snapshot) || !Array.isArray(value.topology_snapshot.tablets) || !nullableString(value.topology_snapshot.layout)) throw new Error('Missing recorded topology.');
  for (const tablet of value.topology_snapshot.tablets) {
    if (!object(tablet) || typeof tablet.alias !== 'string' || !nullableString(tablet.shard) || !nullableString(tablet.keyspace) || !nullableString(tablet.type) || typeof tablet.evidence_path !== 'string') throw new Error('Invalid tablet identity.');
  }
  if (!Array.isArray(value.spans) || !Array.isArray(value.branches) || !Array.isArray(value.warnings) || !Array.isArray(value.explain_runs)) throw new Error('Missing recording evidence.');
  const ids = new Set<string>();
  for (const span of value.spans) {
    if (!object(span) || typeof span.id !== 'string' || ids.has(span.id) || !nullableString(span.parent_id) || !nullableString(span.service) || !nullableString(span.operation) || !nullableString(span.status) || !nullableTime(span.start) || !nullableTime(span.end) || !nullableTime(span.duration_us) || typeof span.evidence_path !== 'string' || typeof span.evidence_pointer !== 'string') throw new Error('Invalid or duplicate recorded span.');
    ids.add(span.id);
  }
  for (const branch of value.branches) {
    if (!object(branch) || typeof branch.shard !== 'string' || typeof branch.tablet !== 'string' || typeof branch.rpc_span_id !== 'string' || !strings(branch.supporting_span_ids) || !nullableTime(branch.start) || !nullableTime(branch.end) || !nullableTime(branch.duration_us) || typeof branch.identity_source !== 'string' || typeof branch.topology_evidence_path !== 'string') throw new Error('Invalid recorded branch.');
  }
  for (const warning of value.warnings) if (!object(warning) || typeof warning.code !== 'string' || typeof warning.message !== 'string') throw new Error('Invalid capture warning.');
  for (const explain of value.explain_runs) if (!object(explain) || !nullableString(explain.run_id) || typeof explain.format !== 'string' || !nullableString(explain.raw_output) || typeof explain.evidence_path !== 'string') throw new Error('Invalid explain evidence.');
  if (value.query_result !== null) {
    if (!object(value.query_result) || !strings(value.query_result.columns) || !Array.isArray(value.query_result.rows) || !value.query_result.rows.every(strings) || typeof value.query_result.evidence_path !== 'string') throw new Error('Invalid query result.');
  }
  if (value.fault_configuration !== null && (!object(value.fault_configuration) || value.fault_configuration.type !== 'injected network delay' || typeof value.fault_configuration.shard !== 'string' || typeof value.fault_configuration.delay_ms !== 'number' || !Number.isInteger(value.fault_configuration.delay_ms) || value.fault_configuration.delay_ms < 100 || value.fault_configuration.delay_ms > 1000)) throw new Error('Invalid injected delay evidence.');
  if (!nullableTime(value.clock_uncertainty_us) || (value.client_elapsed_ms !== null && (typeof value.client_elapsed_ms !== 'number' || !Number.isFinite(value.client_elapsed_ms) || value.client_elapsed_ms < 0))) throw new Error('Invalid recording timing.');
  return value as unknown as Recording;
}

export interface ReplayModel { recording: Recording; root: Span | null; duration: number; available: boolean; reason: string | null }
export type IntervalState = 'pending' | 'active' | 'complete' | 'unavailable';
export function replayModel(recording: Recording): ReplayModel {
  const spans = new Map(recording.spans.map(span => [span.id, span]));
  const root = spans.get(recording.root_span_id ?? '') ?? null;
  const measured = (s: Pick<Span, 'start' | 'end' | 'duration_us'>): boolean => s.start !== null && s.end !== null && s.duration_us !== null && s.duration_us >= 0 && s.end === s.start + s.duration_us;
  let reason: string | null = null;
  if (recording.capture_status !== 'complete' || !recording.timing_available || recording.warnings.length) reason = 'This capture is incomplete. Missing branches cannot prove that a shard did not run.';
  else if (!root || root.operation !== 'vtgateHandler.ComQuery' || root.service !== 'vtgate' || root.parent_id !== null || !measured(root) || root.duration_us === 0) reason = 'The measured query interval is unavailable.';
  else if (recording.topology_snapshot.tablets.length !== 2 || new Set(recording.topology_snapshot.tablets.map(tablet => tablet.alias)).size !== 2 || new Set(recording.topology_snapshot.tablets.map(tablet => tablet.shard)).size !== 2) reason = 'The two recorded shard services cannot be identified uniquely.';
  else if (recording.branches.length !== (recording.experiment_id === 'one-shard' ? 1 : 2) || new Set(recording.branches.map(branch => branch.tablet)).size !== recording.branches.length || new Set(recording.branches.map(branch => branch.rpc_span_id)).size !== recording.branches.length) reason = 'The expected query branches are missing or ambiguous.';
  else if (recording.spans.some(span => !measured(span))) reason = 'Some span timing is unknown. Timed replay is disabled.';
  else {
    for (const span of recording.spans) {
      const seen = new Set<string>();
      let cursor: Span | undefined = span;
      while (cursor && cursor.id !== root.id) {
        if (seen.has(cursor.id)) { reason = 'Span ancestry is ambiguous.'; break; }
        seen.add(cursor.id);
        cursor = spans.get(cursor.parent_id ?? '');
      }
      if (!cursor) reason = 'A supporting parent span is missing.';
      if (reason) break;
    }
    for (const branch of recording.branches) {
      const rpc = spans.get(branch.rpc_span_id);
      const tablet = recording.topology_snapshot.tablets.find(tablet => tablet.alias === branch.tablet);
      if (!rpc || rpc.service !== 'vtgate' || rpc.operation !== '/queryservice.Query/Execute' || !measured(branch) || rpc.start !== branch.start || rpc.end !== branch.end || rpc.duration_us !== branch.duration_us || !branch.supporting_span_ids.includes(rpc.id) || !branch.supporting_span_ids.includes(root.id) || branch.supporting_span_ids.some(id => !spans.has(id)) || !tablet || tablet.shard !== branch.shard || branch.start! < root.start! || branch.end! > root.end!) reason = 'A branch interval cannot be matched to its source evidence.';
    }
  }
  return { recording, root, duration: root?.duration_us ?? 0, available: reason === null, reason };
}
export function clampCursor(model: ReplayModel, cursor: number): number { return Math.max(0, Math.min(model.duration, Number.isFinite(cursor) ? cursor : 0)); }
export function intervalState(model: ReplayModel, cursor: number, interval: { start: number | null; end: number | null }): IntervalState {
  if (!model.available || model.root?.start === null || !model.root || interval.start === null || interval.end === null) return 'unavailable';
  const absolute = model.root.start + clampCursor(model, cursor);
  return absolute < interval.start ? 'pending' : absolute < interval.end ? 'active' : 'complete';
}
export function resultVisible(model: ReplayModel, cursor: number): boolean { return model.available && cursor >= model.duration; }
export function nextEvent(model: ReplayModel, cursor: number): number {
  const start = model.root?.start;
  if (start === null || start === undefined) return cursor;
  const events = [model.duration, ...model.recording.branches.flatMap(branch => [branch.start === null ? null : branch.start - start, branch.end === null ? null : branch.end - start])].filter((value): value is number => value !== null && value > cursor);
  return events.length ? Math.min(...events) : model.duration;
}
export const milliseconds = (us: number | null | undefined) => us === null || us === undefined ? 'Unavailable' : `${(us / 1000).toFixed(3)} ms`;
export function evidenceURL(recordingURL: string, relative: string): string {
  const base = new URL(recordingURL, window.location.href);
  const url = new URL(relative, base);
  const allowed = new URL('../', base);
  if (url.origin !== base.origin || !url.pathname.startsWith(allowed.pathname)) throw new Error('Evidence link is outside this recording bundle.');
  return url.href;
}

export function planEvidence(recording: Recording) {
  const evidence = recording.explain_runs.find(run => run.format === 'PLAN');
  if (!evidence?.raw_output) return null;
  try {
    const plan = JSON.parse(evidence.raw_output.replace(/^JSON\s*/, ''));
    if (plan.OperatorType === 'Route' && plan.Variant === 'EqualUnique' && plan.Vindex === 'user_hash') return { evidence, routing: 'EqualUnique', aggregate: null, explanation: 'The captured plan uses the user_hash vindex for an EqualUnique route. The user_id filter targets one shard.' };
    if (plan.OperatorType === 'Aggregate' && plan.Variant === 'Scalar' && plan.Aggregates === 'sum_count_star(0) AS count(*)' && plan.Inputs?.length === 1 && plan.Inputs[0].OperatorType === 'Route' && plan.Inputs[0].Variant === 'Scatter') return { evidence, routing: 'Scatter', aggregate: plan.Aggregates as string, explanation: 'The captured plan scatters the count query and applies a scalar sum_count_star aggregate to the shard counts. A complete count needs both contributions.' };
  } catch { /* Unknown plan output is inspectable but does not support a routing claim. */ }
  return null;
}
