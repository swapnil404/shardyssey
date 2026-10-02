import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { intervalState, planEvidence, resultVisible, type ReplayModel } from './recording';
export interface SeedRow { user_id: number; event_id: number; category: string }
export interface Seed {schema_version: number; shards: Record<string, SeedRow[]>}
export type Selection = 'client' | 'gateway' | '-80' | '80-' | null;
export function Cluster({ model, cursor, seed, selection, select, inside = true }: {model: ReplayModel; cursor: number; seed: Seed; selection: Selection; select: (value: Selection) => void; inside?: boolean}) {
  const id = useId();
  const canvas = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState({width: 1000, height: 440, request: 'M270 232 H370', branches: ['M580 232 H635 V145 H700', 'M580 232 H635 V326 H700'], ends: [{x: 700, y: 145}, {x: 700, y: 326}]});
  useLayoutEffect(() => {
    const host = canvas.current;
    if (!host) return;
    function measure() {
      if (!host || !host.clientWidth) return;
      const boxes = ['.terminal', '.gateway', '.shard-0', '.shard-1'].map(selector => host.querySelector<HTMLElement>(selector));
      if (boxes.some(box => !box)) return;
      const [app, gate, ...shards] = boxes.map(box => ({x: box!.offsetLeft, y: box!.offsetTop, w: box!.offsetWidth, h: box!.offsetHeight}));
      const vertical = getComputedStyle(host).display === 'grid';
      const request = vertical ? `M${app.x + app.w / 2} ${app.y + app.h} V${gate.y}` : `M${app.x + app.w} ${app.y + app.h / 2} H${(app.x + app.w + gate.x) / 2} V${gate.y + gate.h / 2} H${gate.x}`;
      const ends = shards.map(shard => vertical ? {x: shard.x + shard.w / 2, y: shard.y} : {x: shard.x, y: shard.y + shard.h / 2});
      const branches = ends.map((end, index) => vertical ? `M${gate.x + gate.w / 2} ${gate.y + gate.h} V${(gate.y + gate.h + end.y) / 2} H${end.x} V${end.y}` : `M${gate.x + gate.w} ${gate.y + gate.h / 2 + (index ? 9 : -9)} H${(gate.x + gate.w + end.x) / 2} V${end.y} H${end.x}`);
      const next = {width: host.clientWidth, height: host.clientHeight, request, branches, ends};
      setWires(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    host.querySelectorAll('.device').forEach(device => observer.observe(device));
    return () => observer.disconnect();
  }, []);
  const finished = resultVisible(model, cursor);
  const one = model.recording.experiment_id === 'one-shard';
  const state = (shard: string) => {
    const branch = model.recording.branches.find(branch => branch.shard === shard);
    return branch ? intervalState(model, cursor, branch) : model.available ? 'untouched' : 'unavailable';
  };
  const rootState = model.root ? intervalState(model, cursor, model.root) : 'unavailable';
  const key = (event: KeyboardEvent, value: Selection) => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); select(value);}};
  const route = planEvidence(model.recording)?.routing;
  return <div ref={canvas} className={`cluster ${inside ? 'cutaway' : 'enclosed'} ${selection ? 'has-selection' : ''}`} aria-label="Interactive cluster">
    <div className="diagram-columns" aria-hidden="true"><span>THE APPLICATION</span><span>THE GATEWAY</span><span>THE SHARDS</span></div>
    <svg className="cluster-paths" viewBox={`0 0 ${wires.width} ${wires.height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="currentColor" strokeWidth="1.3" /></marker></defs>
      <path className={`query-path ${cursor === 0 ? 'pending' : rootState}`} d={wires.request} markerEnd={`url(#${id})`} />
      {['-80', '80-'].map((shard, index) => <g key={shard}><path data-testid={`route-${shard}`} data-state={state(shard)} className={`query-path ${state(shard)} ${model.recording.fault_configuration?.shard === shard ? 'injected' : ''}`} d={wires.branches[index]} markerEnd={`url(#${id})`} /><circle className={`junction ${state(shard)}`} cx={wires.ends[index].x} cy={wires.ends[index].y} r="4" /></g>)}
    </svg>
    <div className={`terminal device ${selection === 'client' ? 'selected' : ''}`}>
      <button className="terminal-header" onClick={() => select('client')} aria-label="Inspect application"><span>Application</span><span>↗</span></button>
      <div className="terminal-body"><code>{(model.recording.query_template ?? 'Query unavailable').split(/\s(?=FROM|WHERE)/).map((part,index)=><span key={index} className={part.startsWith('WHERE') ? 'sql-filter sql-line' : 'sql-line'}>{part}</span>)}</code><div className="result-slot" aria-label="Recorded result" data-visible={finished}><span>count(*)</span><strong>{finished ? model.recording.query_result?.rows[0]?.[0] ?? 'Unavailable' : '—'}</strong><small>{finished ? 'Answer returned' : 'Awaiting answer'}</small></div></div>
    </div>
    <div className={`gateway device ${rootState} ${selection === 'gateway' ? 'selected' : ''}`} role="button" tabIndex={0} aria-label="Inspect VTGate" aria-pressed={selection === 'gateway'} onClick={()=>select('gateway')} onKeyDown={event=>key(event,'gateway')}>
      <div className="node-heading"><span className={`state-light ${cursor === 0 ? 'pending' : rootState}`} /><h2>VTGate</h2><span className="node-arrow">↗</span></div><p className="node-description">Query router</p><div className="routing-chip">{route === 'EqualUnique' ? 'user_hash → one shard' : route === 'Scatter' ? 'Scatter → both shards' : 'Inspect captured route'}</div>
      <div className="assembly"><span className="assembly-label">REPLIES</span>{['-80','80-'].map(shard=><div key={shard} className={`contribution ${state(shard)}`}><span>{shard}</span><span>{state(shard)==='complete' ? '✓ received' : state(shard)==='active' ? '··· outstanding' : state(shard)==='untouched' ? 'not requested' : state(shard)==='unavailable' ? 'unknown' : 'not sent yet'}</span></div>)}</div>
    </div>
    {model.recording.topology_snapshot.tablets.map((tablet,index)=>{
      const shard=tablet.shard ?? 'unknown', branchState=state(shard), delayed=model.recording.fault_configuration?.shard===shard;
      return <div key={tablet.alias} className={`shard-machine device shard-${index} ${branchState} ${delayed ? 'injected' : ''} ${selection===shard ? 'selected' : ''}`} data-testid={`shard-${shard}`} data-state={branchState} role="button" tabIndex={0} aria-label={`Inspect shard ${shard}`} aria-pressed={selection===shard} onClick={()=>select(shard as Selection)} onKeyDown={event=>key(event,shard as Selection)}>
        <div className="node-heading"><span className={`state-light ${branchState}`} /><h2>Shard {shard}</h2><span className="node-arrow">↗</span></div><p className="node-description">VTTablet + MySQL</p>
        <div className="data-tray" aria-label={`Seeded events in shard ${shard}`}><div className="tray-heading"><span>events / user_id</span><span>{seed.shards[shard]?.length ?? '?'} rows</span></div><div className="row-tiles">{seed.shards[shard]?.map(row=><span key={`${row.user_id}-${row.event_id}`} className={`row-tile ${one && row.user_id===42 ? 'matched' : ''}`} title={`user ${row.user_id} · event ${row.event_id} · ${row.category}`}><b>{row.user_id}</b></span>)}</div><div className="tray-cover">Data hidden</div></div>
        <div className="machine-foot"><span>{branchState==='untouched' ? 'No query sent' : branchState==='active' ? delayed ? 'Waiting · network delay' : 'RPC in progress' : branchState==='complete' ? '✓ Contribution returned' : branchState==='unavailable' ? 'Timing unavailable' : 'Ready for query'}</span>{delayed && <span className="delay-chip">+{model.recording.fault_configuration!.delay_ms} ms network</span>}</div>
      </div>;
    })}
    <div className="scene-caption"><span><i />Recorded RPC intervals · illustrative connections</span><span>Select a node to look inside ↗</span></div>
  </div>;
}

export function parseSeed(value: unknown): Seed {
  const seed = value as Seed;
  if (!seed || seed.schema_version !== 1 || !seed.shards || Object.keys(seed.shards).sort().join(',') !== '-80,80-') throw new Error('Seeded data is unavailable.');
  const seen = new Set<string>();
  for (const rows of Object.values(seed.shards)) {
    if (!Array.isArray(rows)) throw new Error('Invalid seeded rows.');
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.user_id) || !Number.isSafeInteger(row.event_id) || !['view', 'click'].includes(row.category) || seen.has(`${row.user_id}/${row.event_id}`)) throw new Error('Invalid or duplicate seeded event.');
      seen.add(`${row.user_id}/${row.event_id}`);
    }
  }
  return seed;
}
