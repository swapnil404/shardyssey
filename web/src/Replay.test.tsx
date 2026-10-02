import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Replay } from './Replay';
import { parseRecording, replayModel } from './recording';
import captured from '../public/recordings/demo/one-shard/recording.json';
let root: Root;
let host: HTMLDivElement;
let reduced = false;
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  reduced = false;
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  vi.stubGlobal('matchMedia', () => ({matches: reduced, addEventListener() {}, removeEventListener() {}}));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {frame = callback; return 1;});
  vi.stubGlobal('cancelAnimationFrame', () => {frame = undefined;});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount(status = 'complete') { const recording = parseRecording(structuredClone(captured)); recording.capture_status = status; act(() => root.render(<Replay recording={recording} recordingURL="https://example.com/recordings/demo/one-shard/recording.json" />)); return replayModel(recording); }
function click(label: string) { const button = host.querySelector(`[aria-label="${label}"]`) as HTMLElement; act(() => button.click()); }
function visible() { return host.querySelector('[aria-label="Recorded result"]')?.getAttribute('data-visible'); }
function equalViews() { expect(host.querySelector('[data-testid="route--80"]')?.getAttribute('data-state')).toBe(host.querySelector('[data-testid="timeline--80"]')?.getAttribute('data-state')); }
it('plays, pauses, resets and shares one cursor across graph and timeline', () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  mount(); expect(visible()).toBe('false'); equalViews();
  click('Play recording'); act(() => frame!(800)); equalViews(); expect(visible()).toBe('false');
  click('Pause recording'); expect(frame).toBeUndefined();
  click('Play recording'); act(() => frame!(2000)); equalViews(); expect(visible()).toBe('true');
  expect(host.querySelector('[aria-label="Recorded result"] strong')?.textContent).toBe('2');
  click('Reset recording'); expect(visible()).toBe('false'); equalViews();
});
it('steps through captured boundaries without animation in reduced motion', () => {
  reduced = true; const model = mount();
  expect((host.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
  for (let count = 0; count < 4 && visible() !== 'true'; count++) { click('Step through recording'); equalViews(); }
  expect(visible()).toBe('true'); expect(frame).toBeUndefined();
  expect(host.querySelector('[aria-label="Replay position"]')?.getAttribute('max')).toBe(String(model.duration));
});
it('disables playback and hides the result for unfinished captures', () => {
  mount('capturing'); expect(visible()).toBe('false');
  expect((host.querySelector('[aria-label="Play recording"]') as HTMLButtonElement).disabled).toBe(true);
  expect((host.querySelector('[aria-label="Replay position"]') as HTMLInputElement).disabled).toBe(true);
  equalViews(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Timed replay unavailable');
});
it('scrubs both views through every measured microsecond and hides the result when rewound', () => {
  const model = mount();
  const slider = host.querySelector('[aria-label="Replay position"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (let cursor = 0; cursor <= model.duration; cursor++) {
    act(() => { setter.call(slider, String(cursor)); slider.dispatchEvent(new Event('input', {bubbles: true})); slider.dispatchEvent(new Event('change', {bubbles: true})); });
    equalViews(); expect(visible()).toBe(cursor === model.duration ? 'true' : 'false');
  }
  act(() => { setter.call(slider, '0'); slider.dispatchEvent(new Event('input', {bubbles: true})); });
  expect(visible()).toBe('false');
});
