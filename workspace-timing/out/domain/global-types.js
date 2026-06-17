"use strict";
/**
 * global-types — 跨工作区累计数据模型
 *
 * 存放在 domain 层，供 persistence 和 application 层引用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_VERSION = void 0;
exports.createEmptyGlobalData = createEmptyGlobalData;
exports.normalizeWorkspaceId = normalizeWorkspaceId;
exports.GLOBAL_VERSION = 1;
/** 创建空的全局数据 */
function createEmptyGlobalData() {
    return {
        version: exports.GLOBAL_VERSION,
        totalMs: 0,
        workspaces: {},
        lastUpdatedAt: 0,
    };
}
/**
 * 将工作区 URI 规范化为稳定 ID
 * 用于跨会话标识同一个工作区
 */
function normalizeWorkspaceId(uri) {
    // 统一小写 + 去除末尾斜杠
    return uri.toLowerCase().replace(/\/+$/, '');
}
//# sourceMappingURL=global-types.js.map