/**
 * Module: ActivityWatcher — Host Interaction, File Change & Git Activity Watcher
 * File Path: src/integration/ActivityWatcher.ts
 * Architecture Role: Integration layer observer detecting user interactions, external file changes, and Git events
 * Dependencies & Triggers: Consumes vscode editor/workspace events and vscode.git extension API; notifies ActivityWatcherListener
 * Responsibilities: Monitor keyboard/editor input, detect AI agent filesystem/git modifications, manage activity modes (manual/ai/idle), and enforce cooldown windows
 * Exit Semantics & Design Rationale: Pure listener and event dispatcher with zero storage or UI side effects; encapsulates host event subscriptions and releases all listeners cleanly on dispose
 */

import * as vscode from 'vscode';
import {
    ActivityMode,
    MS_PER_SECOND,
    MS_PER_MINUTE,
    DEFAULT_IDLE_TIMEOUT_MINUTES,
    DEFAULT_AI_COOLDOWN_SECONDS,
    DEFAULT_AI_DETECTION_ENABLED,
} from '../domain/models';
import { LogLevel, log } from './Logger';

/** 监测器状态枚举（包含工作模式与内部空闲态） */
export type WatcherMode = ActivityMode | 'idle';

/** 模式常量（消除重复字面量） */
const WATCHER_MODE_MANUAL: ActivityMode = 'manual';
const WATCHER_MODE_AI: ActivityMode = 'ai';
const WATCHER_MODE_IDLE: WatcherMode = 'idle';

/** 静态日志文案常量 */
const MSG_WATCHER_STARTED = 'ActivityWatcher: started';
const MSG_GIT_ACTIVATION_SKIPPED = 'ActivityWatcher: git activation skipped';
const MSG_GIT_BIND_FAILED = 'ActivityWatcher: failed to bind git extension';
const MSG_GIT_READ_API_FAILED = 'ActivityWatcher: failed to read git api';
const MSG_REPO_BIND_FAILED = 'ActivityWatcher: failed to bind repo';
const MSG_WATCHER_DISPOSED = 'ActivityWatcher: disposed';

/** 活动监听观察者回调端口（消费方按需实现） */
export interface ActivityWatcherListener {
    /** 活跃心跳通知（人工操作或 AI 协作中） */
    onActivity(mode: ActivityMode, timestampMs: number): void;
    /** 空闲超时触发 */
    onIdle(timestampMs: number): void;
    /** 活动模式切换通知（可选） */
    onModeChange?(mode: WatcherMode, previousMode: WatcherMode, timestampMs: number): void;
}

/** 活动检测配置项 */
export interface ActivityWatcherOptions {
    /** 空闲判定超时时间（分钟，0 表示不启用） */
    idleTimeoutMinutes: number;
    /** 是否开启 AI / 外部变更智能检测 */
    aiDetectionEnabled: boolean;
    /** AI 外部写入停止后的冷却观察窗口（秒） */
    aiCooldownSeconds: number;
}

/** 默认活动检测配置 */
export const DEFAULT_ACTIVITY_OPTIONS: Readonly<ActivityWatcherOptions> = {
    idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
    aiDetectionEnabled: DEFAULT_AI_DETECTION_ENABLED,
    aiCooldownSeconds: DEFAULT_AI_COOLDOWN_SECONDS,
};

/** 键盘静默观察窗口（2000ms 无手动输入视为静默，此时外部变更转为 AI 模式） */
const MANUAL_SILENCE_WINDOW_MS = 2 * MS_PER_SECOND;

/** 排除的文件路径正则（严格忽略依赖、编译产物与元数据目录，O(M) 单 pass 匹配） */
const IGNORED_PATH_REGEX = /[/\\](node_modules|\.git|dist|out|build|\.vscode-test|\.gemini|coverage)($|[/\\])/i;

/** 判断给定的文件 URI 是否属于被忽略的目录 */
function isIgnoredUri(uri: vscode.Uri): boolean {
    return IGNORED_PATH_REGEX.test(uri.fsPath);
}

/** VS Code 内置 Git 扩展结构声明（用于运行时安全获取 Git API） */
interface GitExtensionApi {
    repositories?: ReadonlyArray<{
        state?: {
            onDidChange?: vscode.Event<void>;
        };
    }>;
    onDidOpenRepository?: vscode.Event<{
        state?: {
            onDidChange?: vscode.Event<void>;
        };
    }>;
}

interface GitExtension {
    getAPI?(version: number): GitExtensionApi;
}

/**
 * 活动监测器：监听 VS Code 编辑器操作、源码文件变动与 Git 状态，
 * 判定工作区当前处于 manual（人工）、ai（AI 协作）或 idle（空闲）状态。
 */
export class ActivityWatcher implements vscode.Disposable {
    private readonly subscriptions: vscode.Disposable[] = [];
    private _listener: ActivityWatcherListener | null = null;
    private _options: ActivityWatcherOptions;

    private _mode: WatcherMode = WATCHER_MODE_MANUAL;
    private _lastActivityMs: number = Date.now();
    private _lastManualActivityMs: number = Date.now();
    private _lastAiActivityMs: number = 0;
    private _lastAiHeartbeatMs: number = 0;
    private _lastHeartbeatMs: number = 0;

    private _debounceTimer: NodeJS.Timeout | null = null;
    private _aiDebounceTimer: NodeJS.Timeout | null = null;
    private _tickInterval: NodeJS.Timeout | null = null;
    private _isStarted: boolean = false;

    constructor(
        options?: Partial<ActivityWatcherOptions>,
        listener?: ActivityWatcherListener,
    ) {
        this._options = {
            ...DEFAULT_ACTIVITY_OPTIONS,
            ...(options ?? {}),
        };
        if (listener) {
            this._listener = listener;
        }
    }

    /** 注册或替换监听回调 */
    public setListener(listener: ActivityWatcherListener): void {
        this._listener = listener;
    }

    /** 获取当前活动模式 */
    public getCurrentMode(): WatcherMode {
        return this._mode;
    }

    /** 获取最近一次活动时间戳 (ms) */
    public getLastActivityMs(): number {
        return this._lastActivityMs;
    }

    /** 动态更新配置项 */
    public updateConfig(options: Partial<ActivityWatcherOptions>): void {
        this._options = {
            ...this._options,
            ...options,
        };
        log(LogLevel.Debug, `ActivityWatcher: config updated (idleTimeout=${this._options.idleTimeoutMinutes}m, aiEnabled=${this._options.aiDetectionEnabled}, cooldown=${this._options.aiCooldownSeconds}s)`);
    }

    /** 启动所有事件监听与周期性定时器 */
    public start(): void {
        if (this._isStarted) {
            return;
        }
        this._isStarted = true;

        this.initEditorListeners();
        this.initFileSystemWatcher();
        this.initGitWatcher();

        this._tickInterval = setInterval(() => {
            this.tick();
        }, MS_PER_SECOND);

        log(LogLevel.Info, MSG_WATCHER_STARTED);
    }

    /** 监听编辑器键盘输入与交互（强人工信号） */
    private initEditorListeners(): void {
        this.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.contentChanges.length === 0) {
                    return;
                }
                this.recordManualActivity();
            }),
        );
        this.subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                this.recordManualActivity();
            }),
        );
        this.subscriptions.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(() => {
                this.recordManualActivity();
            }),
        );
        this.subscriptions.push(
            vscode.window.onDidChangeWindowState(e => {
                if (e.focused) {
                    this.recordManualActivity();
                }
            }),
        );
    }

    /** 监听文件系统源码变动（AI / Agent 外部写入信号） */
    private initFileSystemWatcher(): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        const handleUri = (uri: vscode.Uri): void => {
            if (isIgnoredUri(uri)) {
                return;
            }
            this.handleExternalSignal();
        };

        this.subscriptions.push(
            watcher.onDidChange(handleUri),
            watcher.onDidCreate(handleUri),
            watcher.onDidDelete(handleUri),
            watcher,
        );
    }

    /** 监听 Git 仓库变更（工作区增量变动信号） */
    private initGitWatcher(): void {
        try {
            const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
            if (!gitExt) {
                return;
            }
            if (gitExt.isActive) {
                this.bindGitApi(gitExt.exports);
            } else {
                gitExt.activate().then(
                    exports => this.bindGitApi(exports),
                    err => log(LogLevel.Debug, MSG_GIT_ACTIVATION_SKIPPED, err as Error),
                );
            }
        } catch (err) {
            log(LogLevel.Debug, MSG_GIT_BIND_FAILED, err as Error);
        }
    }

    /** 绑定 Git API 仓库状态事件 */
    private bindGitApi(exports: GitExtension | undefined): void {
        try {
            const gitApi = exports?.getAPI?.(1);
            if (!gitApi) {
                return;
            }
            const repos = gitApi.repositories ?? [];
            for (const repo of repos) {
                this.bindRepo(repo);
            }
            if (gitApi.onDidOpenRepository) {
                this.subscriptions.push(
                    gitApi.onDidOpenRepository(repo => {
                        this.bindRepo(repo);
                    }),
                );
            }
        } catch (err) {
            log(LogLevel.Debug, MSG_GIT_READ_API_FAILED, err as Error);
        }
    }

    /** 绑定单个 Git 仓库的变更监听 */
    private bindRepo(repo: { state?: { onDidChange?: vscode.Event<void> } }): void {
        try {
            if (repo?.state?.onDidChange) {
                this.subscriptions.push(
                    repo.state.onDidChange(() => {
                        this.handleExternalSignal();
                    }),
                );
            }
        } catch (err) {
            log(LogLevel.Debug, MSG_REPO_BIND_FAILED, err as Error);
        }
    }

    /** 记录人工活动并做 1000ms 窗口防抖心跳聚合 */
    private recordManualActivity(): void {
        const now = Date.now();
        this._lastManualActivityMs = now;
        this._lastActivityMs = now;

        if (this._mode !== WATCHER_MODE_MANUAL) {
            this.setMode(WATCHER_MODE_MANUAL, now);
        }

        if (this._debounceTimer !== null) {
            return;
        }

        if (now - this._lastHeartbeatMs >= MS_PER_SECOND) {
            this._lastHeartbeatMs = now;
            this.notifyActivity(WATCHER_MODE_MANUAL, now);
        }

        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            const flushNow = Date.now();
            this._lastHeartbeatMs = flushNow;
            this.notifyActivity(WATCHER_MODE_MANUAL, flushNow);
        }, MS_PER_SECOND);
    }

    /** 处理外部信号（文件系统写入或 Git 变更，经 1000ms 窗口防抖节流） */
    private handleExternalSignal(): void {
        if (!this._options.aiDetectionEnabled) {
            return;
        }
        const now = Date.now();
        if (now - this._lastManualActivityMs < MANUAL_SILENCE_WINDOW_MS) {
            return;
        }

        this._lastAiActivityMs = now;
        this._lastActivityMs = now;

        if (this._mode !== WATCHER_MODE_AI) {
            this.setMode(WATCHER_MODE_AI, now);
        }

        if (this._aiDebounceTimer !== null) {
            return;
        }

        if (now - this._lastAiHeartbeatMs >= MS_PER_SECOND) {
            this._lastAiHeartbeatMs = now;
            this.notifyActivity(WATCHER_MODE_AI, now);
        }

        this._aiDebounceTimer = setTimeout(() => {
            this._aiDebounceTimer = null;
            const flushNow = Date.now();
            this._lastAiHeartbeatMs = flushNow;
            this.notifyActivity(WATCHER_MODE_AI, flushNow);
        }, MS_PER_SECOND);
    }

    /** 周期性检测空闲超时与 AI 冷却窗口 */
    private tick(): void {
        const now = Date.now();
        if (this._mode === WATCHER_MODE_MANUAL) {
            this.checkManualIdle(now);
        } else if (this._mode === WATCHER_MODE_AI) {
            this.checkAiCooldown(now);
        }
    }

    /** 检查人工编码是否达到空闲超时 */
    private checkManualIdle(now: number): void {
        if (this._options.idleTimeoutMinutes <= 0) {
            return;
        }
        const idleLimitMs = this._options.idleTimeoutMinutes * MS_PER_MINUTE;
        if (now - this._lastManualActivityMs >= idleLimitMs) {
            const idleStartMs = this._lastManualActivityMs;
            this.setMode(WATCHER_MODE_IDLE, now);
            this._listener?.onIdle(idleStartMs);
        }
    }

    /** 检查 AI 协作冷却窗口 */
    private checkAiCooldown(now: number): void {
        const cooldownMs = this._options.aiCooldownSeconds * MS_PER_SECOND;
        if (now - this._lastAiActivityMs < cooldownMs) {
            this._lastActivityMs = now;
            this.notifyActivity(WATCHER_MODE_AI, now);
        } else {
            const idleStartMs = this._lastActivityMs;
            this.setMode(WATCHER_MODE_IDLE, now);
            this._listener?.onIdle(idleStartMs);
        }
    }

    /** 切换当前模式并触发事件 */
    private setMode(newMode: WatcherMode, timestampMs: number): void {
        if (this._mode === newMode) {
            return;
        }
        const previous = this._mode;
        this._mode = newMode;
        log(LogLevel.Debug, `ActivityWatcher: mode switched from ${previous} to ${newMode}`);
        this._listener?.onModeChange?.(newMode, previous, timestampMs);
    }

    /** 触发活跃心跳通知 */
    private notifyActivity(mode: ActivityMode, timestampMs: number): void {
        this._listener?.onActivity(mode, timestampMs);
    }

    /** 释放所有监听器与计时器 */
    public dispose(): void {
        if (this._debounceTimer !== null) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        if (this._aiDebounceTimer !== null) {
            clearTimeout(this._aiDebounceTimer);
            this._aiDebounceTimer = null;
        }
        if (this._tickInterval !== null) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
        for (const d of this.subscriptions) {
            d.dispose();
        }
        this.subscriptions.length = 0;
        this._listener = null;
        this._isStarted = false;
        log(LogLevel.Info, MSG_WATCHER_DISPOSED);
    }
}
