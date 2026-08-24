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
exports.readTimingConfig = readTimingConfig;
const vscode = __importStar(require("vscode"));
const models_1 = require("../domain/models");
const DashboardPanel_1 = require("../presentation/DashboardPanel");
const Logger_1 = require("./Logger");
const index_1 = require("../i18n/index");
const CONFIG_SECTION = 'workspaceTiming';
/**
 * 读取当前用户配置（唯一入口，避免多处重复实现导致配置漂移）。
 * 供 ConfigWatcher 与 extension.ts 初始化共用，保证初始化/运行期配置同源。
 */
function readTimingConfig() {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        enabled: cfg.get('enabled', models_1.DEFAULT_CONFIG.enabled),
        globalDisabled: cfg.get('globalDisabled', models_1.DEFAULT_CONFIG.globalDisabled),
        locale: cfg.get('locale', models_1.DEFAULT_CONFIG.locale),
        statusBarEnabled: cfg.get('statusBar.enabled', models_1.DEFAULT_CONFIG.statusBarEnabled),
        backupToFile: cfg.get('storage.backupToFile', models_1.DEFAULT_CONFIG.backupToFile),
        journalEnabled: cfg.get('storage.journalEnabled', models_1.DEFAULT_CONFIG.journalEnabled),
        ringBufferCapacity: cfg.get('storage.ringBufferCapacity', models_1.DEFAULT_CONFIG.ringBufferCapacity),
        journalFlushIntervalMs: cfg.get('storage.journalFlushInterval', models_1.DEFAULT_CONFIG.journalFlushIntervalMs),
        fullSaveIntervalMs: cfg.get('storage.fullSaveInterval', models_1.DEFAULT_CONFIG.fullSaveIntervalMs),
        statusBarFormat: cfg.get('statusBar.format', models_1.DEFAULT_CONFIG.statusBarFormat),
        maxSessions: cfg.get('storage.maxSessions', models_1.DEFAULT_CONFIG.maxSessions),
        historyRawRetentionDays: cfg.get('storage.historyRawRetentionDays', models_1.DEFAULT_CONFIG.historyRawRetentionDays),
        safetySnapshot: cfg.get('storage.safetySnapshot', models_1.DEFAULT_CONFIG.safetySnapshot),
    };
}
class ConfigWatcher {
    constructor(orchestrator, statusBar, extensionUri) {
        this.disposables = [];
        /** 上次应用的语言设置（undefined=尚未应用过首轮） */
        this._lastLocale = undefined;
        this.orchestrator = orchestrator;
        this.statusBar = statusBar;
        this.extensionUri = extensionUri;
    }
    /** 开始监听配置变更 */
    start() {
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration(CONFIG_SECTION))
                return;
            try {
                // 云端同步占位：检测用户尝试开启云端同步 → 提示即将推出
                this.checkCloudSyncPlaceholder(e);
                const config = this.readConfig();
                this.applyConfig(config);
            }
            catch (err) {
                // 单次配置变更处理失败不应阻塞后续变更
                (0, Logger_1.log)(Logger_1.LogLevel.Error, 'ConfigWatcher: failed to apply config change', err);
            }
        }));
        // 读取初始配置
        const config = this.readConfig();
        this.applyConfig(config);
        (0, Logger_1.log)(Logger_1.LogLevel.Info, 'ConfigWatcher: started');
    }
    /** 读取当前配置 */
    readConfig() {
        return readTimingConfig();
    }
    /** 应用配置到各模块 */
    applyConfig(config) {
        // 0. 语言切换：热生效（面板重建 + 状态栏重渲染）；命令标题需窗口重载（VS Code 限制）
        if (config.locale !== undefined && config.locale !== this._lastLocale) {
            const isFirstApply = this._lastLocale === undefined;
            this._lastLocale = config.locale;
            (0, index_1.setLocale)((0, index_1.resolveLocale)(config.locale));
            if (!isFirstApply && DashboardPanel_1.DashboardPanel.currentPanel) {
                // 面板开着 → 按新语言重建
                DashboardPanel_1.DashboardPanel.disposeCurrent();
                DashboardPanel_1.DashboardPanel.createOrShow(this.extensionUri);
                (0, Logger_1.log)(Logger_1.LogLevel.Info, 'ConfigWatcher: locale changed, dashboard recreated');
            }
        }
        // 1. 更新 DisableManager
        this.orchestrator.disable.updateConfig({
            enabled: config.enabled,
            globalDisabled: config.globalDisabled,
        });
        // 2. 更新 StatusBar
        this.statusBar.updateConfig({
            enabled: config.statusBarEnabled,
        });
        // 3. 热更新调度间隔与会话历史上限（journalEnabled/capacity 需重启生效）
        this.orchestrator.applyRuntimeConfig(config);
        this.orchestrator.onDisableStateChanged(this.orchestrator.disable.resolveState());
        (0, Logger_1.log)(Logger_1.LogLevel.Debug, `ConfigWatcher: config applied (enabled=${config.enabled}, globalDisabled=${config.globalDisabled})`);
    }
    /**
     * 云端同步占位检测：
     * 用户尝试开启 cloudSync.enabled 时给出「即将推出」提示。
     * v0.2.0 阶段仅为扩展点占位，不实现真实同步。
     */
    checkCloudSyncPlaceholder(e) {
        if (!e.affectsConfiguration('workspaceTiming.cloudSync'))
            return;
        const cfg = vscode.workspace.getConfiguration('workspaceTiming.cloudSync');
        const enabled = cfg.get('enabled', false);
        if (enabled) {
            // 占位提示：云端同步即将推出
            vscode.window.showInformationMessage((0, index_1.t)()['toast.cloudSyncPlaceholder']);
            (0, Logger_1.log)(Logger_1.LogLevel.Info, 'ConfigWatcher: cloud sync placeholder triggered');
        }
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