import React from 'react';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Replay } from './Replay';
import { parseRecording, type Recording } from './recording';
import './style.css';
function App() {
  const [recording, setRecording] = useState<Recording | null>(null);
  const [url, setURL] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setError(''); setRecording(null);
    try {
      const manifestResponse = await fetch(`${import.meta.env.BASE_URL}experiments.json`);
      if (!manifestResponse.ok) throw new Error('Experiment list could not be loaded.');
      const manifest = await manifestResponse.json();
      const experiment = manifest.experiments?.find((item: {id: string}) => item.id === 'one-shard');
      if (!experiment) throw new Error('One-shard recording is missing.');
      const recordingURL = new URL(experiment.recording, manifestResponse.url).href;
      const response = await fetch(recordingURL);
      if (!response.ok) throw new Error('Recording could not be loaded.');
      const parsed = parseRecording(await response.json());
      setURL(recordingURL); setRecording(parsed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recording could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <><div className="load-toolbar"><span>Experiment: <strong>One shard</strong></span><button disabled={loading} onClick={() => void load()}>{loading ? 'Loading…' : 'Load recording'}</button></div>{recording ? <Replay recording={recording} recordingURL={url} /> : <main className="load-state"><h1>shardyssey</h1><p role={error ? 'alert' : 'status'}>{error || 'Loading the recorded query…'}</p></main>}</>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
