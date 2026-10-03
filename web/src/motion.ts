// One visual velocity for row movement, requests and replies. Not system latency.
export const PIXELS_PER_SECOND = 320;
export function travelTime(distance: number, speed: number) {
  return Math.max(1, distance) / (PIXELS_PER_SECOND * speed) * 1000;
}
