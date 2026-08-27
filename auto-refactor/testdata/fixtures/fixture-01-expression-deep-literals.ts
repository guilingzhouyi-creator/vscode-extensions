// fixture 01: expression-deep literals — literal parents are T0 placeholders
export function compute(x: number, i: number, a: number[]): number {
  return x * 100 + 100 - 100;
}
export function callIt(): number {
  return foo(5);
}
export function idx(): number {
  const a = [1, 2, 3];
  return a[0];
}
export function assign(a: number[]): void {
  a[i] = 5;
}
export function str(): string {
  return (5).toString();
}
export const MAGIC = 42;
