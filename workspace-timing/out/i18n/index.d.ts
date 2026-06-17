/**
 * i18n — 国际化入口
 *
 * 根据 VS Code 语言设置自动选择语言包。
 * 通过 workspaceTiming.locale 设置可强制指定。
 */
import { I18nStrings } from './types';
/** 获取当前语言包 */
export declare function t(): I18nStrings;
/** 根据 VS Code 语言设置初始化 */
export declare function init(): void;
/** 格式化字符串：替换 {0}, {1} ... 占位符 */
export declare function format(template: string, ...args: (string | number)[]): string;
