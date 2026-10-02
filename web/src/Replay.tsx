import { useState, type KeyboardEvent } from 'react';
import { evidenceURL, intervalState, milliseconds, replayModel, resultVisible, type Branch, type Recording, type ReplayModel } from './recording';
import { useMemo } from 'react';
import { useReplay } from './useReplay';

const stateLabel = { pending: 'Waiting', active: 'In progress', complete: 'Complete', unavailable: 'Timing unavailable' };
interface ReplayProps { recording: Recording; recordingURL: string }
export function Replay({ recording, recordingURL }: ReplayProps) {
  const model = useMemo(() => replayModel(recording), [recording]);
  const playback = useReplay(model);
  const [selected, setSelected] = useState(recording.branches[0]?.rpc_span_id ?? '');
  const branch = recording.branches.find(branch => branch.rpc_span_id === selected);
  const finished = resultVisible(model, playback.cursor);
  const rootState = model.root ? intervalState(model, playback.cursor, model.root) : 'unavailable';
  const speedLabel = playback.speed === 1 ? '1×' : `1/${Math.round(1 / playback.speed)}×`;
  return <main>
    <header className="topbar"><a className="brand" href={import.meta.env.BASE_URL} aria-label="shardyssey home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>shardyssey</a><span className="topbar-note">A query, across services.</span><span className="recorded-tag"><span />Recorded execution</span></header>
    <section className="intro"><div><p className="eyebrow">EXPERIMENT 01 / ONE SHARD</p><h1>One query.<br />One destination.</h1><p className="intro-copy">A sharding key tells Vitess where to look.<br />Follow the work behind one real answer.</p></div><div className="record-facts"><span>VITESS {recording.vitess_version ?? 'UNKNOWN'}</span><strong>{milliseconds(model.root?.duration_us)}</strong><span>Measured gateway query</span><small>{recording.topology_snapshot.layout ?? 'Host placement unavailable'}</small></div></section>
    <section className="query-card" aria-label="Selected experiment"><div><span className="section-label">THE QUERY</span><code>{recording.query_template ?? 'Query unavailable'}</code></div><div className="query-prompt"><span className="section-label">BEFORE YOU PRESS PLAY</span><p>Will both shards need to answer?</p></div></section>
    {!model.available && <div className="warning" role="alert"><strong>Timed replay unavailable.</strong> {model.reason}{recording.warnings.map(warning => <p key={`${warning.code}-${warning.span_id}`}>{warning.message}</p>)}</div>}
    <div className="workspace"><section className="replay-card" aria-label="Query replay">
      <div className="panel-heading"><div><span className="section-label">THE ROUTE</span><h2>Client → gateway → shard</h2></div><span className={`progress-status ${rootState}`} role="status">{finished ? 'Answer returned' : stateLabel[rootState]}</span></div>
      <Graph model={model} cursor={playback.cursor} selected={selected} select={setSelected} />
      <div className="graph-caption"><span><i className="legend-active" />Measured RPC interval</span><span><i className="legend-muted" />Untouched shard stays visible</span></div>
      <div className="playback"><div className="playback-actions"><button className="play-button" onClick={playback.toggle} disabled={!model.available} aria-label={playback.reducedMotion ? 'Step through recording' : playback.playing ? 'Pause recording' : finished ? 'Replay recording' : 'Play recording'}><span aria-hidden="true">{playback.reducedMotion ? '→' : playback.playing ? 'Ⅱ' : '▶'}</span>{playback.reducedMotion ? 'Step' : playback.playing ? 'Pause' : finished ? 'Replay' : 'Play'}</button><button className="reset-button" onClick={() => playback.seek(0)} disabled={!model.available} aria-label="Reset recording">↺ Reset</button></div><label className="speed-label">Replay speed<select value={playback.speed} onChange={event => playback.setSpeed(Number(event.target.value))} disabled={!model.available || playback.reducedMotion}><option value={1}>1× · measured time</option><option value={1 / 500}>1/500× · slowed</option><option value={1 / 2000}>1/2000× · slowed</option><option value={1 / 5000}>1/5000× · slowed</option></select></label></div>
      <div className="timeline-header"><span className="section-label">MEASURED TIMELINE</span><output aria-label="Replay cursor">{milliseconds(playback.cursor)} <span>/ {milliseconds(model.duration)}</span></output></div>
      <Timeline model={model} cursor={playback.cursor} select={setSelected} selected={selected} />
      <label className="scrubber-label"><span className="sr-only">Replay position</span><input aria-label="Replay position" type="range" min={0} max={Math.max(model.duration, 1)} step={1} value={playback.cursor} onChange={event => playback.seek(Number(event.target.value))} disabled={!model.available} aria-valuetext={milliseconds(playback.cursor)} /></label>
      <p className="replay-note">{playback.reducedMotion ? 'Reduced motion: step between recorded boundaries, or scrub the timeline.' : `Playback ${speedLabel}${playback.speed === 1 ? '. Measurements use the original wall time.' : ' — slowed so you can see the work. The labels show measured time.'}`}</p>
    </section><aside className="inspector" aria-label="Branch evidence"><span className="section-label">LOOK INSIDE</span>{branch ? <Evidence branch={branch} model={model} cursor={playback.cursor} recordingURL={recordingURL} /> : <p>Select a captured branch to inspect its evidence.</p>}</aside></div>
    <section className={`answer-card ${finished ? 'returned' : ''}`} aria-label="Query answer"><div><span className="section-label">THE ANSWER</span><h2>{finished ? 'The count comes back.' : 'An answer needs completed work.'}</h2><p>{finished ? 'The recorded query finished after its required shard replied.' : 'Play or scrub to the end of the gateway interval to reveal the recorded result.'}</p></div><div className="result" aria-label="Recorded result" data-visible={finished}><span>{recording.query_result?.columns[0] ?? 'Result'}</span><strong>{finished ? recording.query_result?.rows[0]?.[0] ?? 'Unavailable' : '—'}</strong><small>{finished ? 'Recorded result' : 'Awaiting completion'}</small></div></section>
    <footer><span>A replay of measured work. Containers on one host.</span><span>Original timestamps · clock skew not separately measured</span></footer>
  </main>;
}
function Graph({ model, cursor, selected, select }: { model: ReplayModel; cursor: number; selected: string; select: (id: string) => void }) {
  const rootState = model.root ? intervalState(model, cursor, model.root) : 'unavailable';
  const positions = model.recording.topology_snapshot.tablets.map((tablet, index) => ({ tablet, y: 54 + index * 138 }));
  const key = (event: KeyboardEvent<SVGGElement>, id: string) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(id); } };
  return <div className="graph-viewport"><svg className="service-graph" viewBox="0 0 840 345" aria-label="Recorded service graph"><defs><pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.7" fill="#e5e7df" /></pattern></defs><rect width="840" height="345" fill="url(#dots)" />
    <path className="connection client-connection" d="M 174 170 H 262" />
    {positions.map(({ tablet, y }) => {
      const branch = model.recording.branches.find(branch => branch.tablet === tablet.alias);
      const state = branch ? intervalState(model, cursor, branch) : model.available ? 'untouched' : 'unavailable';
      return <g key={tablet.alias}>
        <path className={`connection route ${state}`} data-testid={`route-${tablet.shard}`} data-state={state} d={`M 436 170 H 474 Q 488 170 488 ${y + 46} H 560`} />
        {branch && <text className={`route-duration ${state}`} x="496" y={y + 24}>{milliseconds(branch.duration_us)}</text>}
        <g className={`service shard ${state} ${branch?.rpc_span_id === selected ? 'selected' : ''}`} data-testid={`shard-${tablet.shard}`} data-state={state} transform={`translate(560 ${y})`} role={branch ? 'button' : undefined} tabIndex={branch ? 0 : undefined} aria-label={branch ? `Inspect shard ${tablet.shard}` : `Shard ${tablet.shard}: ${state === 'untouched' ? 'untouched in this complete recording' : 'timing unavailable'}`} aria-pressed={branch ? branch.rpc_span_id === selected : undefined} onClick={branch ? () => select(branch.rpc_span_id) : undefined} onKeyDown={branch ? event => key(event, branch.rpc_span_id) : undefined}>
          <rect className="node-rect" width="230" height="96" rx="10" /><text className="node-eyebrow" x="20" y="25">SHARD SERVICE</text><text className="node-title" x="20" y="50">{tablet.shard ?? 'Unknown shard'}</text><text className="node-caption" x="20" y="74">VTTablet + MySQL</text><circle className="state-dot" cx="208" cy="25" r="4" />
        </g><text className="node-status" x="560" y={y + 117}>{state === 'untouched' ? 'Not touched by this query' : stateLabel[state]}</text>
      </g>;
    })}
    <g className="service client" transform="translate(28 123)"><rect className="node-rect" width="146" height="94" rx="10" /><text className="node-eyebrow" x="18" y="25">APPLICATION</text><text className="node-title" x="18" y="51">Client</text><text className="node-caption" x="18" y="75">One SQL query</text></g>
    <g className={`service gateway ${rootState}`} data-state={rootState} transform="translate(262 123)"><rect className="node-rect" width="174" height="94" rx="10" /><text className="node-eyebrow" x="18" y="25">QUERY GATEWAY</text><text className="node-title" x="18" y="51">VTGate</text><text className="node-caption" x="18" y="75">Routes by user_id</text><circle className="state-dot" cx="151" cy="25" r="4" /></g>
    <text className="edge-caption" x="200" y="157">SQL</text><text className="graph-footnote" x="28" y="322">Tap the captured shard to inspect its RPC.</text>
  </svg></div>;
}
function Timeline({ model, cursor, select, selected }: { model: ReplayModel; cursor: number; select: (id: string) => void; selected: string }) {
  const rootStart = model.root?.start ?? 0;
  const width = 586;
  const x = (time: number) => 174 + width * Math.max(0, Math.min(1, time / (model.duration || 1)));
  return <svg className="timeline" viewBox="0 0 820 150" aria-label="Measured query and shard intervals">
    {[0, 0.25, 0.5, 0.75, 1].map(tick => <g key={tick}><line className="timeline-grid" x1={x(tick * model.duration)} x2={x(tick * model.duration)} y1="20" y2="119" /><text className="axis-label" x={x(tick * model.duration)} y="140" textAnchor="middle">{(tick * model.duration / 1000).toFixed(2)}</text></g>)}
    <text className="lane-name" x="28" y="42">Gateway query</text><rect className={`interval root ${model.root ? intervalState(model, cursor, model.root) : 'unavailable'}`} x="174" y="28" width={model.available ? width : 0} height="19" rx="3" />
    {model.recording.topology_snapshot.tablets.map((tablet, index) => {
      const branch = model.recording.branches.find(branch => branch.tablet === tablet.alias);
      const state = branch ? intervalState(model, cursor, branch) : model.available ? 'untouched' : 'unavailable';
      const y = 65 + index * 31;
      return <g key={tablet.alias} data-testid={`timeline-${tablet.shard}`} data-state={state}><text className="lane-name" x="28" y={y + 14}>Shard {tablet.shard}</text>{branch && model.available && branch.start !== null && branch.end !== null ? <rect role="button" tabIndex={0} aria-label={`Inspect timeline shard ${tablet.shard}`} aria-pressed={branch.rpc_span_id === selected} onClick={() => select(branch.rpc_span_id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(branch.rpc_span_id); } }} className={`interval branch ${state}`} x={x(branch.start - rootStart)} y={y} width={Math.max(1, x(branch.end - rootStart) - x(branch.start - rootStart))} height="19" rx="3" /> : <text className="lane-empty" x="185" y={y + 14}>{state === 'untouched' ? 'No captured RPC' : 'Timing unavailable'}</text>}</g>;
    })}
    {model.available && <line className="timeline-cursor" x1={x(cursor)} x2={x(cursor)} y1="16" y2="120" />}
    <text className="axis-unit" x="805" y="140" textAnchor="end">ms</text>
  </svg>;
}
function Evidence({ branch, model, cursor, recordingURL }: { branch: Branch; model: ReplayModel; cursor: number; recordingURL: string }) {
  const rpc = model.recording.spans.find(span => span.id === branch.rpc_span_id);
  const source = (relative: string) => evidenceURL(recordingURL, relative);
  return <><h2>Shard {branch.shard}</h2><p className="inspector-summary">The branch behind this answer.</p><span className={`evidence-state ${intervalState(model, cursor, branch)}`}>{stateLabel[intervalState(model, cursor, branch)]}</span><dl className="evidence-facts"><div><dt>Measured RPC</dt><dd className="duration-value">{milliseconds(branch.duration_us)}</dd></div><div><dt>Component</dt><dd>VTTablet + MySQL</dd></div><div><dt>Tablet</dt><dd className="mono">{branch.tablet}</dd></div><div><dt>Operation</dt><dd className="mono">{rpc?.operation ?? 'Unavailable'}</dd></div><div><dt>From query start</dt><dd>{branch.start !== null && model.root?.start !== null && model.root ? milliseconds(branch.start - model.root.start) : 'Unavailable'}</dd></div></dl><p className="evidence-explanation">This interval measures the gateway’s call to the tablet. It includes the network wait; it does not isolate MySQL execution.</p><div className="evidence-links"><a href={source(rpc?.evidence_path ?? 'jaeger.json')} target="_blank" rel="noreferrer">Inspect trace evidence <span aria-hidden="true">↗</span></a><a href={source(branch.topology_evidence_path)} target="_blank" rel="noreferrer">Inspect tablet identity <span aria-hidden="true">↗</span></a></div><details><summary>Supporting span IDs</summary><ul className="span-list">{branch.supporting_span_ids.map(id => <li key={id}><code>{id}</code></li>)}</ul><p>{branch.identity_source}</p><code className="pointer">{rpc?.evidence_pointer}</code></details><div className="lesson"><span className="section-label">WHAT CHANGED?</span><p>The <code>user_id</code> filter lets VTGate use the hash vindex to target one shard.</p></div></>;
}
