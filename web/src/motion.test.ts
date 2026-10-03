import { expect, it } from 'vitest';
import { travelTime } from './motion';
it('keeps the same visual velocity over short and long routes', () => {
  expect(travelTime(640,1)).toBe(2 * travelTime(320,1));
  expect(travelTime(32,1)).toBe(100);
});
it('applies the slider multiplier to every route length', () => {
  for (const distance of [28, 170, 500, 900]) {
    expect(travelTime(distance,.25)).toBe(4 * travelTime(distance,1));
    expect(travelTime(distance,4)).toBe(travelTime(distance,1)/4);
  }
});
