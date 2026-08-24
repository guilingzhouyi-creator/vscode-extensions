/**
 * i18n — 国际化入口
 *
 * 纯模块：不依赖 VS Code API（可被纯 Node 单测加载）。
 * 语言来源由调用方注入：默认根据 VS Code 显示语言自动选择；
 * 支持通过 workspaceTiming.locale 设置强制指定（auto / zh-CN / en），
 * 运行期变更由 ConfigWatcher 调 setLocale 热切换（面板重建后生效）。
 */

import { I18nStrings, Locale } from './types';
import zhCN from './zh-CN';
import en from './en';

const locales: Record<Locale, I18nStrings> = {
    'zh-CN': zhCN,
    'en': en,
};

let _current: I18nStrings = zhCN;

/** 获取当前语言包 */
export function t(): I18nStrings {
    return _current;
}

/**
 * 解析最终语言：显式指定优先，否则跟随 VS Code 显示语言。
 * @param override 配置项 workspaceTiming.locale 的值
 * @param vsLanguage VS Code 显示语言（组合根注入 vscode.env.language）
 */
export function resolveLocale(override?: string, vsLanguage = 'en'): Locale {
    if (override === 'zh-CN' || override === 'en') return override;
    return vsLanguage.startsWith('zh') ? 'zh-CN' : 'en';
}

/** 根据 VS Code 语言设置（或显式覆盖值）初始化 */
export function init(override?: string, vsLanguage?: string): void {
    const locale = resolveLocale(override, vsLanguage);
    _current = locales[locale] ?? en;
}

/** 运行期热切换语言包（面板需由调用方重建以刷新静态文案） */
export function setLocale(locale: Locale): void {
    _current = locales[locale] ?? en;
}

/** 当前生效语言 */
export function currentLocale(): Locale {
    return _current === en ? 'en' : 'zh-CN';
}

/** 提取面板词条子集（key 以给定前缀开头），供 dashboardTemplate 注入 */
export function labelsWithPrefix(prefixes: string[]): Record<string, string> {
    const dict = t() as unknown as Record<string, string>;
    const out: Record<string, string> = {};
    for (const key of Object.keys(dict)) {
        if (prefixes.some(p => key.startsWith(p))) out[key] = dict[key];
    }
    return out;
}

/** 格式化字符串：替换 {0}, {1} ... 占位符 */
export function format(template: string, ...args: (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (_, idx) => {
        const i = parseInt(idx, 10);
        return args[i] !== undefined ? String(args[i]) : `{${idx}}`;
    });
}
