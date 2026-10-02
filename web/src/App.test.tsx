import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import one from '../public/recordings/demo/one-shard/recording.json';
import fan from '../public/recordings/demo/fan-out/recording.json';
import seed from '../public/recordings/demo/seed.json';
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
    const data = input.endsWith('seed.json') ? seed : input.endsWith('experiments.json') ? {schema_version: 1, experiments: Object.keys(recordings).map(id => ({id, recording: `recordings/demo/${id}/recording.json`}))} : recordings[input.split('/').at(-2)!];
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
  expect(host.textContent).toContain('Where are the events?');
  await change('Experiment', 'fan-out');
  expect(host.textContent).toContain('Count everyone’s events.');
  expect(host.querySelector('[data-testid="route-80-"]')?.getAttribute('data-state')).toBe('pending');
  expect(host.textContent).toContain('Scatter → both shards');
  await change('Experiment', 'slow-branch');
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Compare')) as HTMLButtonElement).click());
  expect(host.querySelectorAll('.scene-container')).toHaveLength(2);
  expect(host.textContent).toContain('501.037 ms');
  await change('Recorded network delay', '0');
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Compare')) as HTMLButtonElement).click());
  expect(host.querySelectorAll('.scene-container')).toHaveLength(2);
  expect(host.textContent).not.toContain('501.037 ms');
  expect(host.textContent).toContain('SELECTED · NO DELAY');
  await change('Recorded network delay', '500');
  expect(host.textContent).toContain('501.037 ms');
  await change('Experiment', 'one-shard');
  expect(host.textContent).toContain('Where are the events?');
  expect(host.querySelector('[aria-label="Replay position"]')?.getAttribute('value')).toBe('0');
  expect(fetched.every(url => url.endsWith('experiments.json') || url.includes('/recordings/demo/'))).toBe(true);
});
it('shows a retryable error for unavailable evidence', async () => {
  vi.stubGlobal('fetch', async () => ({ok: false}));
  await act(async () => root.render(<App />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Experiment list could not be loaded');
  expect((host.querySelector('.loading-stage button') as HTMLButtonElement).disabled).toBe(false);
  expect(host.querySelector('[aria-label="Play recording"]')).toBeNull();
});
it('continues from a completed query to the next experiment with a fresh replay', async () => {
  await act(async () => root.render(<App />));
  act(() => (host.querySelector('[aria-label="Step 5: The answer returns."]') as HTMLButtonElement).click());
  expect(host.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible')).toBe('true');
  await act(async () => (host.querySelector('.continue-button') as HTMLButtonElement).click());
  expect(host.textContent).toContain('Count everyone’s events.');
  expect(host.querySelector('[aria-label="Replay position"]')?.getAttribute('value')).toBe('0');
  expect(host.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible')).toBe('false');
  act(() => (host.querySelector('[aria-label="Step 5: The answer returns."]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('.continue-button') as HTMLButtonElement).click());
  expect((host.querySelector('[aria-label="Recorded network delay"]') as HTMLSelectElement).value).toBe('500');
  expect(host.textContent).toContain('501.037 ms');
  act(() => (host.querySelector('[aria-label="Step 5: The answer returns."]') as HTMLButtonElement).click());
  expect(host.querySelector('.continue-button')).toBeNull();
});
