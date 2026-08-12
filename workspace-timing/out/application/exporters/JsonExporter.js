"use strict";
/**
 * JsonExporter — 全量数据 JSON 导出
 *
 * 把面板/统计所需的全部数据（累计、目标、连续打卡、每日/每月明细、
 * 热力图、原始会话列表）序列化为 JSON，便于二次分析或迁移。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonExporter = void 0;
class JsonExporter {
    constructor() {
        this.formatName = 'json';
    }
    exportBundle(bundle) {
        return JSON.stringify(bundle, null, 2);
    }
}
exports.JsonExporter = JsonExporter;
//# sourceMappingURL=JsonExporter.js.map