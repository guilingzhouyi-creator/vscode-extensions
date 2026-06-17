/**
 * i18n — 国际化入口
 *
 * 根据 VS Code 语言设置自动选择语言包。
 * 通过 workspaceTiming.locale 设置可强制指定。
 */

import * as vscode from 'vscode';
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

/** 根据 VS Code 语言设置初始化 */
export function init(): void {
    const vsLocale = vscode.env.language; // "zh-CN", "en", "ja", etc.
    const locale: Locale = vsLocale.startsWith('zh') ? 'zh-CN' : 'en';
    _current = locales[locale] ?? en;
}

/** 格式化字符串：替换 {0}, {1} ... 占位符 */
export function format(template: string, ...args: (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (_, idx) => {
        const i = parseInt(idx, 10);
        return args[i] !== undefined ? String(args[i]) : `{${idx}}`;
    });
}
