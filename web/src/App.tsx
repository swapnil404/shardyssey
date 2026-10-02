import { useEffect, useState } from 'react';
import { Comparison, type LoadedRecording } from './Comparison';
import { Replay } from './Replay';
import { parseRecording } from './recording';
const choices = [{id: 'one-shard', label: 'One shard'}, {id: 'fan-out', label: 'Fan-out'}, {id: 'slow-branch', label: 'Slow branch'}];
export function App() {
  const [experiment, setExperiment] = useState('one-shard');
  const [delay, setDelay] = useState('500');
  const [result, setResult] = useState<{key: string; items: LoadedRecording[]}>({key: '', items: []});
  const [error, setError] = useState('');
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
        if (!controller.signal.aborted) setResult({key: loadKey, items: recordings});
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Recording could not be loaded.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [experiment, delay, reload, loadKey]);
  return <><div className="load-toolbar"><label>Experiment <select aria-label="Experiment" value={experiment} onChange={event => setExperiment(event.target.value)}>{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>{experiment === 'slow-branch' && <label>Recorded network delay <select aria-label="Recorded network delay" value={delay} onChange={event => setDelay(event.target.value)}><option value="0">None · baseline capture</option><option value="500">500 ms · shard 80-</option></select></label>}<button disabled={loading} onClick={() => setReload(value => value + 1)}>{loading ? 'Loading…' : 'Load recording'}</button></div>
    {experiment === 'slow-branch' && <p className="static-note">The delay selector loads recorded captures. It sends no fault commands.</p>}
    <section className="query-comparison" aria-label="Compare query routing"><span className="section-label">CHANGE THE QUERY, CHANGE THE ROUTE</span><div><p><strong>One shard</strong><code>SELECT COUNT(*) FROM events WHERE user_id = 42</code><span>Captured EqualUnique route · one shard</span></p><p><strong>Fan-out</strong><code>SELECT COUNT(*) FROM events</code><span>Captured Scatter route + scalar aggregate · both shards</span></p></div></section>
    {loaded.length ? experiment === 'slow-branch' ? <Comparison key={`${experiment}-${delay}-${reload}`} baseline={loaded[0]} selected={loaded[1]} /> : <Replay key={`${loaded[0].recording.run_id}-${reload}`} recording={loaded[0].recording} recordingURL={loaded[0].url} /> : <main className="load-state"><h1>shardyssey</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading the recorded query…'}</p></main>}
  </>;
}
