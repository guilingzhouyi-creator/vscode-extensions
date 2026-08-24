"use strict";
/**
 * FileStorageProvider — JSON 文件备份存储
 *
 * 将计时数据写入 .vscode/workspace-timing.json。
 * 用户可见、可版本控制、可移植。
 * 配合 workspaceState 作为双重保障。
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
exports.FileStorageProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const Logger_1 = require("../integration/Logger");
const FILE_NAME = 'workspace-timing.json';
class FileStorageProvider {
    constructor(workspaceRoot) {
        this.id = 'file-storage';
        this._available = true;
        const dotVscode = vscode.Uri.joinPath(workspaceRoot, '.vscode');
        this.fileUri = vscode.Uri.joinPath(dotVscode, FILE_NAME);
    }
    isAvailable() {
        return this._available;
    }
    async load() {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            }
            catch {
                // 文件不存在
                return null;
            }
            const bytes = await vscode.workspace.fs.readFile(this.fileUri);
            const text = Buffer.from(bytes).toString('utf-8');
            const data = JSON.parse(text);
            if (typeof data.totalMs !== 'number' || typeof data.version !== 'number') {
                (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'FileStorageProvider: invalid data format, ignoring');
                return null;
            }
            return data;
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Warn, 'FileStorageProvider: load failed', err);
            this._available = false;
            return null;
        }
    }
    /** 主备份文件路径（供还原命令做默认定位） */
    get uri() {
        return this.fileUri;
    }
    async save(data) {
        await this.writeTo(this.fileUri, data);
    }
    /**
     * 写入 .vscode/ 下的指定文件名（安全快照 / before-restore 等辅助文件）。
     * 与 save 同格式（pretty JSON），不改变主备份文件。
     */
    async saveAs(data, fileName) {
        const dotVscode = vscode.Uri.file(path.dirname(this.fileUri.fsPath));
        const target = vscode.Uri.joinPath(dotVscode, fileName);
        await this.writeTo(target, data);
    }
    async writeTo(target, data) {
        try {
            const text = JSON.stringify(data, null, 2);
            const bytes = Buffer.from(text, 'utf-8');
            // 确保 .vscode 目录存在（用 fsPath + path.dirname 正确解析父目录，
            // 而非 joinPath(uri,'..')——后者不解析 `..` 而是追加字面路径段）
            const dotVscode = vscode.Uri.file(path.dirname(target.fsPath));
            try {
                await vscode.workspace.fs.createDirectory(dotVscode);
            }
            catch {
                // 目录已存在
            }
            await vscode.workspace.fs.writeFile(target, bytes);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'FileStorageProvider: write failed', err);
            throw err;
        }
    }
    async delete() {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            }
            catch {
                return; // 文件不存在，无需删除
            }
            await vscode.workspace.fs.delete(this.fileUri);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'FileStorageProvider: delete failed', err);
            throw err;
        }
    }
}
exports.FileStorageProvider = FileStorageProvider;
//# sourceMappingURL=FileStorageProvider.js.map