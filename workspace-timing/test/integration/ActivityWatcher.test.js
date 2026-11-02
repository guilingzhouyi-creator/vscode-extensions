/**
 * Module: ActivityWatcher.test — 活动感知器与 AI 协作双轨智能感知单测
 * Architecture Role: Integration layer test suite verifying concurrent AI sensing, review tolerance, and mode override
 */
'use strict';

const assert = require('assert');
const Module = require('module');

// 注入轻量 mock vscode 模块支持纯 Node 脱机快速测试
const mockEmitters = {
    docChange: [],
    docSave: [],
    filesCreate: [],
    filesDelete: [],
    filesRename: [],
    selectionChange: [],
    visibleRangesChange: [],
    windowStateChange: [],
    fsChange: [],
    fsCreate: [],
    fsDelete: [],
};

let activeEditorDoc = {
    uri: {
        scheme: 'file',
        fsPath: 'C:\\workspace\\active.ts',
        toString: () => 'file:///workspace/active.ts',
    },
};

const mockVscode = {
    workspace: {
        onDidChangeTextDocument(fn) {
            mockEmitters.docChange.push(fn);
            return { dispose: () => {} };
        },
        onDidSaveTextDocument(fn) {
            mockEmitters.docSave.push(fn);
            return { dispose: () => {} };
        },
        onDidCreateFiles(fn) {
            mockEmitters.filesCreate.push(fn);
            return { dispose: () => {} };
        },
        onDidDeleteFiles(fn) {
            mockEmitters.filesDelete.push(fn);
            return { dispose: () => {} };
        },
        onDidRenameFiles(fn) {
            mockEmitters.filesRename.push(fn);
            return { dispose: () => {} };
        },
        createFileSystemWatcher() {
            return {
                onDidChange(fn) { mockEmitters.fsChange.push(fn); return { dispose: () => {} }; },
                onDidCreate(fn) { mockEmitters.fsCreate.push(fn); return { dispose: () => {} }; },
                onDidDelete(fn) { mockEmitters.fsDelete.push(fn); return { dispose: () => {} }; },
                dispose: () => {},
            };
        },
    },
    window: {
        get activeTextEditor() {
            return activeEditorDoc ? { document: activeEditorDoc } : undefined;
        },
        onDidChangeTextEditorSelection(fn) {
            mockEmitters.selectionChange.push(fn);
            return { dispose: () => {} };
        },
        onDidChangeTextEditorVisibleRanges(fn) {
            mockEmitters.visibleRangesChange.push(fn);
            return { dispose: () => {} };
        },
        onDidChangeWindowState(fn) {
            mockEmitters.windowStateChange.push(fn);
            return { dispose: () => {} };
        },
    },
    extensions: {
        getExtension() {
            return undefined;
        },
    },
    Uri: {
        file(p) {
            return { scheme: 'file', fsPath: p, toString: () => 'file:///' + p.replace(/\\/g, '/') };
        },
    },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') {
        return mockVscode;
    }
    return origLoad.apply(this, arguments);
};

const { ActivityWatcher } = require('../../out/integration/ActivityWatcher.js');

describe('ActivityWatcher（AI 自主协作与双轨工时智能感知）', function () {
    let watcher;
    const activities = [];
    const modeChanges = [];

    beforeEach(function () {
        activities.length = 0;
        modeChanges.length = 0;
        mockEmitters.docChange.length = 0;
        mockEmitters.docSave.length = 0;
        mockEmitters.filesCreate.length = 0;
        mockEmitters.filesDelete.length = 0;
        mockEmitters.filesRename.length = 0;
        mockEmitters.selectionChange.length = 0;
        mockEmitters.visibleRangesChange.length = 0;
        mockEmitters.windowStateChange.length = 0;
        mockEmitters.fsChange.length = 0;
        mockEmitters.fsCreate.length = 0;
        mockEmitters.fsDelete.length = 0;

        activeEditorDoc = {
            uri: {
                scheme: 'file',
                fsPath: 'C:\\workspace\\active.ts',
                toString: () => 'file:///workspace/active.ts',
            },
        };

        watcher = new ActivityWatcher(
            {
                idleTimeoutMinutes: 5,
                aiDetectionEnabled: true,
                aiCooldownSeconds: 10,
            },
            {
                onActivity: (mode, ts) => activities.push({ mode, ts }),
                onIdle: (ts) => activities.push({ mode: 'idle', ts }),
                onModeChange: (mode, prev, ts) => modeChanges.push({ mode, prev, ts }),
            }
        );
        watcher.start();
    });

    afterEach(function () {
        if (watcher) {
            watcher.dispose();
        }
    });

    it('初始状态为 manual 模式', function () {
        assert.strictEqual(watcher.getCurrentMode(), 'manual');
    });

    it('后台文件变动：非当前激活文档自动判定为外部 Agent/工具写入，顺利切入 AI 模式', function () {
        const backgroundDocEvent = {
            document: {
                uri: {
                    scheme: 'file',
                    fsPath: 'C:\\workspace\\src\\background-service.ts',
                    toString: () => 'file:///workspace/src/background-service.ts',
                },
            },
            contentChanges: [{ text: 'export const X = 1;' }],
        };

        // 触发文档变动
        mockEmitters.docChange.forEach(fn => fn(backgroundDocEvent));

        assert.strictEqual(watcher.getCurrentMode(), 'ai', '后台文档变动必须触发 AI 模式');
        assert.ok(activities.some(a => a.mode === 'ai'), '派发了 AI 活动心跳');
    });

    it('人机协同破除死锁：即便刚刚发生过人工交互，外部文件变动依然能激活 AI 模式', function () {
        // 1. 用户在前台活动文档打字
        const foregroundDocEvent = {
            document: activeEditorDoc,
            contentChanges: [{ text: 'a' }],
        };
        mockEmitters.docChange.forEach(fn => fn(foregroundDocEvent));
        assert.strictEqual(watcher.getCurrentMode(), 'manual');

        // 2. 紧接着 200ms 后外部 Agent 修改了文件系统
        const fileUri = {
            scheme: 'file',
            fsPath: 'C:\\workspace\\auto-refactor\\output.ts',
            toString: () => 'file:///workspace/auto-refactor/output.ts',
        };
        mockEmitters.fsChange.forEach(fn => fn(fileUri));

        assert.strictEqual(watcher.getCurrentMode(), 'ai', '外部写入必须成功切入 AI 协作模式，不再受 2 秒死锁阻断');
    });

    it('代码审阅宽容度：在 AI 冷却期内，移动光标和滚动代码不打断 AI 模式', function () {
        // 先触发一次 AI 写入
        const fileUri = {
            scheme: 'file',
            fsPath: 'C:\\workspace\\src\\feature.ts',
            toString: () => 'file:///workspace/src/feature.ts',
        };
        mockEmitters.fsChange.forEach(fn => fn(fileUri));
        assert.strictEqual(watcher.getCurrentMode(), 'ai');

        // 用户在编辑器中移动光标审阅代码
        mockEmitters.selectionChange.forEach(fn => fn());
        mockEmitters.visibleRangesChange.forEach(fn => fn());

        assert.strictEqual(watcher.getCurrentMode(), 'ai', '代码审阅操作不应打断 AI 协作模式');
    });

    it('前台主动键盘输入平滑切回人工模式', function () {
        // 先处于 AI 模式
        watcher.triggerAiActivity('test');
        assert.strictEqual(watcher.getCurrentMode(), 'ai');

        // 用户在前台活动文档键入按键
        const foregroundDocEvent = {
            document: activeEditorDoc,
            contentChanges: [{ text: 'x' }],
        };
        mockEmitters.docChange.forEach(fn => fn(foregroundDocEvent));

        assert.strictEqual(watcher.getCurrentMode(), 'manual', '前台键盘输入平滑切回 manual 模式');
    });

    it('支持手动模式覆盖：强制锁定 AI、锁定人工与恢复自动', function () {
        // 强制锁定为 AI
        watcher.setModeOverride('ai');
        assert.strictEqual(watcher.getCurrentMode(), 'ai');
        assert.strictEqual(watcher.getModeOverride(), 'ai');

        // 此时前台打字不会切回 manual
        const foregroundDocEvent = {
            document: activeEditorDoc,
            contentChanges: [{ text: 'hello' }],
        };
        mockEmitters.docChange.forEach(fn => fn(foregroundDocEvent));
        assert.strictEqual(watcher.getCurrentMode(), 'ai');

        // 轮转切换为 manual
        watcher.toggleModeOverride();
        assert.strictEqual(watcher.getCurrentMode(), 'manual');
        assert.strictEqual(watcher.getModeOverride(), 'manual');

        // 轮转恢复自动感知
        watcher.toggleModeOverride();
        assert.strictEqual(watcher.getModeOverride(), null);
    });

    it('Agent 特征路径 (.gemini / .agents) 绝不被错误忽略', function () {
        const geminiUri = {
            scheme: 'file',
            fsPath: 'C:\\workspace\\.gemini\\antigravity\\tasks.log',
            toString: () => 'file:///workspace/.gemini/antigravity/tasks.log',
        };
        mockEmitters.fsChange.forEach(fn => fn(geminiUri));
        assert.strictEqual(watcher.getCurrentMode(), 'ai', '.gemini 目录文件变动被识别为 AI 活动');
    });

    it('前台瞬间大段文本注入（>=30字符）无需外部信号先验，直接判定为 AI 模式', function () {
        const foregroundDocEvent = {
            document: {
                ...activeEditorDoc,
                isDirty: true,
            },
            contentChanges: [
                {
                    text: 'export function processBatchQueue(items: string[]): void {\n    console.log(items);\n}',
                    rangeLength: 0,
                },
            ],
        };
        mockEmitters.docChange.forEach(fn => fn(foregroundDocEvent));
        assert.strictEqual(watcher.getCurrentMode(), 'ai', '前台突发大文本注入必须切入 AI 模式');
    });

    it('VS Code 显式文件创建事务 (onDidCreateFiles) 自动激活 AI 协作模式', function () {
        const newFileUri = {
            scheme: 'file',
            fsPath: 'C:\\workspace\\src\\new-module.ts',
            toString: () => 'file:///workspace/src/new-module.ts',
        };
        mockEmitters.filesCreate.forEach(fn => fn({ files: [newFileUri] }));
        assert.strictEqual(watcher.getCurrentMode(), 'ai', '显式文件创建必须激活 AI 模式');
    });

    it('保存 Agent 专属特征文件 (CLAUDE.md) 自动激活 AI 协作模式', function () {
        const claudeDoc = {
            uri: {
                scheme: 'file',
                fsPath: 'C:\\workspace\\CLAUDE.md',
                toString: () => 'file:///workspace/CLAUDE.md',
            },
        };
        mockEmitters.docSave.forEach(fn => fn(claudeDoc));
        assert.strictEqual(watcher.getCurrentMode(), 'ai', '保存 CLAUDE.md 必须激活 AI 模式');
    });

    it('大规模写入自适应动态冷却：修改多文件触发自适应扩展（16 文件 -> 240s）', function () {
        assert.strictEqual(watcher.getCurrentMode(), 'manual');

        // 模拟批量写入 16 个代码文件载荷
        watcher.handleExternalSignal({
            uri: { scheme: 'file', fsPath: 'C:\\workspace\\src\\f1.ts' },
            fileCount: 16,
            isPulse: false,
            isAgentSignature: false,
            isGitSuppressed: false,
            timestampMs: Date.now(),
        });

        assert.strictEqual(watcher.getCurrentMode(), 'ai');
        assert.strictEqual(watcher.getLastBatchFileCount(), 16);
        // 基础 10s + 4*30s = 130s
        assert.strictEqual(watcher.getCurrentAiCooldownSeconds(), 130);
    });

    it('Git 事务屏蔽防护：在 Git 分支切换窗口期，外部常规代码批量写入被拦截，不误触发 AI 模式', function () {
        assert.strictEqual(watcher.getCurrentMode(), 'manual');

        // 模拟外部普通代码改动但在 Git 抑制期内
        watcher.handleExternalSignal({
            uri: { scheme: 'file', fsPath: 'C:\\workspace\\src\\checkout-file.ts' },
            fileCount: 50,
            isPulse: false,
            isAgentSignature: false,
            isGitSuppressed: true,
            timestampMs: Date.now(),
        });

        assert.strictEqual(watcher.getCurrentMode(), 'manual', 'Git 抑制期内的普通代码改动严禁误切 AI 模式');
    });

    it('Git 事务例外放行：即便在 Git 抑制期，Agent 专属脉搏文件依然放行并切入 AI 模式', function () {
        assert.strictEqual(watcher.getCurrentMode(), 'manual');

        watcher.handleExternalSignal({
            uri: { scheme: 'file', fsPath: 'C:\\workspace\\.system_generated\\logs\\transcript.jsonl' },
            fileCount: 1,
            isPulse: true,
            isAgentSignature: true,
            isGitSuppressed: false,
            timestampMs: Date.now(),
        });

        assert.strictEqual(watcher.getCurrentMode(), 'ai', 'Agent 伴生脉搏文件即便在 Git 活跃期也必须放行');
        assert.ok(watcher.getLastPulseMs() > 0, '记录了最新的脉搏时间戳');
    });

    it('Agent 突发感知与广播：多文件批量信号、Agent 脉搏或显式 AI 突发触发 onAgentBurst 闭环', function () {
        const bursts = [];
        watcher.setListener({
            onActivity: () => {},
            onIdle: () => {},
            onAgentBurst: (ts, count) => bursts.push({ ts, count }),
        });

        // 1. 单个普通文件（非脉搏、非批次、非签名）不触发 AgentBurst
        watcher.handleExternalSignal({
            uri: { scheme: 'file', fsPath: 'C:\\workspace\\src\\normal.ts' },
            fileCount: 1,
            isPulse: false,
            isAgentSignature: false,
            isGitSuppressed: false,
            timestampMs: Date.now(),
        });
        assert.strictEqual(bursts.length, 0, '普通单文件变更不误判为 Agent 突发');

        // 2. 批量多文件写入（例如 3 个文件）触发 AgentBurst
        watcher.handleExternalSignal({
            uri: { scheme: 'file', fsPath: 'C:\\workspace\\src\\batch1.ts' },
            fileCount: 3,
            isPulse: false,
            isAgentSignature: false,
            isGitSuppressed: false,
            timestampMs: Date.now(),
        });
        assert.strictEqual(bursts.length, 1);
        assert.strictEqual(bursts[0].count, 3);

        // 3. 伴生脉搏文件（即使 1 个文件）触发 AgentBurst
        watcher.handleExternalSignal({
            uri: { scheme: 'file', fsPath: 'C:\\workspace\\.system_generated\\logs\\transcript.jsonl' },
            fileCount: 1,
            isPulse: true,
            isAgentSignature: true,
            isGitSuppressed: false,
            timestampMs: Date.now(),
        });
        assert.strictEqual(bursts.length, 2);

        // 4. 显式命令 triggerAiActivity 触发 AgentBurst
        watcher.triggerAiActivity('command');
        assert.strictEqual(bursts.length, 3);
    });
});
