"use strict";
/**
 * i18n — 国际化入口
 *
 * 根据 VS Code 语言设置自动选择语言包。
 * 通过 workspaceTiming.locale 设置可强制指定。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.t = t;
exports.init = init;
exports.format = format;
const vscode = __importStar(require("vscode"));
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
/** 根据 VS Code 语言设置初始化 */
function init() {
    const vsLocale = vscode.env.language; // "zh-CN", "en", "ja", etc.
    const locale = vsLocale.startsWith('zh') ? 'zh-CN' : 'en';
    _current = locales[locale] ?? en_1.default;
}
/** 格式化字符串：替换 {0}, {1} ... 占位符 */
function format(template, ...args) {
    return template.replace(/\{(\d+)\}/g, (_, idx) => {
        const i = parseInt(idx, 10);
        return args[i] !== undefined ? String(args[i]) : `{${idx}}`;
    });
}
//# sourceMappingURL=index.js.map