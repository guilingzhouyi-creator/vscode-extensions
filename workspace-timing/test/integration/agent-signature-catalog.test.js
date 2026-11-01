/**
 * Module: agent-signature-catalog.test — 全生态 Agent 伴生特征图谱单测
 * Architecture Role: Integration layer unit test validating agent signatures and ignore heuristics
 */
'use strict';

const assert = require('assert');
const {
    isAgentSignaturePath,
    isPathIgnored,
} = require('../../out/integration/agent-signature-catalog.js');

describe('AgentSignatureCatalog（全生态 Agent 伴生特征与路径判定）', function () {
    it('正确识别 Google Antigravity / Gemini 专属特征路径', function () {
        assert.ok(isAgentSignaturePath('C:\\workspace\\.agents\\skills\\SKILL.md'));
        assert.ok(isAgentSignaturePath('C:\\Users\\user\\.gemini\\antigravity\\brain\\123\\transcript.jsonl'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\scratch\\test-runner.js'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.refactor-trajectory\\checkpoint.json'));
    });

    it('正确识别 Claude Code、Cursor、Cline、Aider 特征文件', function () {
        assert.ok(isAgentSignaturePath('C:\\workspace\\CLAUDE.md'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.cursor\\rules\\project.mdc'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.cursorrules'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.clinerules'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.roomodes'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.aider.chat.history.md'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\.github\\copilot-instructions.md'));
        assert.ok(isAgentSignaturePath('C:\\workspace\\fix-bug.patch'));
    });

    it('常规 build 产物与 node_modules 正确被忽略', function () {
        assert.ok(isPathIgnored('C:\\workspace\\node_modules\\lodash\\index.js'));
        assert.ok(isPathIgnored('C:\\workspace\\dist\\bundle.js'));
        assert.ok(isPathIgnored('C:\\workspace\\out\\app.js'));
        assert.ok(isPathIgnored('C:\\workspace\\coverage\\lcov.info'));
    });

    it('Agent 特征路径优先放行：即使路径名包含类似 build 的结构也不被忽略', function () {
        assert.strictEqual(
            isPathIgnored('C:\\workspace\\.agents\\subagents\\build-runner.json'),
            false,
            'Agent 目录下的文件绝不应被忽略',
        );
    });

    it('空路径安全返回 false', function () {
        assert.strictEqual(isAgentSignaturePath(''), false);
        assert.strictEqual(isPathIgnored(''), false);
    });
});
