// fixture 13: drift-targeted — literals inside function subtrees whose
// isConstBound / tolerated need raw VariableDeclaration / Call ancestors
export function f(): number {
  const n = 100;
  const m = 100;
  return n + 200;
}
export function g(): void {
  t('hello world');
  const key = obj['prop'];
  const arr = [1, 2, 3];
  const val = arr[0];
  if (val > 5) {
    const z = 7;
    void z;
  }
}
export const handler = () => {
  const inner = () => {
    return 5;
  };
  return inner() + 1;
};
function t(s: string): string {
  return s;
}
declare const obj: Record<string, string>;
