import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Comparison, comparisonModel } from './Comparison';
import { parseRecording, planEvidence, replayModel } from './recording';
import baselineJSON from '../public/recordings/demo/fan-out/recording.json';
import delayedJSON from '../public/recordings/demo/slow-branch/recording.json';
let root: Root, host: HTMLDivElement;
let reduced = false;
beforeEach(() => {
  reduced = false;
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.stubGlobal('matchMedia', () => ({matches: reduced, addEventListener() {}, removeEventListener() {}}));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();});
const baseline = () => parseRecording(structuredClone(baselineJSON));
const delayed = () => parseRecording(structuredClone(delayedJSON));
function mount(selected = delayed()) {
  act(() => root.render(<Comparison baseline={{recording: baseline(), url: 'https://example.com/recordings/demo/fan-out/recording.json'}} selected={{recording: selected, url: 'https://example.com/recordings/demo/slow-branch/recording.json'}} />));
}
function seek(time: number) {
  const slider = host.querySelector('[aria-label="Replay position"]') as HTMLInputElement;
  act(() => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(time)); slider.dispatchEvent(new Event('input', {bubbles: true}));});
}
function panes() {return Array.from(host.querySelectorAll('.comparison-pane'));}
it('shows the fast branch completed while the delayed branch and answer remain outstanding', () => {
  mount(); seek(1000);
  const [a, b] = panes();
  expect(a.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible')).toBe('true');
  expect(b.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible')).toBe('false');
  expect(b.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe('complete');
  expect(b.querySelector('[data-testid="route-80-"]')?.getAttribute('data-state')).toBe('active');
  expect(b.textContent).toContain('Waiting for outstanding shard');
  expect(host.textContent).toContain('injected network delay');
  expect(host.textContent).toContain('500.881 ms');
});
it('keeps both diagrams and timelines aligned at each start, end, and gateway completion', () => {
  mount();
  const times = [0, 1000, 250000, 500000];
  for (const recording of [baseline(), delayed()]) {
    const model = replayModel(recording), start = model.root!.start!;
    for (const branch of recording.branches) times.push(branch.start! - start - 1, branch.start! - start, branch.end! - start - 1, branch.end! - start);
    times.push(model.duration - 1, model.duration);
  }
  for (const time of times.sort((a, b) => a - b)) {
    seek(time);
    for (const [index, pane] of panes().entries()) {
      for (const shard of ['-80', '80-']) expect(pane.querySelector(`[data-testid="route-${shard}"]`)?.getAttribute('data-state')).toBe(pane.querySelector(`[data-testid="timeline-${shard}"]`)?.getAttribute('data-state'));
      const duration = replayModel(index ? delayed() : baseline()).duration;
      expect(pane.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible')).toBe(time >= duration ? 'true' : 'false');
    }
  }
  seek(501037); expect(panes().every(pane => pane.querySelector('[aria-label="Recorded result"] strong')?.textContent === '20')).toBe(true);
  seek(0); expect(panes().every(pane => pane.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible') === 'false')).toBe(true);
});
it('steps to baseline completion before delayed completion in reduced motion', () => {
  reduced = true; mount();
  let foundBaselineOnly = false;
  for (let count = 0; count < 12; count++) {
    act(() => (host.querySelector('[aria-label="Step through recording"]') as HTMLButtonElement).click());
    const [a, b] = panes().map(pane => pane.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible'));
    if (a === 'true' && b === 'false') foundBaselineOnly = true;
    if (a === 'true' && b === 'true') break;
  }
  expect(foundBaselineOnly).toBe(true);
});
it('rejects unrelated and incomplete comparisons without showing either answer', () => {
  const unfinished = delayed(); unfinished.capture_status = 'capturing'; mount(unfinished); seek(501037);
  expect((host.querySelector('[aria-label="Play recording"]') as HTMLButtonElement).disabled).toBe(true);
  expect(panes().every(pane => pane.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible') === 'false')).toBe(true);
  const unrelated = delayed(); unrelated.query_template = 'SELECT 1';
  expect(comparisonModel(baseline(), unrelated).available).toBe(false);
  const unknown = delayed(); unknown.spans[0].duration_us = null;
  expect(comparisonModel(baseline(), unknown).available).toBe(false);
});
it('explains aggregate behavior only when supported by the captured plan', () => {
  const recorded = delayed(); expect(planEvidence(recorded)?.aggregate).toBe('sum_count_star(0) AS count(*)');
  recorded.explain_runs.find(run => run.format === 'PLAN')!.raw_output = 'JSON\n{"OperatorType":"Aggregate","Variant":"Other"}';
  expect(planEvidence(recorded)).toBeNull();
});
it('rejects missing or duplicated fan-out branches instead of marking the other shard untouched', () => {
  const missing = baseline(); missing.branches.pop();
  expect(replayModel(missing).available).toBe(false);
  const duplicate = baseline(); duplicate.branches[1] = duplicate.branches[0];
  expect(replayModel(duplicate).available).toBe(false);
});
