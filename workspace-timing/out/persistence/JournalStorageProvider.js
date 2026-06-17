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
    /** 批量追加时间片到 journal */
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
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'JournalStorageProvider: appendBatch failed', err);
            this._available = false;
        }
    }
    /** 实际执行文件追加 */
    async doAppend(bytes) {
        try {
            // 确保 .vscode 目录存在
            const dotVscode = vscode.Uri.joinPath(this.journalUri, '..');
            try {
                await vscode.workspace.fs.createDirectory(dotVscode);
            }
            catch {
                // 目录已存在
            }
            // 读取现有内容，追加写入
            let existing = Buffer.alloc(0);
            try {
                const existingBytes = await vscode.workspace.fs.readFile(this.journalUri);
                existing = Buffer.from(existingBytes);
            }
            catch {
                // 文件不存在，从头开始
            }
            const combined = Buffer.concat([existing, bytes]);
            await vscode.workspace.fs.writeFile(this.journalUri, combined);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'JournalStorageProvider: append failed', err);
        }
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
                    if (typeof parsed.t === 'number' && typeof parsed.d === 'number') {
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
    /** 清空 journal 文件 */
    async truncate() {
        try {
            const exists = await this.exists();
            if (!exists)
                return;
            await vscode.workspace.fs.writeFile(this.journalUri, Buffer.alloc(0));
            (0, Logger_1.log)(Logger_1.LogLevel.Debug, 'JournalStorageProvider: journal truncated');
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'JournalStorageProvider: truncate failed', err);
        }
    }
}
exports.JournalStorageProvider = JournalStorageProvider;
//# sourceMappingURL=JournalStorageProvider.js.map