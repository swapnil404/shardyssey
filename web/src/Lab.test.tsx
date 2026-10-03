import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Lab } from './Lab';
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  vi.useFakeTimers(); Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
  act(() => root.render(<Lab />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function click(text: string) {
  const button=Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(text));
  expect(button).toBeDefined(); act(() => button!.click());
}
function finish() { for(let i=0;i<3;i++) act(() => vi.advanceTimersByTime(10000)); }
it('introduces inputs in order and compares the same query after repartitioning', () => {
  expect(host.querySelector('[aria-label="Query lookup"]')).toBeNull();
  click('Distribute the rows'); click('Run query'); finish();
  expect(host.querySelector('.sl-result h3')?.textContent).toBe('Related events, one destination.');
  click('Try user_id');
  expect(host.querySelector('[aria-label="Query lookup"]')?.getAttribute('disabled')).toBeNull();
  click('Run the same query'); finish();
  expect(host.querySelector('.sl-result h3')?.textContent).toBe('More shards. Same rows.');
  expect(host.querySelector('.sl-metrics.previous')?.textContent).toBe('tenant_id1 / 41212 / 2412');
  expect(host.querySelector('.sl-metrics.current')?.textContent).toBe('user_id4 / 4246 / 2412');
});
it('pauses the explanation and disables configuration changes until playback finishes', () => {
  click('Distribute the rows'); click('Run query'); click('Pause');
  act(() => vi.advanceTimersByTime(10000));
  expect(host.querySelector('.sl-scene')?.className).toContain('phase-1');
  expect((host.querySelector('[aria-label="Query lookup"]') as HTMLSelectElement).disabled).toBe(true);
  click('Step'); click('Step'); click('Step');
  expect(host.querySelector('.sl-scene')?.className).toContain('phase-4');
  expect((host.querySelector('[aria-label="Query lookup"]') as HTMLSelectElement).disabled).toBe(false);
});
it('clears the baseline when the query changes and resets the full experiment', () => {
  click('Distribute the rows'); click('Run query'); finish(); click('Try user_id');
  const select=host.querySelector('[aria-label="Query lookup"]') as HTMLSelectElement;
  act(() => {select.value='user_id';select.dispatchEvent(new Event('change',{bubbles:true}));});
  click('Run query'); finish();
  expect(host.querySelector('.sl-metrics.previous')).toBeNull();
  click('Start over');
  expect(host.querySelector('[aria-label="Query lookup"]')).toBeNull();
  expect(host.querySelector('.sl-result')).toBeNull();
});
it('slows playback without changing the query result', () => {
  const select=host.querySelector('[aria-label="Animation speed"]') as HTMLInputElement;
  act(() => {select.value='0.5';select.dispatchEvent(new Event('input',{bubbles:true}));});
  click('Distribute the rows'); click('Run query');
  act(() => vi.advanceTimersByTime(1200));
  expect(host.querySelector('.sl-scene')?.className).toContain('phase-1');
  act(() => vi.advanceTimersByTime(1200));
  expect(host.querySelector('.sl-scene')?.className).toContain('phase-2');
  act(() => vi.advanceTimersByTime(2400));
  act(() => vi.advanceTimersByTime(4800));
  expect(host.querySelector('.sl-metrics.current')?.textContent).toBe('tenant_id1 / 41212 / 2412');
});
it('starts each new routing and reply animation when its stage begins', () => {
  const begin = vi.fn();
  Object.defineProperty(SVGElement.prototype, 'beginElement', {configurable: true, value: begin});
  try {
    click('user_id'); click('Distribute the rows'); click('Run query');
    act(() => vi.advanceTimersByTime(1200));
    expect(host.querySelectorAll('animateMotion')).toHaveLength(4);
    expect(begin).toHaveBeenCalledTimes(4);
    for (const motion of host.querySelectorAll('animateMotion')) expect(motion.getAttribute('begin')).toBe('indefinite');
    act(() => vi.advanceTimersByTime(1200));
    expect(begin).toHaveBeenCalledTimes(8);
    expect(host.querySelector('.sl-scene')?.className).toContain('phase-3');
    act(() => vi.advanceTimersByTime(1200));
    expect(host.querySelector('.sl-result')).toBeNull();
    act(() => vi.advanceTimersByTime(1200));
    expect(host.querySelector('.sl-result')).not.toBeNull();
  } finally {
    Reflect.deleteProperty(SVGElement.prototype, 'beginElement');
  }
});
it('opens one event from a tile and the full shard from its header', () => {
  click('Distribute the rows');
  const tile = host.querySelector('[aria-label="Inspect event 23"]') as HTMLButtonElement;
  expect(tile.closest('button')).toBe(tile);
  act(() => tile.click());
  expect(host.querySelector('.sl-inspection h3')?.textContent).toBe('Event 23 · shard 0');
  expect(host.querySelectorAll('.sl-inspection tbody tr')).toHaveLength(1);
  expect(tile.getAttribute('aria-pressed')).toBe('true');
  act(() => (host.querySelector('[aria-label="Inspect shard 0"]') as HTMLButtonElement).click());
  expect(host.querySelector('.sl-inspection h3')?.textContent).toBe('Inside shard 0');
  expect(host.querySelectorAll('.sl-inspection tbody tr')).toHaveLength(2);
  click('Close');
  expect(host.querySelector('.sl-inspection')).toBeNull();
  expect(tile.getAttribute('aria-pressed')).toBe('false');
});
it('previews event details on keyboard focus and dismisses them with Escape', () => {
  click('Distribute the rows');
  const tile = host.querySelector('[aria-label="Inspect event 23"]') as HTMLButtonElement;
  act(() => tile.focus());
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('Event 23');
  expect(host.querySelector('[role="tooltip"]')?.textContent).toContain('4 · Dune');
  expect(tile.getAttribute('aria-describedby')).toBe('event-preview');
  act(() => tile.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})));
  expect(host.querySelector('[role="tooltip"]')).toBeNull();
  expect(tile.getAttribute('aria-describedby')).toBeNull();
});
it('lets a reader pause and step slowly and review completed stages without rerunning', () => {
  click('Distribute the rows'); click('Run query'); click('Pause');
  const allSteps = host.querySelector('.sl-trace-columns')?.textContent;
  act(() => vi.advanceTimersByTime(30000));
  expect(host.querySelector('.sl-scene')?.className).toContain('phase-1');
  expect(host.querySelector('.sl-trace-explanation')?.textContent).toContain('Filter matches');
  click('Step');
  expect(host.querySelector('.sl-trace-columns')?.textContent).toBe(allSteps);
  expect(host.querySelector('.sl-trace-explanation')?.textContent).toContain('other three stay idle');
  click('Step'); click('Step');
  const result = host.querySelector('.sl-metrics.current')?.textContent;
  click('Plan');
  expect(host.querySelector('.sl-trace-explanation')?.textContent).toContain('Filter matches');
  click('Route');
  expect(host.querySelector('.sl-trace-explanation')?.textContent).toContain('Shard 1');
  expect(host.querySelector('.sl-metrics.current')?.textContent).toBe(result);
  expect(host.querySelector('.sl-scene')?.className).toContain('phase-4');
  click('Try user_id'); click('Run the same query'); click('Pause'); click('Step');
  expect(host.querySelector('.sl-trace-explanation')?.textContent).toContain('all four');
});
