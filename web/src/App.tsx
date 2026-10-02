import { useEffect, useState } from 'react';
import { type LoadedRecording } from './comparison';
import { Experience } from './Experience';
import { parseSeed, type Seed } from './Cluster';
import { parseRecording } from './recording';
const choices = [{id: 'one-shard', label: 'Find one user', subtitle: 'A key finds the right shard.'}, {id: 'fan-out', label: 'Count everyone', subtitle: 'One query, both shards.'}, {id: 'slow-branch', label: 'Wait for one shard', subtitle: 'An answer needs every part.'}];
export function App() {
  const [experiment, setExperiment] = useState('one-shard');
  const [delay, setDelay] = useState('500');
  const [result, setResult] = useState<{key: string; items: LoadedRecording[]}>({key: '', items: []});
  const [error, setError] = useState('');
  const [seed, setSeed] = useState<Seed | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const loadKey = `${experiment}-${delay}-${reload}`;
  const loaded = result.key === loadKey ? result.items : [];
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResult({key: '', items: []});
    async function load() {
      try {
        const manifestURL = new URL(`${import.meta.env.BASE_URL}experiments.json`, window.location.href);
        const manifestResponse = await fetch(manifestURL.href, {signal: controller.signal});
        if (!manifestResponse.ok) throw new Error('Experiment list could not be loaded.');
        const manifest = await manifestResponse.json();
        if (manifest.schema_version !== 1 || !Array.isArray(manifest.experiments)) throw new Error('Unsupported experiment manifest.');
        const ids = experiment === 'slow-branch' ? ['fan-out', delay === '0' ? 'fan-out' : 'slow-branch'] : [experiment];
        const recordings = await Promise.all(ids.map(async id => {
          const entry = manifest.experiments.find((item: {id: string}) => item.id === id);
          if (!entry || typeof entry.recording !== 'string') throw new Error('Selected recording is missing.');
          const url = new URL(entry.recording, manifestURL);
          if (url.origin !== manifestURL.origin || !url.pathname.startsWith(new URL('recordings/', manifestURL).pathname)) throw new Error('Recording is outside the static bundle.');
          const response = await fetch(url.href, {signal: controller.signal});
          if (!response.ok) throw new Error('Recording could not be loaded.');
          const recording = parseRecording(await response.json());
          if (recording.experiment_id !== id) throw new Error('Recording does not match the selected experiment.');
          return {recording, url: url.href};
        }));
        const seedResponse = await fetch(new URL('../seed.json', recordings[0].url).href, {signal: controller.signal});
        if (!seedResponse.ok) throw new Error('Seeded data could not be loaded.');
        const seed = parseSeed(await seedResponse.json());
        if (!controller.signal.aborted) {setSeed(seed); setResult({key: loadKey, items: recordings});}
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Recording could not be loaded.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [experiment, delay, reload, loadKey]);
  const nextChoice = choices[choices.findIndex(choice => choice.id === experiment) + 1];
  return <div className="app-shell">
    <header className="app-header"><a className="wordmark" href={import.meta.env.BASE_URL}><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h8m0 0V5h10m-10 9v9h10" /><circle cx="4" cy="14" r="2" /><circle cx="22" cy="5" r="2" /><circle cx="22" cy="23" r="2" /></svg>shardyssey<span>.</span></a><span className="header-caption">A query, taken apart</span><span className="header-link"><i />Vitess · recorded execution</span></header>
    <main className="lab-main">
      <div className="article-intro"><div><p className="eyebrow">INSIDE A DISTRIBUTED DATABASE</p><h1>One query. Multiple machines.</h1></div><div className="intro-detail"><p className="intro-copy">Follow a query through Vitess. Change what it asks, watch where the work goes, and see what holds up the answer.</p><div className="intro-meta"><span>2 shards</span><span>20 events</span><span>3 experiments</span></div></div></div>
      <section id="experiment" aria-label="Interactive query explanation">
        <nav className="lesson-nav" aria-label="Query lessons">{choices.map((choice, index) => <button key={choice.id} aria-current={experiment === choice.id ? 'step' : undefined} className={experiment === choice.id ? 'current' : ''} onClick={() => setExperiment(choice.id)}><span className="nav-number">0{index + 1}</span>{choice.label}</button>)}</nav>
        <div className="lesson-heading"><div><h2>{experiment === 'one-shard' ? "Find one user’s events." : experiment === 'fan-out' ? "Count everyone’s events." : 'Wait for one shard.'}</h2><p>{experiment === 'one-shard' ? 'User 42 lives on one shard. Does the other shard need to do anything?' : experiment === 'fan-out' ? 'Remove the user filter. Now where does the query need to go?' : 'Same query, same data. What happens when one reply arrives late?'}</p></div><label className="mobile-lesson-select"><span className="sr-only">Experiment</span><select aria-label="Experiment" value={experiment} onChange={event => setExperiment(event.target.value)}>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>{experiment === 'slow-branch' && <label className="delay-select">Network delay<select aria-label="Recorded network delay" value={delay} onChange={event => setDelay(event.target.value)}><option value="0">None · baseline</option><option value="500">500 ms · shard 80-</option></select></label>}</div>
        {loaded.length && seed ? <Experience key={loadKey} loaded={loaded.at(-1)!} baseline={experiment === 'slow-branch' ? loaded[0] : undefined} seed={seed} nextExperimentLabel={nextChoice?.label} onNextExperiment={nextChoice ? () => setExperiment(nextChoice.id) : undefined} /> : <div className={`loading-stage ${error ? 'load-error' : ''}`}><div className="loading-diagram" aria-hidden="true"><i /><span /><i /><span /><i /></div><p role={error ? 'alert' : 'status'}>{error || 'Loading the recording…'}</p><button disabled={loading} onClick={() => setReload(value => value + 1)}>{loading ? 'Loading…' : 'Try again'}</button></div>}
      </section>
      <section className="article-note" aria-label="Continue exploring"><div><span className="eyebrow">KEEP EXPLORING</span><h2>Change the question.<br />Watch the work change.</h2></div><div className="continuation-links">{choices.map((choice, index) => <button key={choice.id} className={experiment === choice.id ? 'active' : ''} onClick={() => {setExperiment(choice.id); document.getElementById('experiment')?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});}}><span>0{index + 1}</span><div><strong>{choice.label}</strong><small>{choice.subtitle}</small></div><span aria-hidden="true">↗</span></button>)}</div></section>
      <footer className="lab-footer"><span>shardyssey / a query, taken apart</span><span>Recorded timings. Illustrative data movement.</span></footer>
    </main>
  </div>;
}
