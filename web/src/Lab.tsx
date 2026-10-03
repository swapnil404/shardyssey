import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { travelTime } from './motion';
import { execute, partitions, rows, shardFor, tenants, type EventRow, type Outcome, type QueryField, type ShardKey } from './lab-model';

function DataTable({data}: {data: EventRow[]}) {
  return <div className="sl-table-scroll"><table><thead><tr><th>event_id</th><th>tenant_id</th><th>user_id</th><th>action</th></tr></thead><tbody>{data.map(row => <tr key={row.event_id} data-event={row.event_id}><td>{row.event_id}</td><td><span className="sl-table-tenant"><i className={`tenant-dot t${row.tenant_id}`} /><span>{tenants[row.tenant_id - 1]}</span><small>{row.tenant_id}</small></span></td><td>{row.user_id}</td><td><span className={`sl-table-action action-${row.action}`}>{row.action}</span></td></tr>)}</tbody></table></div>;
}
function ClusterWires({host, distributed, phase, contacted, playing, replies, speed, onGeometry}: {host: React.RefObject<HTMLDivElement | null>; distributed: boolean; phase: number; contacted: number[]; playing: boolean; replies: number[]; speed: number; onGeometry: React.Dispatch<React.SetStateAction<{request: number; branch: number}>>}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [requestPath, setRequestPath] = useState('');
  const [lengths, setLengths] = useState<number[]>([]);
  const [paths, setPaths] = useState<{id: number; d: string}[]>([]);
  useEffect(() => {
    const scene = host.current;
    if (!scene) return;
    function measure() {
      if (!scene) return;
      const base = scene.getBoundingClientRect();
      const router = scene.querySelector('.sl-router')!.getBoundingClientRect();
      const targets = Array.from(scene.querySelectorAll(distributed ? '.sl-shard' : '.sl-source'));
      const vertical = getComputedStyle(scene).gridTemplateColumns.split(' ').length === 2;
      const app = scene.querySelector('.sl-client svg')!.getBoundingClientRect();
      if (vertical) {
        const x = app.left + app.width / 2 - base.left;
        setRequestPath(`M ${x} ${app.bottom - base.top} V ${router.top - base.top}`);
        const carrier = scene.querySelector<HTMLElement>('.sl-main-wire')!;
        Object.assign(carrier.style, {left:`${x}px`, top:`${app.bottom-base.top}px`, width:'1px', height:`${router.top-app.bottom}px`});
      } else {
        const x = app.left + app.width * .94 - base.left;
        const y = router.top + router.height / 2 - base.top;
        const endX = router.left - base.left;
        setRequestPath(`M ${x} ${y} H ${endX}`);
        const carrier = scene.querySelector<HTMLElement>('.sl-main-wire')!;
        Object.assign(carrier.style, {left:`${x}px`, top:`${y}px`, width:`${endX-x}px`, height:'1px'});
      }
      setPaths(targets.map((target, id) => {
        const box = target.getBoundingClientRect();
        if (vertical) {
          const x = router.left + router.width / 2 - base.left;
          const y = router.bottom - base.top;
          const endX = box.left + box.width / 2 - base.left;
          const endY = box.top - base.top;
          const bridgeY = y + 14;
          if (box.top > targets[0].getBoundingClientRect().top + 1) {
            const outside = id % 2 === 0 ? box.left - base.left - 7 : box.right - base.left + 7;
            return {id, d: `M ${x} ${y} V ${bridgeY} H ${outside} V ${endY - 5} H ${endX} V ${endY}`};
          }
          return {id, d: `M ${x} ${y} V ${bridgeY} H ${endX} V ${endY}`};
        }
        const startX = router.right - base.left;
        const startY = router.top + router.height / 2 - base.top;
        if (!distributed) return {id, d: `M ${startX} ${startY} H ${box.left - base.left}`};
        const trunk = (startX + targets[0].getBoundingClientRect().left - base.left) / 2;
        const endX = box.left + box.width / 2 - base.left;
        const endY = id < 2 ? box.top - base.top : box.bottom - base.top;
        const laneY = endY + (id < 2 ? -12 : 12);
        return {id, d: `M ${startX} ${startY} H ${trunk} V ${laneY} H ${endX} V ${endY}`};
      }));
    }
    measure();
    const observer = new ResizeObserver(measure); observer.observe(scene);
    scene.querySelectorAll('.sl-shard,.sl-source,.sl-router,.sl-client').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [host, distributed]);
  const routeIds = contacted.join(',');
  useLayoutEffect(() => {
    const distances = Array.from(svgRef.current?.querySelectorAll<SVGPathElement>('.sl-route > path') ?? []).map(path => {
      const measured = path.getTotalLength?.();
      return measured && measured > 0 ? measured : 384;
    });
    setLengths(previous => previous.join(',') === distances.join(',') ? previous : distances);
    const request = svgRef.current?.querySelector<SVGPathElement>('.sl-request-path')?.getTotalLength?.() ?? 0;
    const branch = Math.max(...contacted.map(id => distances[id] ?? 384));
    onGeometry(previous => {
      const next = {request: request > 1 ? request : 384, branch};
      return previous.request === next.request && previous.branch === next.branch ? previous : next;
    });
  }, [paths, requestPath, routeIds, host, onGeometry]);
  useLayoutEffect(() => {
    // A newly inserted SMIL animation otherwise starts at SVG time zero,
    // which is already in the past by the routing or return stage.
    svgRef.current?.querySelectorAll<SVGAnimateMotionElement>('animateMotion').forEach(animation => animation.beginElement?.());
  }, [phase, paths]);
  useEffect(() => {
    if (playing) svgRef.current?.unpauseAnimations?.();
    else svgRef.current?.pauseAnimations?.();
  }, [playing, phase]);
  return <svg ref={svgRef} className="sl-wires" aria-hidden="true"><path className="sl-request-path" d={requestPath} />{paths.map(path => {
    const active = distributed && phase >= 2 && contacted.includes(path.id);
    return <g className="sl-route" key={path.id}><path className={active ? 'wire-active' : ''} d={path.d} />{active && phase < 4 && <g className="sl-transit" key={`${path.id}-${phase}`}>
      {phase === 3 ? <><rect x="-22" y="-10" width="44" height="20" rx="2" fill="#ffdda8" /><text x="0" y="3" textAnchor="middle" fill="#3b290b" fontSize="9" fontFamily="monospace">{replies[path.id]} rows</text></> : <rect x="-4" y="-4" width="8" height="8" rx="1" fill="#f3ad65" />}
      <animateMotion begin="indefinite" dur={`${travelTime(lengths[path.id] ?? 384, speed)}ms`} repeatCount="1" fill="freeze" path={path.d} keyPoints={phase === 3 ? '1;0' : '0;1'} keyTimes="0;1" calcMode="linear" />
    </g>}</g>;
  })}</svg>;

}
export function Lab() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const beforeRects = useRef(new Map<number, {x: number; y: number}>());
  const rowAnimations = useRef<Animation[]>([]);
  const moveTimer = useRef<number | undefined>(undefined);
  const [moving, setMoving] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [geometry, setGeometry] = useState({request: 384, branch: 384});
  const [key, setKey] = useState<ShardKey>('tenant_id');
  const [distributed, setDistributed] = useState(false);
  const [field, setField] = useState<QueryField>('tenant_id');
  const [value, setValue] = useState(1);
  const [phase, setPhase] = useState(0);
  const [reviewStage, setReviewStage] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [last, setLast] = useState<Outcome | null>(null);
  const [previous, setPrevious] = useState<Outcome | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<{row: EventRow; shard: number; x: number; y: number} | null>(null);
  function previewEvent(row: EventRow, shard: number, tile: HTMLButtonElement) {
    const box = tile.getBoundingClientRect();
    setHoveredEvent({row, shard, x: Math.max(12, Math.min(box.left, window.innerWidth - 228)), y: box.bottom + 184 > window.innerHeight ? Math.max(12, box.top - 176) : box.bottom + 10});
  }
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [inspected, setInspected] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [runNumber, setRunNumber] = useState(0);
  const outcome = execute(key, field, value);
  const data = partitions(key);
  const busy = phase > 0 && phase < 4;
  const finished = phase === 4;
  const motionAllowed = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function captureRows() {
    if (!motionAllowed()) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const source = scene.querySelector('.sl-source .sl-table-scroll')?.getBoundingClientRect();
    const positions = new Map<number, {x: number; y: number}>();
    scene.querySelectorAll<HTMLElement>('[data-event]').forEach(node => {
      const box = node.getBoundingClientRect();
      // Rows outside the scroll window leave through the visible edge of the source table.
      positions.set(Number(node.dataset.event), {x: box.x + (node.tagName === 'TR' ? 12 : 0), y: source ? Math.max(source.top, Math.min(box.y, source.bottom - 22)) : box.y});
    });
    beforeRects.current = positions;
  }
  useLayoutEffect(() => {
    if (!distributed || !beforeRects.current.size) return;
    rowAnimations.current.forEach(animation => animation.cancel());
    const animations: Animation[] = [];
    let duration = 0;
    sceneRef.current?.querySelectorAll<HTMLElement>('.sl-row-tile[data-event]').forEach(node => {
      const old = beforeRects.current.get(Number(node.dataset.event));
      if (!old || typeof node.animate !== 'function') return;
      const box = node.getBoundingClientRect();
      const dx = old.x - box.x, dy = old.y - box.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      const rowDuration = travelTime(Math.hypot(dx, dy), speed);
      duration = Math.max(duration, rowDuration);
      const animation = node.animate([
        {transform: `translate(${dx}px, ${dy}px)`},
        {transform: 'translate(0, 0)'},
      ], {duration: rowDuration, easing: 'linear', fill: 'backwards'});
      animations.push(animation);
    });
    rowAnimations.current = animations;
    beforeRects.current.clear();
    if (animations.length) {
      setMoving(true);
      window.clearTimeout(moveTimer.current);
      moveTimer.current = window.setTimeout(() => setMoving(false), duration);
    }
  }, [distributed, key, speed]);
  useEffect(() => () => {window.clearTimeout(moveTimer.current); rowAnimations.current.forEach(animation => animation.cancel());}, []);
  const requestDuration = travelTime(geometry.request, speed);
  const branchDuration = travelTime(geometry.branch, speed);
  const phaseDuration = phase === 1 ? requestDuration : phase === 2 ? branchDuration : branchDuration + requestDuration;
  useEffect(() => {
    if (!playing || !busy) return;
    const timer = window.setTimeout(() => {
      if (phase === 3) {setLast(execute(key, field, value)); setPlaying(false);}
      setPhase(current => current + 1);
    }, phaseDuration);
    return () => window.clearTimeout(timer);
  }, [playing, busy, phase, key, field, value, phaseDuration]);
  function changeKey(next: ShardKey) {
    if (next === key || busy || moving) return;
    if (distributed) captureRows();
    const baseline = last ?? previous;
    setPrevious(baseline && baseline.key !== next ? baseline : null);
    setLast(null); setKey(next); setPhase(0); setPlaying(false); setInspected(null); setSelectedEvent(null); setHoveredEvent(null); setShowResults(false);
  }
  function changeQuery(nextField: QueryField, nextValue: number) {
    setField(nextField); setValue(nextValue); setPhase(0); setLast(null); setPrevious(null); setShowResults(false); setInspected(null); setSelectedEvent(null); setHoveredEvent(null);
  }
  function run() {setReviewStage(3); setHoveredEvent(null); setPhase(1); setPlaying(true); setLast(null); setShowResults(false); setRunNumber(n => n + 1);}
  function step() {if (phase === 3) {setLast(outcome); setPlaying(false);} setPhase(n => n + 1);}
  function reset() {rowAnimations.current.forEach(animation => animation.cancel()); window.clearTimeout(moveTimer.current); beforeRects.current.clear(); setMoving(false); setDistributed(false); setKey('tenant_id'); setField('tenant_id'); setValue(1); setPhase(0); setPlaying(false); setLast(null); setPrevious(null); setInspected(null); setSelectedEvent(null); setHoveredEvent(null); setShowResults(false);}
  const traceStage = finished ? reviewStage : phase;
  const traceDetails = [
    `${field} = ${value}. ${field === key ? 'Filter matches' : 'Filter differs from'} shard key ${key}.`,
    field === key ? `Shard ${shardFor(value)} (${value} % 4). The other three stay idle.` : 'Query all four shards. The filter cannot locate one shard.',
    `${outcome.contacted.length} ${outcome.contacted.length === 1 ? 'shard scans its' : 'shards scan their'} rows. Combine ${outcome.result.length} matching events.`,
  ];
  return <div className="sharding-lab">
    <header className="sl-header"><a href={import.meta.env.BASE_URL} className="sl-wordmark">shardyssey<span className="sl-brand-descriptor">sharding lab</span></a><span className="sl-label">Browser simulation</span><button className="sl-text-button" onClick={reset}>Start over ↺</button></header>
    <main>
      <section className="sl-intro"><div className="sl-intro-copy"><span className="sl-kicker">ONE TABLE · FOUR SHARDS</span><h1>Where should your data live?</h1><p>Choose a sharding key. Follow a query. Change the key and see what it costs to find the same rows.</p></div><ol className="sl-overview" aria-label="Experiment steps"><li className={!distributed ? 'current' : 'done'} aria-current={!distributed ? 'step' : undefined}><span>01</span><div>Distribute<small>Place the events</small></div></li><li className={distributed && !finished ? 'current' : finished ? 'done' : ''} aria-current={distributed && !finished ? 'step' : undefined}><span>02</span><div>Query<small>Follow the route</small></div></li><li className={finished ? 'current' : ''} aria-current={finished ? 'step' : undefined}><span>03</span><div>Compare<small>Try another key</small></div></li></ol></section>
      <section className="sl-experiment" aria-label="Sharding playground">
        <div className="sl-story-heading"><span className="sl-step">EXPERIMENT</span><h2>Choose a key. Follow the query.</h2></div>
        <div className="sl-controls">
          <fieldset disabled={busy || moving}><legend>Sharding key</legend><div className="sl-key-options">{(['tenant_id','user_id'] as ShardKey[]).map(k => <button key={k} aria-pressed={key === k} onClick={() => changeKey(k)} className={key === k ? 'selected' : ''}><span>{k === 'tenant_id' ? 'Tenant' : 'User'}</span><code>{k}</code></button>)}</div></fieldset>
          <div className="sl-control-explanation"><p>{key === 'tenant_id' ? 'All events from a tenant share one shard.' : 'All events from a user share one shard.'}</p><span>Partition rule: <code>{key} % 4</code></span></div>
          <label className="sl-speed"><span>Animation speed <output>{speed}×</output></span><input type="range" aria-label="Animation speed" aria-valuetext={`${speed} times normal speed`} min="0.25" max="4" step="0.25" value={speed} disabled={busy || moving} onInput={e => setSpeed(Number(e.currentTarget.value))} /></label>
          {!distributed ? <button className="sl-primary" onClick={() => {captureRows(); setDistributed(true);}}>Distribute the rows <span>→</span></button> : <span className="sl-distributed"><i />{moving ? "Redistributing…" : "24 rows distributed"}</span>}
        </div>
        {distributed && <div className="sl-query-controls"><div className="sl-query-input"><label>Find events for<select disabled={busy || moving} aria-label="Query lookup" value={field} onChange={e => changeQuery(e.target.value as QueryField, 1)}><option value="tenant_id">a tenant</option><option value="user_id">a user</option></select></label><label>{field === 'tenant_id' ? 'Tenant' : 'User'}<select disabled={busy || moving} aria-label="Lookup value" value={value} onChange={e => changeQuery(field, Number(e.target.value))}>{Array.from({length: field === 'tenant_id' ? 4 : 12}, (_, i) => <option key={i} value={i + 1}>{field === 'tenant_id' ? `${i + 1} · ${tenants[i]}` : i + 1}</option>)}</select></label></div><div className="sl-query-sql"><code>SELECT * FROM events<br /><span>WHERE <b>{field} = {value}</b>;</span></code></div>{busy ? <div className="sl-playback sl-query-playback"><button onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</button><button onClick={() => {setPlaying(false); step();}}>Step →</button></div> : <button className="sl-primary" disabled={busy || moving} onClick={() => run()}>{finished ? 'Run again' : previous ? 'Run the same query' : 'Run query'} <span>→</span></button>}</div>}
        {distributed && <section className="sl-query-trace" aria-label="Query walkthrough">
          <div className="sl-trace-columns">{['Plan', 'Route', 'Return'].map((label, i) => <div key={label} className={`sl-trace-step ${traceStage === i + 1 ? 'current' : ''}`}><button disabled={!finished} aria-pressed={traceStage === i + 1} onClick={() => setReviewStage(i + 1)}><span>0{i + 1}</span>{label}</button><p className={traceStage === i + 1 ? 'sl-trace-explanation' : ''}>{traceDetails[i]}</p></div>)}</div>

        </section>}
        <div ref={sceneRef} style={{"--query-duration": `${requestDuration}ms`, "--reply-delay": `${branchDuration}ms`} as CSSProperties} className={`sl-scene ${distributed ? 'is-distributed' : ''} phase-${phase} ${moving ? 'is-moving' : ''} ${playing ? '' : 'is-paused'}`} key={`scene-${runNumber}`}>
          <ClusterWires host={sceneRef} distributed={distributed} phase={phase} contacted={outcome.contacted} playing={playing} replies={data.map(part => part.filter(row => row[field] === value).length)} speed={speed} onGeometry={setGeometry} />
          <div className="sl-client"><span className="sl-node-label">YOUR APP</span><svg viewBox="0 0 100 76" aria-hidden="true"><rect x="6" y="3" width="88" height="55" rx="4" fill="#626262" stroke="#858585" /><rect x="12" y="9" width="76" height="42" rx="1" fill="#182735" stroke="#111" /><path d="M42 58v8h16v-8M29 70h42" fill="#666" stroke="#888" /><path d="M22 20l8 6-8 6m15 0h12" fill="none" stroke="#91bada" strokeWidth="2" /><circle cx="87" cy="55" r="1" fill="#8ebe91" stroke="none" /></svg><span className="sl-node-caption">{distributed ? <code>{field} = {value}</code> : "events table"}</span>{finished && <span className="sl-answer">{outcome.result.length} rows returned</span>}</div>
          <div className="sl-main-wire"><span className="sl-packet" /></div>
          <div className={`sl-router ${busy ? 'active' : ''}`}>
            <span className="sl-node-label">ROUTER</span>
            <svg className="sl-router-board" viewBox="0 0 200 200" aria-hidden="true">
              <rect x="1" y="1" width="198" height="198" rx="6" fill="#414141" stroke="#737373" />
              <rect x="12" y="12" width="176" height="176" rx="3" fill="#2b2d2b" />
              {[14,186].flatMap(y => [14,186].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#161616" stroke="#777" />))}
              <rect x="18" y="38" width="164" height="131" rx="2" fill="#171717" stroke="#646464" />
              <path d="M2 100h16M182 100h16" stroke="#aaa" strokeWidth="2" />
            </svg>
            <div className="sl-router-status"><i className={busy ? 'running' : finished ? 'complete' : ''} />{!distributed ? 'SETUP' : phase === 0 ? 'READY' : phase === 1 ? '01 · PLAN' : phase === 2 ? '02 · ROUTE' : phase === 3 ? '03 · RETURN' : 'COMPLETE'}</div>
            <div className="sl-router-readout">
              <span className="sl-router-input-label">QUERY FILTER</span>
              <code className="sl-router-filter">{distributed ? `${field} = ${value}` : 'No query yet'}</code>
              <div className="sl-router-decision"><strong>{!distributed ? 'Distribute first' : phase === 0 ? 'Ready for a query' : phase === 1 ? 'Checking the key' : phase === 2 ? field === key ? `→ Shard ${shardFor(value)}` : '→ All 4 shards' : phase === 3 ? 'Collecting replies' : `${outcome.result.length} rows returned`}</strong><span>{!distributed ? 'Place the events on shards' : phase === 0 ? 'Run to follow the route' : phase === 1 ? field === key ? 'Filter matches shard key' : 'Filter has no shard key' : phase === 2 ? field === key ? `${value} % 4 = ${shardFor(value)}` : 'Cannot pick one destination' : phase === 3 ? `Combining ${outcome.contacted.length} ${outcome.contacted.length === 1 ? 'reply' : 'replies'}` : `From ${outcome.contacted.length} ${outcome.contacted.length === 1 ? 'shard' : 'shards'}`}</span></div>
            </div>
            <div className="sl-router-key"><span>SHARD KEY</span><code>{key}</code></div>
          </div>
          <div className="sl-branch-wire"><span className="sl-packet" /></div>
          {!distributed ? <div className="sl-source"><div className="sl-source-heading"><div><span className="sl-kicker">SOURCE TABLE</span><h3>events <span>24 rows</span></h3></div><span>4 tenants · 12 users</span></div><DataTable data={rows} /><div className="sl-source-foot"><strong>Every row is an event.</strong> Tenant and user IDs are the two keys you can shard by.</div></div> : <div className="sl-shards">{data.map((part, shard) => {const contact = phase >= 2 && outcome.contacted.includes(shard); const matching = part.filter(row => row[field] === value); return <div key={shard} className={`sl-shard ${contact ? 'contacted' : ''} ${inspected === shard ? 'inspected' : ''}`}><svg className="sl-server-housing" viewBox="0 0 220 188" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <rect className="housing-edge" x="1" y="1" width="218" height="186" rx="6" />
  <path className="housing-bevel" d="M7 2H213L219 8V180L213 187H7L1 180V8Z" />
  <rect className="housing-label" x="15" y="15" width="190" height="27" rx="2" />
  <rect className="housing-well" x="15" y="49" width="190" height="105" rx="3" />
  <path className="housing-divider" d="M15 163H205" />
  {[ [8,8], [212,8], [8,180], [212,180] ].map(([x,y]) => <g key={`${x}-${y}`}><circle className="housing-screw" cx={x} cy={y} r="3" /><path className="housing-slot" d={`M${x-1.4} ${y}h2.8`} /></g>)}
  <circle className={`housing-led ${contact ? 'led-active' : ''}`} cx="20" cy="174" r="2.5" />
  <path className="housing-vents" d="M169 171v6m5-6v6m5-6v6m5-6v6m5-6v6m5-6v6m5-6v6" />
</svg><button className="sl-shard-top" onClick={() => {setSelectedEvent(null); setHoveredEvent(null); setInspected(inspected === shard && !selectedEvent ? null : shard);}} aria-label={`Inspect shard ${shard}`} aria-expanded={inspected === shard && !selectedEvent}><span className="sl-node-label">SHARD {shard}</span><span>{part.length} rows</span></button><div className="sl-row-tiles">{part.map(row => <button type="button" onMouseEnter={e => previewEvent(row, shard, e.currentTarget)} onMouseLeave={() => setHoveredEvent(null)} onFocus={e => previewEvent(row, shard, e.currentTarget)} onBlur={() => setHoveredEvent(null)} onKeyDown={e => {if (e.key === 'Escape') setHoveredEvent(null);}} aria-describedby={hoveredEvent?.row.event_id === row.event_id ? 'event-preview' : undefined} onClick={() => {setSelectedEvent(row); setInspected(shard);}} aria-label={`Inspect event ${row.event_id}`} aria-pressed={selectedEvent?.event_id === row.event_id} key={row.event_id} data-event={row.event_id} className={`sl-row-tile t${row.tenant_id} ${contact && phase >= 3 && matching.some(r => r.event_id === row.event_id) ? 'matched' : ''}`}>{row.event_id}</button>)}</div><span className="sl-shard-status">{contact ? phase >= 3 ? `${matching.length} matching rows ${finished ? 'returned' : 'found'}` : 'Evaluating filter…' : phase >= 2 ? 'No query sent' : `${key} % 4 = ${shard}`}</span></div>;})}</div>}
        </div>
        <div className="sl-scene-foot"><div className="sl-tenant-legend">{tenants.map((name, i) => <span key={name}><i className={`tenant-dot t${i + 1}`} />{name}</span>)}</div><span>Colour = tenant · each square is an event</span></div>

        {inspected !== null && distributed && <section className="sl-inspection"><div><h3>{selectedEvent ? `Event ${selectedEvent.event_id} · shard ${inspected}` : `Inside shard ${inspected}`}</h3><button onClick={() => {setInspected(null); setSelectedEvent(null); setHoveredEvent(null);}}>Close ×</button></div><DataTable data={selectedEvent ? [selectedEvent] : data[inspected]} /></section>}
        {finished && last && <section className="sl-result" aria-label="Query results"><div className="sl-result-heading"><div><span className="sl-kicker">QUERY RESULT</span><h3>{previous ? last.contacted.length < previous.contacted.length ? 'Fewer shards. Same rows.' : last.contacted.length > previous.contacted.length ? 'More shards. Same rows.' : 'Different distribution. Same route count.' : last.contacted.length === 1 ? 'Related events, one destination.' : 'One question, four destinations.'}</h3><p className="sl-result-lead">{last.result.length} events returned for <code>{field} = {value}</code>.</p></div><button className="sl-results-toggle" onClick={() => setShowResults(s => !s)}>{showResults ? 'Hide' : 'View'} {last.result.length} returned rows {showResults ? '−' : '+'}</button></div><div className="sl-result-body"><div className="sl-result-detail"><div className={`sl-comparison-head ${previous ? 'has-previous' : ''}`}><span>What the query did</span>{previous && <span>Before</span>}<span>This run</span></div><div className="sl-comparison"><div className="sl-comparison-labels"><span>Partitioning key</span><span>Shards contacted</span><span>Rows checked*</span><span>Largest shard</span><span>Rows returned</span></div>{previous && <div className="sl-metrics previous"><code>{previous.key}</code><span>{previous.contacted.length} / 4</span><span>{previous.examined}</span><span>{Math.max(...previous.sizes)} / 24</span><span>{previous.result.length}</span></div>}<div className="sl-metrics current"><code>{last.key}</code><span>{last.contacted.length} / 4</span><span>{last.examined}</span><span>{Math.max(...last.sizes)} / 24</span><span>{last.result.length}</span></div></div><p className="sl-model-note">*Each contacted shard scans its rows in this model. Real indexes can reduce that work.</p>{showResults && <DataTable data={last.result} />}</div><aside className="sl-next-question"><span className="sl-kicker">NEXT EXPERIMENT</span><h4>Same query. Different key.</h4><p>{!previous ? 'Switch the partitioning key and run this query again. See how the distribution changes the work.' : key === 'user_id' && field === 'tenant_id' ? 'The rows are more evenly spread. Tenant lookups now need every shard. Try a user lookup next.' : key === 'tenant_id' && field === 'user_id' ? 'A tenant stays together. A user-only lookup still needs every shard. Try a tenant lookup next.' : 'The key helps queries that filter by it. Try the other lookup to see the tradeoff.'}</p><button disabled={moving} onClick={() => changeKey(key === 'tenant_id' ? 'user_id' : 'tenant_id')}>Try {key === 'tenant_id' ? 'user_id' : 'tenant_id'} →</button><span className="sl-next-hint">Your lookup stays the same.</span></aside></div></section>}
      </section>
      {hoveredEvent && <div className="sl-event-preview" role="tooltip" id="event-preview" style={{left:hoveredEvent.x, top:hoveredEvent.y}}><div className="sl-event-preview-title"><strong>Event {hoveredEvent.row.event_id}</strong><span>Shard {hoveredEvent.shard}</span></div><dl><div><dt>tenant_id</dt><dd>{hoveredEvent.row.tenant_id} · {tenants[hoveredEvent.row.tenant_id - 1]}</dd></div><div><dt>user_id</dt><dd>{hoveredEvent.row.user_id}</dd></div><div><dt>action</dt><dd>{hoveredEvent.row.action}</dd></div></dl><p>Click to inspect this row</p></div>}
      <footer className="sl-footer"><span>shardyssey · interactive database systems</span><p>Simulation · modulo partitioning · full scans · no latency estimates</p></footer>
    </main>
  </div>;
}
