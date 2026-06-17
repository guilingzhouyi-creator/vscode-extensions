"use strict";
/**
 * ConfigWatcher — 配置变更监听器
 *
 * 职责：监听 VS Code 设置变更，同步到 DisableManager 和其他模块
 * 边界：只做配置变更通知，不做业务决策
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
exports.ConfigWatcher = void 0;
const vscode = __importStar(require("vscode"));
const models_1 = require("../domain/models");
const Logger_1 = require("./Logger");
const CONFIG_SECTION = 'workspaceTiming';
class ConfigWatcher {
    constructor(orchestrator, statusBar) {
        this.disposables = [];
        this.orchestrator = orchestrator;
        this.statusBar = statusBar;
    }
    /** 开始监听配置变更 */
    start() {
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration(CONFIG_SECTION))
                return;
            const config = this.readConfig();
            this.applyConfig(config);
        }));
        // 读取初始配置
        const config = this.readConfig();
        this.applyConfig(config);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'ConfigWatcher: started');
    }
    /** 读取当前配置 */
    readConfig() {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return {
            enabled: cfg.get('enabled', models_1.DEFAULT_CONFIG.enabled),
            globalDisabled: cfg.get('globalDisabled', models_1.DEFAULT_CONFIG.globalDisabled),
            statusBarEnabled: cfg.get('statusBar.enabled', models_1.DEFAULT_CONFIG.statusBarEnabled),
            backupToFile: cfg.get('storage.backupToFile', models_1.DEFAULT_CONFIG.backupToFile),
            journalEnabled: cfg.get('storage.journalEnabled', models_1.DEFAULT_CONFIG.journalEnabled),
            ringBufferCapacity: cfg.get('storage.ringBufferCapacity', models_1.DEFAULT_CONFIG.ringBufferCapacity),
            journalFlushIntervalMs: cfg.get('storage.journalFlushInterval', models_1.DEFAULT_CONFIG.journalFlushIntervalMs),
            fullSaveIntervalMs: cfg.get('storage.fullSaveInterval', models_1.DEFAULT_CONFIG.fullSaveIntervalMs),
            statusBarFormat: cfg.get('statusBar.format', models_1.DEFAULT_CONFIG.statusBarFormat),
            maxSessions: cfg.get('storage.maxSessions', models_1.DEFAULT_CONFIG.maxSessions),
        };
    }
    /** 应用配置到各模块 */
    applyConfig(config) {
        // 1. 更新 DisableManager
        this.orchestrator.disable.updateConfig({
            enabled: config.enabled,
            globalDisabled: config.globalDisabled,
        });
        // 2. 更新 StatusBar
        this.statusBar.updateConfig({
            enabled: config.statusBarEnabled,
        });
        this.orchestrator.onDisableStateChanged(this.orchestrator.disable.resolveState());
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `ConfigWatcher: config applied (enabled=${config.enabled}, globalDisabled=${config.globalDisabled})`);
    }
    /** 停止监听 */
    stop() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }
}
exports.ConfigWatcher = ConfigWatcher;
//# sourceMappingURL=ConfigWatcher.js.map