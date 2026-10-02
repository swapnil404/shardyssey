import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Experience } from './Experience';
import { parseSeed } from './Cluster';
import { parseRecording, replayModel } from './recording';
import one from '../public/recordings/demo/one-shard/recording.json';
import fan from '../public/recordings/demo/fan-out/recording.json';
import slow from '../public/recordings/demo/slow-branch/recording.json';
import seedJSON from '../public/recordings/demo/seed.json';
let root: Root, host: HTMLDivElement, reduced = false;
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  reduced = false;
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.stubGlobal('matchMedia', () => ({matches: reduced, addEventListener() {}, removeEventListener() {}}));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {frame = callback; return 1;});
  vi.stubGlobal('cancelAnimationFrame', () => {frame = undefined;});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();});
function mount(json: unknown = one, status = 'complete', compare = false) {
  const recording = parseRecording(structuredClone(json)); recording.capture_status = status;
  const loaded = {recording, url: `https://example.com/recordings/demo/${recording.experiment_id}/recording.json`};
  act(() => root.render(<Experience loaded={loaded} seed={parseSeed(seedJSON)} baseline={compare ? {recording: parseRecording(fan), url: 'https://example.com/recordings/demo/fan-out/recording.json'} : undefined} />));
  return replayModel(recording);
}
function click(text: string) {const button = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.trim() === text)!; act(() => button.click());}
function clickLabel(label: string) {act(() => (host.querySelector(`[aria-label="${label}"]`) as HTMLElement).click());}
function seek(time: number) {
  const input = host.querySelector('[aria-label="Replay position"]') as HTMLInputElement;
  act(() => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(time)); input.dispatchEvent(new Event('input', {bubbles: true}));});
}
function result(pane: ParentNode = host) {return pane.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible');}
it('shows actual seeded data, matching user tiles, and both shard machines before playback', () => {
  mount(); expect(host.querySelectorAll('.row-tile')).toHaveLength(20);
  expect(host.querySelectorAll('.row-tile.matched')).toHaveLength(2);
  expect(host.querySelector('[aria-label="Seeded events in shard 80-"]')?.textContent).toContain('100');
  expect(host.querySelector('[data-testid="shard-80-"]')?.getAttribute('data-state')).toBe('untouched');
  expect(result()).toBe('false'); expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('pauses guided steps at captured boundaries and reveals the answer only at completion', () => {
  const model = mount(); click('Next →'); click('Next →');
  expect(host.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe('active');
  expect(result()).toBe('false'); expect(frame).toBeUndefined();
  click('Next →'); expect(host.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe('complete');
  expect(result()).toBe('false'); click('Next →'); expect(result()).toBe('true');
  expect(host.querySelector('[aria-label="Replay position"]')?.getAttribute('value')).toBe(String(model.duration));
  click('← Back'); expect(result()).toBe('false');
});
it('keeps cursor and selection when measurements close, including Escape and focus return', () => {
  mount(slow); seek(1000); clickLabel('Inspect shard 80-');
  const cursor = host.querySelector('[aria-label="Replay position"]')?.getAttribute('value');
  const opener = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.startsWith('How was'))!;
  opener.focus(); act(() => opener.click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close measurements');
  expect(host.querySelector('.evidence-facts')?.textContent).toContain('500.881 ms');
  expect(host.querySelector('[data-testid="timeline-80-"]')?.getAttribute('data-state')).toBe('active');
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
  expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
  expect(host.querySelector('[aria-label="Replay position"]')?.getAttribute('value')).toBe(cursor);
  expect(host.querySelector('[aria-label="Inspect shard 80-"]')?.getAttribute('aria-pressed')).toBe('true');
});
it('shows the outstanding contribution beside the completed baseline in comparison', () => {
  mount(slow, 'complete', true); click('⇄ Compare'); seek(1000);
  const baseline = host.querySelector('.baseline-scene')!, selected = host.querySelector('.selected-scene')!;
  expect(result(baseline)).toBe('true'); expect(result(selected)).toBe('false');
  expect(selected.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe('complete');
  expect(selected.querySelector('[data-testid="route-80-"]')?.getAttribute('data-state')).toBe('active');
  expect(selected.textContent).toContain('outstanding'); expect(selected.textContent).toContain('network delay');
  seek(501037); expect(result(selected)).toBe('true');
});
it('supports keyboard inspection and reduced-motion steps without animation frames', () => {
  reduced = true; mount();
  const shard = host.querySelector('[aria-label="Inspect shard -80"]')!;
  act(() => shard.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})));
  expect(shard.getAttribute('aria-pressed')).toBe('true');
  click('← Return to cluster');
  for (let count = 0; count < 4 && result() !== 'true'; count++) clickLabel('Step through recording');
  expect(result()).toBe('true'); expect(frame).toBeUndefined();
  expect((host.querySelector('[aria-label="Replay speed"]') as HTMLSelectElement).disabled).toBe(true);
});
it('never animates an unfinished capture or reveals its result', () => {
  mount(one, 'capturing'); seek(816);
  expect(result()).toBe('false'); expect((host.querySelector('[aria-label="Play recording"]') as HTMLButtonElement).disabled).toBe(true);
  expect(host.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe('unavailable');
});
it('plays, pauses, resets, and shows the real answer at the gateway boundary', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  mount(); clickLabel('Play recording'); act(() => frame!(800)); expect(result()).toBe('false');
  clickLabel('Pause recording'); expect(frame).toBeUndefined();
  clickLabel('Play recording'); act(() => frame!(2000)); expect(result()).toBe('true');
  expect(host.querySelector('[aria-label="Recorded result"] strong')?.textContent).toBe('2');
  expect(host.querySelector('.lesson-copy h2')?.textContent).toBe('The answer returns.');
  clickLabel('Reset recording'); expect(result()).toBe('false');
});
it('keeps the cutaway and every branch state aligned with the recorded interval while scrubbing', () => {
  const model = mount(); const branch = model.recording.branches[0];
  const start = branch.start! - model.root!.start!, end = branch.end! - model.root!.start!;
  for (let cursor = 0; cursor <= model.duration; cursor++) {
    seek(cursor);
    expect(host.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe(cursor < start ? 'pending' : cursor < end ? 'active' : 'complete');
    expect(host.querySelector('[data-testid="shard--80"]')?.getAttribute('data-state')).toBe(host.querySelector('[data-testid="route--80"]')?.getAttribute('data-state'));
    expect(result()).toBe(cursor >= model.duration ? 'true' : 'false');
  }
});
it('shows baseline evidence when a baseline machine is inspected', () => {
  mount(slow, 'complete', true); click('⇄ Compare'); seek(1000);
  const baseline = host.querySelector('.baseline-scene')!;
  act(() => (baseline.querySelector('[aria-label="Inspect shard 80-"]') as HTMLElement).click());
  click('How was this measured? ↗');
  expect(host.querySelector('.evidence-facts')?.textContent).toContain('0.677 ms');
  expect(host.querySelector('.measurement-meta')?.textContent).toContain('0.803 ms');
  expect(host.querySelector('.measurement-sources a:last-child')?.getAttribute('href')).toContain('/fan-out/recording.json');
});
