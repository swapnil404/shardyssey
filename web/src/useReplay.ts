import { useEffect, useRef, useState } from 'react';
import { clampCursor, nextEvent, type ReplayModel } from './recording';

export function useReplay(model: ReplayModel) {
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1 / 2000);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const seek = (position: number) => { setPlaying(false); cursorRef.current = clampCursor(model, position); setCursor(cursorRef.current); };
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { setReducedMotion(query.matches); setPlaying(false); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!playing || reducedMotion || !model.available) return;
    const origin = performance.now();
    const startingCursor = cursorRef.current;
    let frame = 0;
    const tick = (time: number) => {
      const next = clampCursor(model, startingCursor + (time - origin) * speed * 1000);
      cursorRef.current = next;
      setCursor(next);
      if (next >= model.duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, reducedMotion, speed, model]);
  const toggle = () => {
    if (!model.available) return;
    if (reducedMotion) { seek(cursor >= model.duration ? 0 : nextEvent(model, cursor)); return; }
    if (cursor >= model.duration) { cursorRef.current = 0; setCursor(0); }
    setPlaying(value => !value);
  };
  return { cursor, playing, speed, setSpeed, reducedMotion, seek, toggle };
}
