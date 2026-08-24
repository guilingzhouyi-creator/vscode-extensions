"use strict";
/**
 * JournalStorageProvider — 日志文件存储
 *
 * 管理 .vscode/workspace-timing.journal 文件。
 * 格式：每行一个紧凑 JSON，代表一条 TimeSlice：
 *   {"t":<timestamp_ms>,"d":<delta_ms>}
 *
 * 文件生命周期：
 *   - 写入：append 追加到文件末尾
 *   - 回放：崩溃恢复时读取全部行
 *   - 清理：全量存盘成功后 truncate 清空
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.JournalStorageProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const Logger_1 = require("../integration/Logger");
const JOURNAL_FILE = 'workspace-timing.journal';
class JournalStorageProvider {
    constructor(workspaceRoot) {
        this.id = 'journal-storage';
        this._available = true;
        const dotVscode = vscode.Uri.joinPath(workspaceRoot, '.vscode');
        this.journalUri = vscode.Uri.joinPath(dotVscode, JOURNAL_FILE);
    }
    // IStorageProvider 方法（journal 不支持完整 load/save，
    // 这些方法通过 StorageCoordinator 委托给主存储）
    isAvailable() {
        return this._available;
    }
    async load() {
        return null;
    }
    async save(_data) {
        // journal 不支持全量 save，参数保留以满足接口契约
    }
    async delete() {
        await this.truncate();
    }
    // ---- journal 专有方法 ----
    /** 检查 journal 文件是否存在 */
    async exists() {
        try {
            await vscode.workspace.fs.stat(this.journalUri);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 批量追加时间片到 journal。
     * ★ 失败语义（IJournalStore 契约）：写入失败时**抛出异常**，绝不静默吞掉——
     *   调用方（JournalWriter）依赖抛错把切片退回内存缓冲，否则数据两头落空。
     */
    async appendBatch(slices) {
        if (slices.length === 0)
            return;
        try {
            const lines = slices.map(s => JSON.stringify({ t: s.timestamp, d: s.deltaMs }));
            const text = lines.join('\n') + '\n';
            const bytes = Buffer.from(text, 'utf-8');
            await this.doAppend(bytes);
        }
        catch (err) {
            this._available = false;
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'JournalStorageProvider: appendBatch failed', err);
            throw err;
        }
    }
    /** 实际执行文件追加（失败向上抛出） */
    async doAppend(bytes) {
        // 确保 .vscode 目录存在（用 fsPath + path.dirname 正确解析父目录，
        // 而非 joinPath(uri,'..')——后者不解析 `..` 而是追加字面路径段）
        const dotVscode = vscode.Uri.file(path.dirname(this.journalUri.fsPath));
        try {
            await vscode.workspace.fs.createDirectory(dotVscode);
        }
        catch {
            // 目录已存在
        }
        // 修复 O(n) 全量重写：改用 Node fs.appendFile 直接追加（O(1)）。
        // 原实现每次"读全文件+合并+写回"，journal 增长后每次 flush 都会全量重写，
        // 日志越大越慢。Node 的 appendFile 追加为 O(1)，小写入通常原子完成。
        // VS Code 的 workspace.fs 无追加 API，故通过 fsPath 使用 Node fs。
        await fs.promises.appendFile(this.journalUri.fsPath, bytes);
    }
    /** 读取 journal 中所有时间片 */
    async readJournal() {
        try {
            const exists = await this.exists();
            if (!exists)
                return [];
            const bytes = await vscode.workspace.fs.readFile(this.journalUri);
            const text = Buffer.from(bytes).toString('utf-8').trim();
            if (!text)
                return [];
            const slices = [];
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    const parsed = JSON.parse(trimmed);
                    // 数值合法性校验：拒绝负值/非有限数/异常大 delta（delta 必须 < timestamp，
                    // 否则回放时 start = timestamp - deltaMs 为负），防止脏数据污染恢复结果
                    if (typeof parsed.t === 'number' && Number.isFinite(parsed.t) && parsed.t > 0
                        && typeof parsed.d === 'number' && Number.isFinite(parsed.d)
                        && parsed.d > 0 && parsed.d < parsed.t) {
                        slices.push({ timestamp: parsed.t, deltaMs: parsed.d });
                    }
                }
                catch {
                    // 跳过损坏的行
                    (0, Logger_1.log)(Logger_1.LogLevel.Warn, `JournalStorageProvider: skipping corrupt line: ${trimmed}`);
                }
            }
            return slices;
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'JournalStorageProvider: readJournal failed', err);
            return [];
        }
    }
    /**
     * 清空 journal 文件。
     * ★ 失败语义（IJournalStore 契约）：清空失败时**抛出异常**——
     *   truncate 失败意味着 journal 残留已回放过的切片，若静默则下次恢复会重复累计。
     *   recover() 依赖 metadata.lastJournalTs 水位线兜底（见 StorageCoordinator）。
     */
    async truncate() {
        const exists = await this.exists();
        if (!exists)
            return;
        await vscode.workspace.fs.writeFile(this.journalUri, Buffer.alloc(0));
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, 'JournalStorageProvider: journal truncated');
    }
}
exports.JournalStorageProvider = JournalStorageProvider;
//# sourceMappingURL=JournalStorageProvider.js.map