import { useEffect, useMemo, useRef, useState } from 'react';
import { Cluster, type Seed, type Selection } from './Cluster';
import { comparisonModel, type LoadedRecording } from './comparison';
import { Evidence, Timeline } from './Evidence';
import { evidenceURL, intervalState, milliseconds, planEvidence, replayModel, resultVisible } from './recording';
import { useReplay } from './useReplay';
export function Experience({ loaded, baseline, seed, onNextExperiment, nextExperimentLabel }: {loaded: LoadedRecording; baseline?: LoadedRecording; seed: Seed; onNextExperiment?: () => void; nextExperimentLabel?: string}) {
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState<'guided' | 'explore'>('guided');
  const [step, setStep] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [inside, setInside] = useState(true);
  const [evidence, setEvidence] = useState(false);
  const [inspectionSource, setInspectionSource] = useState<'selected' | 'baseline'>('selected');
  const [mobilePane, setMobilePane] = useState<'selected' | 'baseline'>('selected');
  const selectedModel = useMemo(() => replayModel(loaded.recording), [loaded]);
  const baselineModel = useMemo(() => baseline ? replayModel(baseline.recording) : null, [baseline]);
  const model = useMemo(() => compare && baseline ? comparisonModel(baseline.recording, loaded.recording) : selectedModel, [compare, baseline, loaded, selectedModel]);
  const models = baselineModel && compare ? [baselineModel, selectedModel] : [selectedModel];
  const boundaries = models.flatMap(item => item.available && item.root?.start != null ? [item.duration, ...item.recording.branches.flatMap(branch => [branch.start! - item.root!.start!, branch.end! - item.root!.start!])] : []).filter(Number.isFinite);
  const playback = useReplay(model, loaded.recording.experiment_id === 'slow-branch' ? 1 / 4 : 1 / 2000, boundaries);
  const one = loaded.recording.experiment_id === 'one-shard';
  const fault = loaded.recording.fault_configuration;
  const plan = planEvidence(loaded.recording);
  const finished = model.available && resultVisible(selectedModel, playback.cursor);
  const active = loaded.recording.branches.filter(branch => intervalState(selectedModel, playback.cursor, branch) === 'active');
  const returned = loaded.recording.branches.filter(branch => intervalState(selectedModel, playback.cursor, branch) === 'complete');
  const waiting = active.length > 0 && returned.length > 0;
  function stepAt(position: number) {
    const origin = selectedModel.root?.start ?? 0;
    if (position === 0) return 0;
    if (position >= selectedModel.duration) return 4;
    const starts = loaded.recording.branches.map(item => (item.start ?? origin) - origin);
    const ends = loaded.recording.branches.map(item => (item.end ?? origin) - origin);
    if (position < Math.min(...starts)) return 1;
    return position < Math.min(...ends) ? 2 : 3;
  }
  useEffect(() => {
    if (mode === 'guided' && (playback.playing || playback.reducedMotion || finished)) setStep(stepAt(playback.cursor));
  }, [playback.cursor, playback.playing, playback.reducedMotion, finished, mode, loaded, selectedModel]);
  const branch = loaded.recording.branches.find(branch => branch.shard === selection) ?? loaded.recording.branches.find(branch => branch.shard === fault?.shard) ?? loaded.recording.branches[0];
  const pause = () => playback.seek(playback.cursor);
  function select(value: Selection, source: 'selected' | 'baseline' = 'selected') {setInspectionSource(source); pause(); setMode('explore'); setSelection(value); setInside(true);}
  const stepTitles = ['Where are the events?', 'How does Vitess choose?', 'Follow the query.', one ? 'One shard is enough.' : 'Every contribution matters.', 'The answer returns.'];
  const explanations = [
    one ? 'The two green tiles are user 42’s seeded events. A hash of user_id distributes rows; nearby numbers can live on different shards.' : 'The same 20 seeded events still live across two shards. This query has no user_id filter.',
    plan?.explanation ?? 'The captured plan is available in the measurement panel.',
    'Watch which connections become active. A request stays outstanding until its recorded reply arrives.',
    one ? 'Only shard -80 receives a captured branch. The other shard keeps its data, but does no work for this query.' : fault ? 'Shard -80 has replied. Shard 80- still owes its contribution because of injected network delay. The complete count must wait.' : plan?.aggregate ? 'Both captured shard calls contribute to the complete count. The captured scalar aggregate combines their counts.' : 'Both captured shard calls return before the gateway finishes. Inspect the plan for details about the aggregate.',
    'The gateway has the replies it needs. The application receives one complete count.',
  ];
  function guide(next: number) {
    const bounded = Math.max(0, Math.min(stepTitles.length - 1, next));
    const rootStart = selectedModel.root?.start ?? 0;
    const starts = loaded.recording.branches.map(branch => (branch.start ?? rootStart) - rootStart);
    const ends = loaded.recording.branches.map(branch => (branch.end ?? rootStart) - rootStart);
    const positions = [0, Math.max(0, Math.min(...starts) - 1), Math.min(...starts), Math.min(...ends), selectedModel.duration];
    playback.seek(positions[bounded]); setStep(bounded); setSelection(null); setMode('guided');
  }
  const status = !model.available ? 'Timing unavailable' : finished ? 'Answer returned' : waiting ? `Waiting for shard ${active[0].shard}` : playback.cursor === 0 ? 'Ready to follow' : active.length ? `${active.length} ${active.length === 1 ? 'branch' : 'branches'} in progress` : 'Gateway query in progress';
  const focus = mode === 'guided' ? step === 0 ? 'data' : step === 1 ? 'gateway' : step === 4 ? 'client' : 'work' : 'none';
  return <div className="experience">
    <div className="scene-toolbar"><div><span className="tiny-label">SQL</span><code>{one ? <>{loaded.recording.query_template?.split(' WHERE ')[0]} <mark>{loaded.recording.query_template?.includes(' WHERE ') ? `WHERE ${loaded.recording.query_template.split(' WHERE ')[1]}` : ''}</mark></> : <>{loaded.recording.query_template ?? 'Query unavailable'} <span className="removed-filter" aria-label="User filter removed">WHERE user_id = 42</span></>}</code></div><div className="scene-tools">{baseline && <button className={compare ? 'tool-button selected' : 'tool-button'} aria-pressed={compare} onClick={() => {pause(); setInspectionSource('selected'); setCompare(value => !value);}}>⇄ Compare</button>}<button className={inside ? 'tool-button selected' : 'tool-button'} aria-pressed={inside} onClick={() => setInside(value => !value)}>{inside ? 'Hide data' : 'Show data'}</button></div></div>
    {!model.available && <p className="warning" role="alert">Timed replay unavailable. {model.reason}</p>}
    <div className="workbench">
    <div className={`stage-frame focus-${focus} ${compare ? 'comparing' : ''}`}>
      <div className="stage-topline"><span className="stage-status" role="status"><i className={waiting ? 'waiting' : finished ? 'done' : ''} />{status}</span>{fault && <span className="fault-tag">Injected network delay · {fault.delay_ms} ms on {fault.shard}</span>}</div>
      {compare && <div className="compare-mobile-tabs" aria-label="Comparison view"><button aria-pressed={mobilePane === 'baseline'} onClick={() => setMobilePane('baseline')}>Baseline</button><button aria-pressed={mobilePane === 'selected'} onClick={() => setMobilePane('selected')}>Selected capture</button></div>}
      <div className="stage-scenes">
        {compare && baselineModel && <section className={`scene-container baseline-scene ${mobilePane === 'baseline' ? 'mobile-visible' : ''}`} aria-label="Baseline · no injected delay"><div className="compare-label"><span>BASELINE · NO DELAY</span><strong>{milliseconds(baselineModel.duration)}</strong></div><Cluster model={model.available ? baselineModel : {...baselineModel, available: false}} cursor={playback.cursor} seed={seed} selection={selection} select={value => select(value, 'baseline')} inside={inside} /></section>}
        <section className={`scene-container selected-scene ${mobilePane === 'selected' ? 'mobile-visible' : ''}`} aria-label={compare ? fault ? `Injected network delay · ${fault.delay_ms} ms` : 'Selected capture · no injected delay' : 'Cluster scene'}>{compare && <div className="compare-label"><span>{fault ? 'SELECTED · INJECTED DELAY' : 'SELECTED · NO DELAY'}</span><strong>{milliseconds(selectedModel.duration)}</strong></div>}<Cluster model={model.available ? selectedModel : {...selectedModel, available: false}} cursor={playback.cursor} seed={seed} selection={selection} select={select} inside={inside} /></section>
      </div>
      <div className="replay-dock"><button className="follow-button" disabled={!model.available} aria-label={playback.reducedMotion ? 'Step through recording' : playback.playing ? 'Pause recording' : finished ? 'Replay recording' : 'Play recording'} onClick={playback.toggle}><span aria-hidden="true">{playback.reducedMotion ? '→' : playback.playing ? 'Ⅱ' : '▶'}</span>{playback.reducedMotion ? 'Step query' : playback.playing ? 'Pause' : finished ? 'Follow again' : 'Follow query'}</button><button className="reset-button" aria-label="Reset recording" onClick={() => guide(0)} disabled={!model.available}>↺</button><label className="compact-scrubber"><span className="sr-only">Replay position</span><input aria-label="Replay position" aria-valuetext={milliseconds(playback.cursor)} type="range" min="0" max={Math.max(model.duration, 1)} step="1" value={playback.cursor} onChange={event => {const position = Number(event.target.value); playback.seek(position); if (mode === 'guided') setStep(stepAt(position));}} disabled={!model.available} /></label><output aria-label="Replay cursor">{milliseconds(playback.cursor)} <span>/ {milliseconds(model.duration)}</span></output><label className="speed-control"><span className="sr-only">Replay speed</span><select aria-label="Replay speed" value={playback.speed} onChange={event => playback.setSpeed(Number(event.target.value))} disabled={!model.available || playback.reducedMotion}>{[1, 1/2, 1/4, 1/500, 1/2000, 1/5000].map(speed => <option key={speed} value={speed}>{speed === 1 ? '1× measured' : `1/${Math.round(1/speed)}× slowed`}</option>)}</select></label></div>
    </div>
    <div className="learning-panel"><div className="learning-mode"><button aria-pressed={mode === 'guided'} onClick={() => {pause(); setSelection(null); setMode('guided');}}>Guided</button><button aria-pressed={mode === 'explore'} onClick={() => {pause(); setMode('explore');}}>Explore</button></div><div className="guide-progress" aria-label="Walkthrough steps">{stepTitles.map((title, index) => <button key={title} aria-label={`Step ${index + 1}: ${title}`} aria-current={mode === 'guided' && step === index ? 'step' : undefined} disabled={!model.available && index > 0} onClick={() => guide(index)}><span>{index + 1}</span></button>)}</div><div className="lesson-copy"><span className="tiny-label">{selection ? 'LOOK INSIDE' : `STEP ${step + 1} / ${stepTitles.length}`}</span><h2>{selection === 'gateway' ? 'The gateway chooses the route.' : selection === 'client' ? 'One query. One complete answer.' : selection ? `Inside shard ${selection}.` : stepTitles[step]}</h2><p>{selection === 'gateway' ? plan?.explanation ?? 'Open the measurement panel to inspect the captured plan.' : selection === 'client' ? 'The application asks for a count. Its answer stays empty until the recorded gateway operation finishes.' : selection ? `This shard contains ${seed.shards[selection]?.length ?? 0} seeded events. VTTablet serves the data stored by MySQL. ${selection === '80-' && one ? 'These rows remain here even when this query does not visit the shard.' : 'The highlighted connection follows the captured RPC interval.'}` : explanations[step]}</p>{selection && selection !== 'gateway' && selection !== 'client' && <details className="seed-details"><summary>See the seeded events</summary><table><thead><tr><th scope="col">user_id</th><th scope="col">event_id</th><th scope="col">category</th></tr></thead><tbody>{seed.shards[selection]?.map(row => <tr key={`${row.user_id}-${row.event_id}`}><td>{row.user_id}</td><td>{row.event_id}</td><td>{row.category}</td></tr>)}</tbody></table><small>Deterministic seed data; these rows do not show scan progress.</small></details>}{selection && <button className="text-button" onClick={() => setSelection(null)}>← Return to cluster</button>}</div>{finished && !selection && onNextExperiment && <button className="continue-button" onClick={onNextExperiment}>Next: {nextExperimentLabel}<span aria-hidden="true">→</span></button>}<div className="diagram-legend" aria-label="Diagram legend"><span><i className="legend-request" />Requested</span><span><i className="legend-complete" />Replied</span>{fault && <span><i className="legend-delay" />Delayed</span>}</div><div className="lesson-actions">{mode === 'guided' && <><span className="step-count">{String(step + 1).padStart(2, '0')} / 05</span><div className="step-buttons"><button disabled={step === 0} onClick={() => guide(step - 1)}>← Back</button><button disabled={step === 4 || !model.available} onClick={() => guide(step + 1)}>Next →</button></div></>}<button className="measurement-link" onClick={() => {pause(); setEvidence(true);}}>How was this measured? ↗</button></div></div>
    </div>
    {evidence && <MeasurementDialog loaded={compare && inspectionSource === 'baseline' && baseline ? baseline : loaded} baseline={compare && inspectionSource !== 'baseline' ? baseline : undefined} seed={seed} cursor={playback.cursor} branchID={compare && inspectionSource === 'baseline' && baseline ? baseline.recording.branches.find(branch => branch.shard === selection)?.rpc_span_id ?? baseline.recording.branches[0]?.rpc_span_id ?? '' : branch?.rpc_span_id ?? ''} close={() => setEvidence(false)} />}
  </div>;
}
function MeasurementDialog({ loaded, baseline, cursor, branchID, close }: {loaded: LoadedRecording; baseline?: LoadedRecording; seed: Seed; cursor: number; branchID: string; close: () => void}) {
  const panel = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(branchID);
  const model = useMemo(() => replayModel(loaded.recording), [loaded]);
  const branch = loaded.recording.branches.find(branch => branch.rpc_span_id === selected);
  const plan = planEvidence(loaded.recording);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {event.preventDefault(); close();}
      if (event.key === 'Tab') {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, a[href], select, summary, [tabindex="0"]') ?? []);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => {document.removeEventListener('keydown', keyboard); previous?.focus();};
  }, [close]);
  return <div className="modal-backdrop" onClick={event => {if (event.target === event.currentTarget) close();}}><div ref={panel} className="measurement-panel" role="dialog" aria-modal="true" aria-labelledby="measurement-title"><header><div><span className="tiny-label">RECORDED EXECUTION</span><h2 id="measurement-title">How was this measured?</h2></div><button aria-label="Close measurements" onClick={close}>×</button></header><p>Branch activation, completion, and the final answer share the captured query clock. Row tiles come from the deterministic seed. The scene does not measure packet travel, row scanning, or a separate MySQL stage.</p><div className="measurement-meta"><span>Gateway query <strong>{milliseconds(model.root?.duration_us)}</strong></span><span>Vitess <strong>{loaded.recording.vitess_version}</strong></span><span>Run <code>{loaded.recording.run_id}</code></span></div><label className="branch-select">Inspect branch <select value={selected} onChange={event => setSelected(event.target.value)}>{loaded.recording.branches.map(branch => <option key={branch.rpc_span_id} value={branch.rpc_span_id}>Shard {branch.shard}</option>)}</select></label><div className="timeline-scroll" role="region" aria-label="Recorded timing diagram" tabIndex={0}><Timeline model={model} cursor={cursor} selected={selected} select={setSelected} /></div><aside className="inspector">{branch && <Evidence branch={branch} model={model} cursor={cursor} recordingURL={loaded.url} />}</aside>{baseline && <section className="baseline-measurements"><h3>Baseline and selected run</h3><p>Baseline gateway: {milliseconds(replayModel(baseline.recording).duration)} · Selected: {milliseconds(model.duration)}</p><a href={baseline.url} target="_blank" rel="noreferrer">Inspect baseline recording ↗</a></section>}<div className="measurement-sources">{plan && <a href={evidenceURL(loaded.url, plan.evidence.evidence_path)} target="_blank" rel="noreferrer">Captured VEXPLAIN plan ↗</a>}<a href={evidenceURL(loaded.url, '../seed--80.tsv')} target="_blank" rel="noreferrer">Seeded events · shard -80 ↗</a><a href={evidenceURL(loaded.url, '../seed-80-.tsv')} target="_blank" rel="noreferrer">Seeded events · shard 80- ↗</a><a href={loaded.url} target="_blank" rel="noreferrer">Normalized recording ↗</a></div><small>VEXPLAIN is a separate execution. RPC durations include network wait. Containers share one host clock; clock skew is not separately measured.</small></div></div>;
}
