/**
 * Module: FileWatcherCoordinator — File System, Transaction & Git Host Listener Coordinator
 * File Path: src/integration/file-watcher-coordinator.ts
 * Architecture Role: Integration layer coordinator aggregating filesystem, explicit transaction, and Git repository events
 * Dependencies & Triggers: Consumed by ActivityWatcher during lifecycle start/dispose
 * Responsibilities: Setup workspace file system watcher, listen to save/create/delete/rename events, bind VS Code Git API
 * Exit Semantics & Design Rationale: Encapsulates all external host event subscriptions and releases Disposables cleanly
 * Contract Invariant & Boundary: Single unidirectional event dispatch to onExternalSignal; zero UI/storage side effects
 */

import {
    workspace,
    extensions,
    type Event,
    type Disposable,
    type Uri,
} from 'vscode';
import {
    isPathIgnored,
    isAgentSignaturePath,
    isAgentPulsePath,
} from './agent-signature-catalog';
import {
    DEFAULT_BATCH_HARVEST_WINDOW_MS,
    DEFAULT_GIT_SUPPRESSION_WINDOW_MS,
} from '../domain/models';
import { LogLevel, log } from './logger';

/** VS Code 内置 Git 扩展结构声明 */
interface GitExtensionApi {
    repositories?: ReadonlyArray<{
        state?: {
            onDidChange?: Event<void>;
        };
    }>;
    onDidOpenRepository?: Event<{
        state?: {
            onDidChange?: Event<void>;
        };
    }>;
}

interface GitExtension {
    getAPI?(version: number): GitExtensionApi;
}

const MSG_GIT_ACTIVATION_SKIPPED = 'FileWatcherCoordinator: git activation skipped';
const MSG_GIT_BIND_FAILED = 'FileWatcherCoordinator: failed to bind git extension';
const MSG_GIT_READ_API_FAILED = 'FileWatcherCoordinator: failed to read git api';
const MSG_REPO_BIND_FAILED = 'FileWatcherCoordinator: failed to bind repo';

/** 外部文件系统变动批量信号载荷 */
export interface ExternalSignalPayload {
    /** 代表性文件 URI（单文件事件或批处理触发文件） */
    readonly uri?: Uri;
    /** 滑动窗口内聚合变动的项目文件总数 */
    readonly fileCount: number;
    /** 是否包含 Agent 伴生实时脉搏流（transcript/scratch 等） */
    readonly isPulse: boolean;
    /** 是否包含已知 Agent 签名或规则目录 */
    readonly isAgentSignature: boolean;
    /** 是否正处于 Git 版本控制事务屏蔽窗口内（分支切换/合并） */
    readonly isGitSuppressed: boolean;
    /** 是否为显式单文件大块编辑或强制突发信号 */
    readonly isBurst?: boolean;
    /** 信号产生时间戳 (ms) */
    readonly timestampMs: number;
}

export type ExternalSignalCallback = (signal: ExternalSignalPayload) => void;

/**
 * 架构契约：文件系统与 Git 监视协调器 (FileWatcherCoordinator)
 * 职责：统一管理底层文件系统事件、VS Code 显式事务与 Git 状态变更，通过滑动微批聚合消除事件风暴，将载荷回传给 ActivityWatcher。
 */
export class FileWatcherCoordinator implements Disposable {
    private readonly subscriptions: Disposable[] = [];
    private _lastGitOperationMs: number = 0;
    private readonly _batchFilePaths: Set<string> = new Set();
    private _batchTimer: ReturnType<typeof setTimeout> | null = null;
    private _hasPulseInBatch: boolean = false;
    private _hasSignatureInBatch: boolean = false;
    private _representativeUri?: Uri;

    constructor(private readonly onSignal: ExternalSignalCallback) {}

    /** 启动所有文件系统、显式事务与 Git 监听 */
    public start(): void {
        this.initFileSystemWatcher();
        this.initExplicitTransactions();
        this.initGitWatcher();
    }

    private handleUri(uri: Uri): void {
        if (isPathIgnored(uri.fsPath)) {
            return;
        }

        const isPulse = isAgentPulsePath(uri.fsPath);
        const isSignature = isAgentSignaturePath(uri.fsPath);
        const isGitSuppressed = !isSignature &&
            (Date.now() - this._lastGitOperationMs < DEFAULT_GIT_SUPPRESSION_WINDOW_MS);

        this._batchFilePaths.add(uri.fsPath);
        if (isPulse) this._hasPulseInBatch = true;
        if (isSignature) this._hasSignatureInBatch = true;
        if (!this._representativeUri) this._representativeUri = uri;

        const currentCount = this._batchFilePaths.size;

        this.onSignal({
            uri,
            fileCount: currentCount,
            isPulse: this._hasPulseInBatch,
            isAgentSignature: this._hasSignatureInBatch,
            isGitSuppressed,
            timestampMs: Date.now(),
        });

        if (this._batchTimer !== null) {
            clearTimeout(this._batchTimer);
        }
        this._batchTimer = setTimeout(() => {
            this.closeBatch();
        }, DEFAULT_BATCH_HARVEST_WINDOW_MS);
    }

    private closeBatch(): void {
        if (this._batchTimer !== null) {
            clearTimeout(this._batchTimer);
            this._batchTimer = null;
        }
        this._batchFilePaths.clear();
        this._hasPulseInBatch = false;
        this._hasSignatureInBatch = false;
        this._representativeUri = undefined;
    }

    /** 模拟或记录 Git 版本控制操作（供单测与内部状态机调用） */
    public recordGitOperation(timestampMs: number = Date.now()): void {
        this._lastGitOperationMs = timestampMs;
    }

    public getLastGitOperationMs(): number {
        return this._lastGitOperationMs;
    }

    private initFileSystemWatcher(): void {
        const watcher = workspace.createFileSystemWatcher('**/*');
        const listener = (uri: Uri): void => this.handleUri(uri);

        this.subscriptions.push(watcher.onDidChange(listener));
        this.subscriptions.push(watcher.onDidCreate(listener));
        this.subscriptions.push(watcher.onDidDelete(listener));
        this.subscriptions.push(watcher);
    }

    private initExplicitTransactions(): void {
        if (workspace.onDidSaveTextDocument) {
            this.subscriptions.push(
                workspace.onDidSaveTextDocument(doc => {
                    if (doc.uri.scheme === 'file' && !isPathIgnored(doc.uri.fsPath) && isAgentSignaturePath(doc.uri.fsPath)) {
                        this.handleUri(doc.uri);
                    }
                }),
            );
        }

        const bindBatch = <T>(
            event: Event<T> | undefined,
            extract: (e: T) => readonly Uri[],
        ): void => {
            if (!event) return;
            this.subscriptions.push(
                event(e => {
                    const target = extract(e).find(u => !isPathIgnored(u.fsPath));
                    if (target) {
                        this.handleUri(target);
                    }
                }),
            );
        };

        bindBatch(workspace.onDidCreateFiles, e => e.files);
        bindBatch(workspace.onDidDeleteFiles, e => e.files);
        bindBatch(workspace.onDidRenameFiles, e => e.files.map(item => item.newUri));
    }

    private initGitWatcher(): void {
        try {
            const gitExt = extensions.getExtension<GitExtension>('vscode.git');
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

    private bindRepo(repo: { state?: { onDidChange?: Event<void> } }): void {
        try {
            if (repo?.state?.onDidChange) {
                this.subscriptions.push(
                    repo.state.onDidChange(() => {
                        this.recordGitOperation(Date.now());
                        log(LogLevel.Debug, 'FileWatcherCoordinator: git repository state changed, active suppression window');
                    }),
                );
            }
        } catch (err) {
            log(LogLevel.Debug, MSG_REPO_BIND_FAILED, err as Error);
        }
    }

    public dispose(): void {
        this.closeBatch();
        for (const d of this.subscriptions) {
            d.dispose();
        }
        this.subscriptions.length = 0;
    }
}

/** 工厂函数创建并返回协调器 Disposable */
export function createFileWatcherCoordinator(
    onSignal: ExternalSignalCallback,
): FileWatcherCoordinator {
    const coordinator = new FileWatcherCoordinator(onSignal);
    coordinator.start();
    return coordinator;
}
