"use strict";
/**
 * i18n — 国际化入口
 *
 * 纯模块：不依赖 VS Code API（可被纯 Node 单测加载）。
 * 语言来源由调用方注入：默认根据 VS Code 显示语言自动选择；
 * 支持通过 workspaceTiming.locale 设置强制指定（auto / zh-CN / en），
 * 运行期变更由 ConfigWatcher 调 setLocale 热切换（面板重建后生效）。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.t = t;
exports.resolveLocale = resolveLocale;
exports.init = init;
exports.setLocale = setLocale;
exports.currentLocale = currentLocale;
exports.labelsWithPrefix = labelsWithPrefix;
exports.format = format;
const zh_CN_1 = __importDefault(require("./zh-CN"));
const en_1 = __importDefault(require("./en"));
const locales = {
    'zh-CN': zh_CN_1.default,
    'en': en_1.default,
};
let _current = zh_CN_1.default;
/** 获取当前语言包 */
function t() {
    return _current;
}
/**
 * 解析最终语言：显式指定优先，否则跟随 VS Code 显示语言。
 * @param override 配置项 workspaceTiming.locale 的值
 * @param vsLanguage VS Code 显示语言（组合根注入 vscode.env.language）
 */
function resolveLocale(override, vsLanguage = 'en') {
    if (override === 'zh-CN' || override === 'en')
        return override;
    return vsLanguage.startsWith('zh') ? 'zh-CN' : 'en';
}
/** 根据 VS Code 语言设置（或显式覆盖值）初始化 */
function init(override, vsLanguage) {
    const locale = resolveLocale(override, vsLanguage);
    _current = locales[locale] ?? en_1.default;
}
/** 运行期热切换语言包（面板需由调用方重建以刷新静态文案） */
function setLocale(locale) {
    _current = locales[locale] ?? en_1.default;
}
/** 当前生效语言 */
function currentLocale() {
    return _current === en_1.default ? 'en' : 'zh-CN';
}
/** 提取面板词条子集（key 以给定前缀开头），供 dashboardTemplate 注入 */
function labelsWithPrefix(prefixes) {
    const dict = t();
    const out = {};
    for (const key of Object.keys(dict)) {
        if (prefixes.some(p => key.startsWith(p)))
            out[key] = dict[key];
    }
    return out;
}
/** 格式化字符串：替换 {0}, {1} ... 占位符 */
function format(template, ...args) {
    return template.replace(/\{(\d+)\}/g, (_, idx) => {
        const i = parseInt(idx, 10);
        return args[i] !== undefined ? String(args[i]) : `{${idx}}`;
    });
}
//# sourceMappingURL=index.js.map