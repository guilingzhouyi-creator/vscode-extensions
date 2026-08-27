function t(s: string): string { return s; }
export function page(): string {
  const a = t('welcome message');
  const b = t('goodbye message');
  return a + b;
}
