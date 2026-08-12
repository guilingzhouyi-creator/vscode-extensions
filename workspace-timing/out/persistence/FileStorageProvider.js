"use strict";
/**
 * FileStorageProvider — JSON 文件备份存储
 *
 * 将计时数据写入 .workspace-timing-data/data.json。
 * 不放入 .vscode/ — VS Code 对该目录有文件监听，
 * 写入会触发 UI 刷新导致间歇性屏闪。
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
const Logger_1 = require("../integration/Logger");
const STORAGE_DIR = '.workspace-timing-data';
const FILE_NAME = 'data.json';
class FileStorageProvider {
    constructor(workspaceRoot) {
        this.id = 'file-storage';
        this._available = true;
        this.dirUri = vscode.Uri.joinPath(workspaceRoot, STORAGE_DIR);
        this.fileUri = vscode.Uri.joinPath(this.dirUri, FILE_NAME);
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
    async save(data) {
        try {
            const text = JSON.stringify(data, null, 2);
            const bytes = Buffer.from(text, 'utf-8');
            try {
                await vscode.workspace.fs.createDirectory(this.dirUri);
            }
            catch {
                // 目录已存在
            }
            await vscode.workspace.fs.writeFile(this.fileUri, bytes);
        }
        catch (err) {
            (0, Logger_1.log)(Logger_1.LogLevel.Error, 'FileStorageProvider: save failed', err);
            throw err;
        }
    }
    async delete() {
        try {
            try {
                await vscode.workspace.fs.stat(this.fileUri);
            }
            catch {
                return;
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