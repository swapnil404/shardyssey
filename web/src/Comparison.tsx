import { useMemo, useState } from 'react';
import { Evidence, Graph, PlaybackControls, Timeline } from './Replay';
import { intervalState, milliseconds, planEvidence, replayModel, resultVisible, type Recording, type ReplayModel } from './recording';
import { useReplay } from './useReplay';
export interface LoadedRecording { recording: Recording; url: string }
export function comparisonModel(baseline: Recording, selected: Recording): ReplayModel {
  const a = replayModel(baseline), b = replayModel(selected);
  const longest = a.duration > b.duration ? a : b;
  const sameTopology = (recording: Recording) => recording.topology_snapshot.tablets.map(tablet => `${tablet.keyspace}/${tablet.shard}/${tablet.alias}`).sort().join(',');
  let reason = a.reason ?? b.reason;
  if (baseline.experiment_id !== 'fan-out' || !['fan-out', 'slow-branch'].includes(selected.experiment_id) || baseline.query_template !== selected.query_template || baseline.vitess_version !== selected.vitess_version || sameTopology(baseline) !== sameTopology(selected) || baseline.fault_configuration !== null) reason = 'These captures do not share the same query, topology, version, and baseline conditions.';
  if (selected.experiment_id === 'slow-branch' && (selected.fault_configuration?.type !== 'injected network delay' || !selected.branches.some(branch => branch.shard === selected.fault_configuration?.shard))) reason = 'The injected delay cannot be matched to a captured branch.';
  return { ...longest, available: reason === null, reason };
}
export function Comparison({ baseline, selected }: { baseline: LoadedRecording; selected: LoadedRecording }) {
  const model = useMemo(() => comparisonModel(baseline.recording, selected.recording), [baseline, selected]);
  const boundaries = [baseline.recording, selected.recording].flatMap(recording => {
    const pane = replayModel(recording);
    const start = pane.root?.start ?? 0;
    return [pane.duration, ...recording.branches.flatMap(branch => [branch.start === null ? 0 : branch.start - start, branch.end === null ? 0 : branch.end - start])];
  });
  const playback = useReplay(model, 1 / 4, boundaries);
  const fault = selected.recording.fault_configuration;
  const complete = resultVisible(model, playback.cursor);
  const plan = planEvidence(selected.recording);
  const baselineModel = replayModel(baseline.recording), selectedModel = replayModel(selected.recording);
  // Comparison availability also gates each pane; an unrelated or incomplete pair never animates.
  const paneModel = (pane: ReplayModel) => model.available ? pane : { ...pane, available: false, reason: model.reason };
  return <main className="comparison-page"><header className="topbar"><a className="brand" href={import.meta.env.BASE_URL}>shardyssey</a><span className="topbar-note">Same query. Different wait.</span><span className="recorded-tag">Recorded comparison</span></header>
    <section className="intro"><div><p className="eyebrow">EXPERIMENT 03 / SLOW BRANCH</p><h1>The answer waits<br />for the last shard.</h1><p className="intro-copy">Compare two captured executions on the same elapsed-time axis.</p></div><div className="record-facts"><span>GATEWAY COMPLETION DIFFERENCE</span><strong>{milliseconds(selectedModel.duration - baselineModel.duration)}</strong><span>Selected capture minus baseline</span></div></section>
    <section className="query-card"><div><span className="section-label">BOTH RUNS USE THIS SQL</span><code>{selected.recording.query_template}</code></div><div className="query-prompt"><span className="section-label">RECORDED FAULT</span><p>{fault ? `${fault.delay_ms} ms injected network delay · shard ${fault.shard}` : 'No injected delay'}</p></div></section>
    {!model.available && <p className="warning" role="alert">Timed comparison unavailable. {model.reason}</p>}
    <div className="comparison-controls"><PlaybackControls playback={playback} available={model.available} finished={complete} /><div className="timeline-header"><span className="section-label">SHARED ELAPSED TIME</span><output aria-label="Replay cursor">{milliseconds(playback.cursor)} / {milliseconds(model.duration)}</output></div><label className="scrubber-label"><span className="sr-only">Replay position</span><input aria-label="Replay position" type="range" min="0" max={Math.max(1, model.duration)} step="1" value={playback.cursor} onChange={event => playback.seek(Number(event.target.value))} disabled={!model.available} /></label><p className="replay-note">{playback.reducedMotion ? 'Reduced motion: step between recorded boundaries or scrub.' : `Playback ${playback.speed === 1 ? '1×' : `1/${Math.round(1 / playback.speed)}×`} · labels show original measured time.`} Both runs start at elapsed time zero. Short intervals remain inspectable.</p></div>
    <div className="comparison-grid"><ComparisonPane label="Baseline · no injected delay" loaded={baseline} model={paneModel(baselineModel)} cursor={playback.cursor} scaleDuration={model.duration} /><ComparisonPane label={fault ? `Injected network delay · ${fault.delay_ms} ms` : 'Selected capture · no injected delay'} loaded={selected} model={paneModel(selectedModel)} cursor={playback.cursor} scaleDuration={model.duration} /></div>
    <section className="plan-card" aria-label="Aggregate explanation"><span className="section-label">WHY DOES THE ANSWER WAIT?</span><p>{plan?.aggregate ? plan.explanation : 'Inspect the plan before making an aggregate claim.'}</p><p>{fault ? `The captured shard ${fault.shard} RPC remains outstanding after the other branch completes. The recorded cause is injected network delay on the tablet path; the trace does not isolate database execution time.` : 'This selected recording has no injected network delay.'}</p><small>The VEXPLAIN plan is a separate execution. Each replay uses its ordinary query trace. This is a comparison of recorded runs, not a prediction for every query.</small></section>
    <table className="duration-table"><caption>Measured RPC and gateway durations</caption><thead><tr><th scope="col">Measured interval</th><th scope="col">Baseline</th><th scope="col">Selected capture</th><th scope="col">Difference</th></tr></thead><tbody>{baseline.recording.branches.map(branch => { const other = selected.recording.branches.find(other => other.shard === branch.shard); return <tr key={branch.shard}><th scope="row">Shard {branch.shard} RPC</th><td>{milliseconds(branch.duration_us)}</td><td>{milliseconds(other?.duration_us)}</td><td>{branch.duration_us !== null && other?.duration_us != null ? milliseconds(other.duration_us - branch.duration_us) : 'Unavailable'}</td></tr>; })}<tr><th scope="row">Gateway query</th><td>{milliseconds(baselineModel.root?.duration_us)}</td><td>{milliseconds(selectedModel.root?.duration_us)}</td><td>{baselineModel.root?.duration_us != null && selectedModel.root?.duration_us != null ? milliseconds(selectedModel.root.duration_us - baselineModel.root.duration_us) : 'Unavailable'}</td></tr></tbody></table>
    <footer><span>Separate captured runs · containers on one host.</span><span>Original timestamps · clock skew not separately measured</span></footer>
  </main>;
}
function ComparisonPane({ label, loaded, model, cursor, scaleDuration }: {label: string; loaded: LoadedRecording; model: ReplayModel; cursor: number; scaleDuration: number}) {
  const [selected, setSelected] = useState(loaded.recording.branches.find(branch => branch.shard === loaded.recording.fault_configuration?.shard)?.rpc_span_id ?? loaded.recording.branches[0]?.rpc_span_id ?? '');
  const branch = loaded.recording.branches.find(branch => branch.rpc_span_id === selected);
  const finished = resultVisible(model, cursor);
  const waiting = model.available && loaded.recording.branches.some(branch => intervalState(model, cursor, branch) === 'complete') && loaded.recording.branches.some(branch => intervalState(model, cursor, branch) === 'active');
  return <section className="comparison-pane" aria-label={label}><div className="panel-heading"><div><span className="section-label">{label}</span><h2>{milliseconds(model.root?.duration_us)}</h2></div><span className="progress-status" role="status">{!model.available ? 'Timing unavailable' : finished ? 'Answer returned' : waiting ? 'Waiting for outstanding shard' : 'Query unfinished'}</span></div><Graph model={model} cursor={cursor} selected={selected} select={setSelected} /><Timeline model={model} cursor={cursor} selected={selected} select={setSelected} scaleDuration={scaleDuration} /><div className="comparison-answer" aria-label="Recorded result" data-visible={finished}><span>count(*)</span><strong>{finished ? loaded.recording.query_result?.rows[0]?.[0] ?? 'Unavailable' : '—'}</strong><small>{finished ? 'Recorded answer' : 'Awaiting gateway completion'}</small></div><details className="comparison-evidence"><summary>Inspect branch duration and evidence</summary><aside className="inspector">{branch && <Evidence branch={branch} model={model} cursor={cursor} recordingURL={loaded.url} />}</aside></details></section>;
}
