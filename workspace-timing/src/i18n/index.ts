/**
 * Module: I18nService — 国际化解析与语言包管理服务
 * File Path: src/i18n/index.ts
 * Architecture Role: Internationalization layer runtime dispatcher and string lookup service
 * Dependencies & Triggers: src/i18n/types.ts, src/i18n/zh-CN.ts, src/i18n/en.ts; initialized at bootstrap and hot-swapped via ConfigWatcher
 * Responsibilities: Resolve effective locale based on VS Code environment and configuration overrides; manage active dictionary lookup; format placeholder tokens ({0}, {1}); slice prefix-filtered labels for webviews
 * Exit Semantics & Design Rationale: Pure Node.js module with zero VS Code API imports; guarantees fallback to English dictionary if requested locale is unsupported; supports runtime hot-switching without restart
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
