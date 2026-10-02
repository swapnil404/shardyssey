import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import one from '../public/recordings/demo/one-shard/recording.json';
import fan from '../public/recordings/demo/fan-out/recording.json';
import slow from '../public/recordings/demo/slow-branch/recording.json';
let root: Root, host: HTMLDivElement;
let fetched: string[];
const recordings: Record<string, unknown> = {'one-shard': one, 'fan-out': fan, 'slow-branch': slow};
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.stubGlobal('matchMedia', () => ({matches: false, addEventListener() {}, removeEventListener() {}}));
  fetched = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    fetched.push(input);
    const data = input.endsWith('experiments.json') ? {schema_version: 1, experiments: Object.keys(recordings).map(id => ({id, recording: `recordings/demo/${id}/recording.json`}))} : recordings[input.split('/').at(-2)!];
    return {ok: true, json: async () => structuredClone(data)};
  }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();});
async function change(label: string, value: string) {
  await act(async () => {
    const select = host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
    select.value = value; select.dispatchEvent(new Event('change', {bubbles: true}));
  });
}
it('switches between all experiments and recorded delays without calling capture services', async () => {
  await act(async () => root.render(<App />));
  expect(host.textContent).toContain('One destination.');
  await change('Experiment', 'fan-out');
  expect(host.textContent).toContain('Both shards.');
  expect(host.querySelector('[data-testid="route-80-"]')?.getAttribute('data-state')).toBe('pending');
  expect(host.textContent).toContain('sum_count_star');
  await change('Experiment', 'slow-branch');
  expect(host.querySelectorAll('.comparison-pane')).toHaveLength(2);
  expect(host.textContent).toContain('501.037 ms');
  await change('Recorded network delay', '0');
  expect(host.querySelectorAll('.comparison-pane')).toHaveLength(2);
  expect(host.textContent).not.toContain('501.037 ms');
  expect(host.textContent).toContain('Selected capture · no injected delay');
  await change('Recorded network delay', '500');
  expect(host.textContent).toContain('501.037 ms');
  await change('Experiment', 'one-shard');
  expect(host.textContent).toContain('One destination.');
  expect(host.querySelector('[aria-label="Replay position"]')?.getAttribute('value')).toBe('0');
  expect(fetched.every(url => url.endsWith('experiments.json') || url.includes('/recordings/demo/'))).toBe(true);
});
it('shows a retryable error for unavailable evidence', async () => {
  vi.stubGlobal('fetch', async () => ({ok: false}));
  await act(async () => root.render(<App />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Experiment list could not be loaded');
  expect((host.querySelector('.load-toolbar button') as HTMLButtonElement).disabled).toBe(false);
  expect(host.querySelector('[aria-label="Play recording"]')).toBeNull();
});
