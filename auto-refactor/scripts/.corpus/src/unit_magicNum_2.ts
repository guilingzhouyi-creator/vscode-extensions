export function clamp(v: number): number {
  if (v > 100) return 100;
  if (v < -100) return -100;
  return v;
}
export const LIMIT = 100;
export function rate(x: number): number {
  // 100 repeated several times -> duplicate-literal
  return x * 100 + 100 - 100;
}
