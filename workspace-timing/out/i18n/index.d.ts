/**
 * i18n — 国际化入口
 *
 * 纯模块：不依赖 VS Code API（可被纯 Node 单测加载）。
 * 语言来源由调用方注入：默认根据 VS Code 显示语言自动选择；
 * 支持通过 workspaceTiming.locale 设置强制指定（auto / zh-CN / en），
 * 运行期变更由 ConfigWatcher 调 setLocale 热切换（面板重建后生效）。
 */
import { I18nStrings, Locale } from './types';
/** 获取当前语言包 */
export declare function t(): I18nStrings;
/**
 * 解析最终语言：显式指定优先，否则跟随 VS Code 显示语言。
 * @param override 配置项 workspaceTiming.locale 的值
 * @param vsLanguage VS Code 显示语言（组合根注入 vscode.env.language）
 */
export declare function resolveLocale(override?: string, vsLanguage?: string): Locale;
/** 根据 VS Code 语言设置（或显式覆盖值）初始化 */
export declare function init(override?: string, vsLanguage?: string): void;
/** 运行期热切换语言包（面板需由调用方重建以刷新静态文案） */
export declare function setLocale(locale: Locale): void;
/** 当前生效语言 */
export declare function currentLocale(): Locale;
/** 提取面板词条子集（key 以给定前缀开头），供 dashboardTemplate 注入 */
export declare function labelsWithPrefix(prefixes: string[]): Record<string, string>;
/** 格式化字符串：替换 {0}, {1} ... 占位符 */
export declare function format(template: string, ...args: (string | number)[]): string;
