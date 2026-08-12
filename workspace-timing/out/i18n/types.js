"use strict";
/**
 * i18n types — 国际化字符串 key 定义
 *
 * 约定：按 UI 区域分层命名
 *   panel.xxx   → 配置面板
 *   status.xxx  → 状态栏
 *   cmd.xxx     → 命令
 *   common.xxx  → 通用
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.format = format;
/** 字符串格式化：替换 {0} {1} ... */
function format(template, ...args) {
    return template.replace(/\{(\d+)\}/g, (_, i) => args[parseInt(i)] ?? '');
}
//# sourceMappingURL=types.js.map