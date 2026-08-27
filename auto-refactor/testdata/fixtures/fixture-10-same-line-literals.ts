// fixture 10: same-line multiple literals (duplicate-literal lines ordering)
const a = 1, b = 1;
const c = 2, d = 2;
export function multi(): void {
  f(1, 1, 1);
  g(3, 3, 3, 3);
}
function f(x: number, y: number, z: number): void {
  void x;
  void y;
  void z;
}
function g(p: number, q: number, r: number, s: number): void {
  void p;
  void q;
  void r;
  void s;
}
