/**
 * Module: ActivityWatcher — Host Interaction & Agent Activity Watcher
 * File Path: src/integration/ActivityWatcher.ts
 * Architecture Role: Integration layer observer detecting user interactions, external file changes, and Git events
 * Dependencies & Triggers: Consumes vscode editor events and FileWatcherCoordinator; notifies ActivityWatcherListener
 * Responsibilities: Monitor keyboard/editor input, detect AI agent modifications, manage activity modes (manual/ai/idle), and enforce cooldown windows
 * Exit Semantics & Design Rationale: Pure listener and event dispatcher with zero storage or UI side effects; encapsulates subscriptions and releases all listeners cleanly on dispose.
 * Contract Invariant & Boundary: Event debounce invariant: debounced heartbeats clamp high-frequency keyboard/fs bursts to minimum intervals; lifecycle ownership: 100% of VS Code Disposables are registered to subscriptions and cleared on dispose.
 */

import {
    window,
    workspace,
    type Disposable,
    type TextDocumentChangeEvent,
    type Uri,
} from 'vscode';
import {
    type ActivityMode,
    MS_PER_SECOND,
    MS_PER_MINUTE,
    DEFAULT_IDLE_TIMEOUT_MINUTES,
    DEFAULT_AI_COOLDOWN_SECONDS,
    DEFAULT_AI_DETECTION_ENABLED,
    ADAPTIVE_COOLDOWN_STEP_SECONDS,
    MAX_ADAPTIVE_AI_COOLDOWN_SECONDS,
} from '../domain/models';
import { LogLevel, log } from './logger';
import {
    classifyTextDocumentChange,
    CLASSIFY_AI_BURST,
    CLASSIFY_UNDO_REDO,
    CLASSIFY_EMPTY,
} from './edit-dynamics';
import { isPathIgnored, isAgentPulsePath, isAgentSignaturePath } from './agent-signature-catalog';
import {
    createFileWatcherCoordinator,
    type ExternalSignalPayload,
} from './file-watcher-coordinator';

/** 监测器状态枚举（包含工作模式与内部空闲态） */
export type WatcherMode = ActivityMode | 'idle';

/** 模式常量（消除重复字面量） */
const WATCHER_MODE_MANUAL: ActivityMode = 'manual';
const WATCHER_MODE_AI: ActivityMode = 'ai';
const WATCHER_MODE_IDLE: WatcherMode = 'idle';

/** 自适应对数加权最高步阶 */
const MAX_ADAPTIVE_SCALE_STEP = 4;

/** 静态日志文案常量 */
const MSG_WATCHER_STARTED = 'ActivityWatcher: started';
const MSG_WATCHER_DISPOSED = 'ActivityWatcher: disposed';
const MSG_MODE_OVERRIDE_CLEARED = 'ActivityWatcher: mode override cleared, restored to auto sensing';
const MSG_EXTERNAL_AI_TRIGGERED = 'ActivityWatcher: external AI activity triggered';

function normalizeSignalPayload(signal?: Uri | ExternalSignalPayload): ExternalSignalPayload {
    if (signal && typeof signal === 'object' && 'fileCount' in signal) {
        return signal;
    }
    const uri = signal as Uri | undefined;
    return {
        uri,
        fileCount: 1,
        isPulse: uri ? isAgentPulsePath(uri.fsPath) : false,
        isAgentSignature: uri ? isAgentSignaturePath(uri.fsPath) : false,
        isGitSuppressed: false,
        timestampMs: Date.now(),
    };
}

function isAgentBurstPayload(payload: ExternalSignalPayload): boolean {
    return payload.fileCount >= 2 || payload.isAgentSignature || payload.isPulse || Boolean(payload.isBurst);
}

/**
 * 架构契约：活动监听观察者回调端口 (ActivityWatcherListener)
 */
export interface ActivityWatcherListener {
    onActivity(mode: ActivityMode, timestampMs: number): void;
    onIdle(timestampMs: number): void;
    onModeChange?(mode: WatcherMode, previousMode: WatcherMode, timestampMs: number): void;
    onAgentBurst?(burstTimeMs: number, fileCount: number): void;
}

/**
 * 架构契约：活动检测参数配置项 (ActivityWatcherOptions)
 */
export interface ActivityWatcherOptions {
    idleTimeoutMinutes: number;
    aiDetectionEnabled: boolean;
    aiCooldownSeconds: number;
}

export const DEFAULT_ACTIVITY_OPTIONS: Readonly<ActivityWatcherOptions> = {
    idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
    aiDetectionEnabled: DEFAULT_AI_DETECTION_ENABLED,
    aiCooldownSeconds: DEFAULT_AI_COOLDOWN_SECONDS,
};

/**
 * 架构契约：活动监测器 (ActivityWatcher)
 * 职责：监听 VS Code 编辑器操作与 FileWatcherCoordinator 外部信号，判定工作区处于 manual/ai/idle 状态。
 */
export class ActivityWatcher implements Disposable {
    private readonly subscriptions: Disposable[] = [];
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
    private _modeOverride: ActivityMode | null = null;
    private _lastExternalSignalMs: number = 0;
    private _fileCoordinator: Disposable | null = null;
    private _currentAiCooldownSeconds: number = 0;
    private _lastPulseMs: number = 0;
    private _lastBatchFileCount: number = 0;

    constructor(
        options?: Partial<ActivityWatcherOptions>,
        listener?: ActivityWatcherListener,
    ) {
        this._options = {
            ...DEFAULT_ACTIVITY_OPTIONS,
            ...(options ?? {}),
        };
        this._currentAiCooldownSeconds = this._options.aiCooldownSeconds;
        if (listener) {
            this._listener = listener;
        }
    }

    public setListener(listener: ActivityWatcherListener): void {
        this._listener = listener;
    }

    public getCurrentMode(): WatcherMode {
        return this._mode;
    }

    public getLastActivityMs(): number {
        return this._lastActivityMs;
    }

    public setModeOverride(mode: ActivityMode | null): void {
        this._modeOverride = mode;
        const now = Date.now();
        if (mode !== null) {
            this._lastActivityMs = now;
            if (mode === WATCHER_MODE_AI) {
                this._lastAiActivityMs = now;
            } else {
                this._lastManualActivityMs = now;
            }
            this.setMode(mode, now);
            this.notifyActivity(mode, now);
            log(LogLevel.Info, `ActivityWatcher: mode override set to ${mode}`);
        } else {
            log(LogLevel.Info, MSG_MODE_OVERRIDE_CLEARED);
        }
    }

    public getModeOverride(): ActivityMode | null {
        return this._modeOverride;
    }

    public toggleModeOverride(): ActivityMode | null {
        if (this._modeOverride === null) {
            this.setModeOverride(WATCHER_MODE_AI);
        } else if (this._modeOverride === WATCHER_MODE_AI) {
            this.setModeOverride(WATCHER_MODE_MANUAL);
        } else {
            this.setModeOverride(null);
        }
        return this._modeOverride;
    }

    /** 激活 AI 状态时间戳与模式（消除重复判断） */
    private activateAiState(now: number): boolean {
        if (!this._options.aiDetectionEnabled || this._modeOverride === WATCHER_MODE_MANUAL) {
            return false;
        }
        this._lastAiActivityMs = now;
        this._lastExternalSignalMs = now;
        this._lastActivityMs = now;
        if (this._mode !== WATCHER_MODE_AI) {
            this.setMode(WATCHER_MODE_AI, now);
        }
        return true;
    }

    public triggerAiActivity(_source?: string): void {
        const now = Date.now();
        if (!this.activateAiState(now)) {
            return;
        }
        log(LogLevel.Debug, MSG_EXTERNAL_AI_TRIGGERED);
        this.notifyActivity(WATCHER_MODE_AI, now);
        this._listener?.onAgentBurst?.(now, 1);
    }

    public updateConfig(options: Partial<ActivityWatcherOptions>): void {
        this._options = {
            ...this._options,
            ...options,
        };
        if (options.aiCooldownSeconds !== undefined) {
            this._currentAiCooldownSeconds = options.aiCooldownSeconds;
        }
        log(LogLevel.Debug, `ActivityWatcher: config updated (idleTimeout=${this._options.idleTimeoutMinutes}m, aiEnabled=${this._options.aiDetectionEnabled}, cooldown=${this._options.aiCooldownSeconds}s)`);
    }

    public start(): void {
        if (this._isStarted) {
            return;
        }
        this._isStarted = true;

        this.initEditorListeners();

        this._fileCoordinator = createFileWatcherCoordinator(signal => {
            this.handleExternalSignal(signal);
        });
        this.subscriptions.push(this._fileCoordinator);

        this._tickInterval = setInterval(() => {
            this.tick();
        }, MS_PER_SECOND);

        log(LogLevel.Info, MSG_WATCHER_STARTED);
    }

    private initEditorListeners(): void {
        this.subscriptions.push(
            workspace.onDidChangeTextDocument(event => this.handleDocumentChange(event)),
        );
        this.subscriptions.push(
            window.onDidChangeTextEditorSelection(() => this.handlePassiveInteraction()),
        );
        this.subscriptions.push(
            window.onDidChangeTextEditorVisibleRanges(() => this.handlePassiveInteraction()),
        );
        this.subscriptions.push(
            window.onDidChangeWindowState(windowState => {
                if (windowState.focused) this.handlePassiveInteraction();
            }),
        );
    }

    private handleDocumentChange(changeEvent: TextDocumentChangeEvent): void {
        if (changeEvent.contentChanges.length === 0) return;
        if (changeEvent.document.uri.scheme !== 'file' && changeEvent.document.uri.scheme !== 'untitled') return;
        if (isPathIgnored(changeEvent.document.uri.fsPath)) return;

        const activeDoc = window.activeTextEditor?.document;
        const isForeground = activeDoc !== undefined && activeDoc.uri.toString() === changeEvent.document.uri.toString();
        const now = Date.now();
        const gapMs = now - this._lastExternalSignalMs;

        const classification = classifyTextDocumentChange(
            {
                contentChanges: changeEvent.contentChanges,
                isDocumentDirty: changeEvent.document.isDirty,
                isForeground,
                reason: changeEvent.reason,
            },
            gapMs,
        );

        if (classification === CLASSIFY_AI_BURST) {
            this.handleExternalSignal({
                uri: changeEvent.document.uri,
                fileCount: 1,
                isPulse: isAgentPulsePath(changeEvent.document.uri.fsPath),
                isAgentSignature: isAgentSignaturePath(changeEvent.document.uri.fsPath),
                isGitSuppressed: false,
                isBurst: true,
                timestampMs: now,
            });
            return;
        }
        if (classification === CLASSIFY_UNDO_REDO || classification === CLASSIFY_EMPTY) {
            return;
        }
        this.recordManualActivity(now);
    }

    private handlePassiveInteraction(timestampMs: number = Date.now()): void {
        const now = timestampMs;
        const cooldownMs = this._options.aiCooldownSeconds * MS_PER_SECOND;

        if (this._mode === WATCHER_MODE_AI && (now - this._lastAiActivityMs < cooldownMs)) {
            this._lastActivityMs = now;
            return;
        }
        if (this._modeOverride === WATCHER_MODE_AI) {
            this._lastActivityMs = now;
            return;
        }
        this.recordManualActivity(now);
    }

    private recordManualActivity(timestampMs: number = Date.now()): void {
        if (this._modeOverride === WATCHER_MODE_AI) {
            this._lastActivityMs = timestampMs;
            return;
        }

        const now = timestampMs;
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

    public handleExternalSignal(signal?: Uri | ExternalSignalPayload): void {
        const payload = normalizeSignalPayload(signal);
        if (payload.isGitSuppressed) {
            log(LogLevel.Debug, `ActivityWatcher: bulk write suppressed by active Git transaction (${payload.fileCount} files)`);
            return;
        }

        const now = payload.timestampMs || Date.now();
        if (!this.activateAiState(now)) {
            return;
        }

        this._lastBatchFileCount = payload.fileCount;
        if (payload.isPulse) {
            this._lastPulseMs = now;
        }
        if (payload.fileCount > 1) {
            this.applyAdaptiveCooldown(payload.fileCount);
        }

        if (isAgentBurstPayload(payload)) {
            this._listener?.onAgentBurst?.(now, payload.fileCount);
        }

        this.scheduleAiHeartbeat(now);
    }

    private scheduleAiHeartbeat(now: number): void {
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

    /**
     * 自适应动态冷却时间计算：
     * 基础冷却窗口 (默认 120s) 叠加规模对数加权，最大钳制到 300s (5 分钟)。
     */
    public applyAdaptiveCooldown(fileCount: number): number {
        const baseSeconds = this._options.aiCooldownSeconds;
        const scaleStep = Math.min(MAX_ADAPTIVE_SCALE_STEP, Math.floor(Math.log2(Math.max(1, fileCount))));
        const bonusSeconds = scaleStep * ADAPTIVE_COOLDOWN_STEP_SECONDS;
        const totalSeconds = Math.min(
            MAX_ADAPTIVE_AI_COOLDOWN_SECONDS,
            Math.max(baseSeconds, baseSeconds + bonusSeconds),
        );
        this._currentAiCooldownSeconds = totalSeconds;
        log(LogLevel.Debug, `ActivityWatcher: adaptive cooldown applied (${fileCount} files -> ${totalSeconds}s)`);
        return totalSeconds;
    }

    public getCurrentAiCooldownSeconds(): number {
        return this._currentAiCooldownSeconds || this._options.aiCooldownSeconds;
    }

    public getLastPulseMs(): number {
        return this._lastPulseMs;
    }

    public getLastBatchFileCount(): number {
        return this._lastBatchFileCount;
    }

    private tick(): void {
        const now = Date.now();
        if (this._modeOverride !== null) {
            this._lastActivityMs = now;
            this.notifyActivity(this._modeOverride, now);
            return;
        }

        if (this._mode === WATCHER_MODE_MANUAL) {
            this.checkManualIdle(now);
        } else if (this._mode === WATCHER_MODE_AI) {
            this.checkAiCooldown(now);
        }
    }

    private checkManualIdle(now: number): void {
        if (this._options.idleTimeoutMinutes <= 0) return;
        const idleLimitMs = this._options.idleTimeoutMinutes * MS_PER_MINUTE;
        if (now - this._lastManualActivityMs >= idleLimitMs) {
            const idleStartMs = this._lastManualActivityMs;
            this.setMode(WATCHER_MODE_IDLE, now);
            this._listener?.onIdle(idleStartMs);
        }
    }

    private checkAiCooldown(now: number): void {
        const cooldownSeconds = this._currentAiCooldownSeconds || this._options.aiCooldownSeconds;
        const cooldownMs = cooldownSeconds * MS_PER_SECOND;
        const isPulseActive = (now - this._lastPulseMs) < MS_PER_MINUTE;

        if ((now - this._lastAiActivityMs < cooldownMs) || isPulseActive) {
            this._lastActivityMs = now;
            this.notifyActivity(WATCHER_MODE_AI, now);
        } else {
            const idleStartMs = this._lastActivityMs;
            this._currentAiCooldownSeconds = this._options.aiCooldownSeconds;
            this.setMode(WATCHER_MODE_IDLE, now);
            this._listener?.onIdle(idleStartMs);
        }
    }

    private setMode(newMode: WatcherMode, timestampMs: number): void {
        if (this._mode === newMode) return;
        const previous = this._mode;
        this._mode = newMode;
        log(LogLevel.Debug, `ActivityWatcher: mode switched from ${previous} to ${newMode}`);
        this._listener?.onModeChange?.(newMode, previous, timestampMs);
    }

    private notifyActivity(mode: ActivityMode, timestampMs: number): void {
        this._listener?.onActivity(mode, timestampMs);
    }

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
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions.length = 0;
        this._listener = null;
        this._isStarted = false;
        log(LogLevel.Info, MSG_WATCHER_DISPOSED);
    }
}
