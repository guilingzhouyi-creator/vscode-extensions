// fixture 11: i18n / tolerated contexts
function t(s: string): string {
  return s;
}
export function page(): string {
  const a = t('welcome message');
  const b = i18n.t('goodbye message');
  const c = translate('translated');
  const key = 'a'['b'];
  return a + b + c + key;
}
export function jsx(): void {
  const div = <div attr="x">text</div>;
  void div;
}
import 'side-effect-package';
export const THEME = 'dark';
