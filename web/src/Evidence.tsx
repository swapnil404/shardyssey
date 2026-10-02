import { evidenceURL, intervalState, milliseconds, planEvidence, type Branch, type ReplayModel } from './recording';
const stateLabel = { pending: 'Not sent', active: 'In progress', complete: 'Complete', unavailable: 'Timing unavailable' };
export function Timeline({ model, cursor, select, selected, scaleDuration = model.duration }: { model: ReplayModel; cursor: number; select: (id: string) => void; selected: string; scaleDuration?: number }) {
  const rootStart = model.root?.start ?? 0;
  const width = 586;
  const x = (time: number) => 174 + width * Math.max(0, Math.min(1, time / (scaleDuration || 1)));
  return <svg className="timeline" viewBox="0 0 820 150" aria-label="Measured query and shard intervals">
    {[0, 0.25, 0.5, 0.75, 1].map(tick => <g key={tick}><line className="timeline-grid" x1={x(tick * scaleDuration)} x2={x(tick * scaleDuration)} y1="20" y2="119" /><text className="axis-label" x={x(tick * scaleDuration)} y="140" textAnchor="middle">{(tick * scaleDuration / 1000).toFixed(2)}</text></g>)}
    <text className="lane-name" x="28" y="42">Gateway query</text><rect className={`interval root ${model.root ? intervalState(model, cursor, model.root) : 'unavailable'}`} x="174" y="28" width={model.available ? width * model.duration / (scaleDuration || 1) : 0} height="19" rx="3" />
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
export function Evidence({ branch, model, cursor, recordingURL }: { branch: Branch; model: ReplayModel; cursor: number; recordingURL: string }) {
  const rpc = model.recording.spans.find(span => span.id === branch.rpc_span_id);
  const source = (relative: string) => evidenceURL(recordingURL, relative);
  return <><header className="evidence-heading"><div><span className="section-label">TABLET CALL</span><h3>Shard {branch.shard}</h3></div><span className={`evidence-state ${intervalState(model, cursor, branch)}`}>{stateLabel[intervalState(model, cursor, branch)]}</span></header><p className="inspector-summary">The branch behind this answer.</p><dl className="evidence-facts"><div><dt>Measured RPC</dt><dd className="duration-value">{milliseconds(branch.duration_us)}</dd></div><div><dt>Component</dt><dd>VTTablet + MySQL</dd></div><div><dt>Tablet</dt><dd className="mono">{branch.tablet}</dd></div><div><dt>Operation</dt><dd className="mono">{rpc?.operation ?? 'Unavailable'}</dd></div><div><dt>From query start</dt><dd>{branch.start !== null && model.root?.start !== null && model.root ? milliseconds(branch.start - model.root.start) : 'Unavailable'}</dd></div></dl><p className="evidence-explanation">This interval measures the gateway’s call to the tablet. It includes the network wait; it does not isolate MySQL execution.</p><div className="evidence-links"><a href={source(rpc?.evidence_path ?? 'jaeger.json')} target="_blank" rel="noreferrer">Inspect trace evidence <span aria-hidden="true">↗</span></a><a href={source(branch.topology_evidence_path)} target="_blank" rel="noreferrer">Inspect tablet identity <span aria-hidden="true">↗</span></a></div><details><summary>Supporting span IDs</summary><ul className="span-list">{branch.supporting_span_ids.map(id => <li key={id}><code>{id}</code></li>)}</ul><p>{branch.identity_source}</p><code className="pointer">{rpc?.evidence_pointer}</code></details><div className="lesson"><span className="section-label">WHAT CHANGED?</span><p>{planEvidence(model.recording)?.explanation ?? 'Inspect the captured plan for routing evidence.'}</p></div></>;
}

