/**
 * Module: edit-dynamics.test — 文本编辑动力学启发式分类器单测
 * Architecture Role: Integration layer unit test validating keystroke vs AI burst classifications
 */
'use strict';

const assert = require('assert');
const { classifyTextDocumentChange } = require('../../out/integration/edit-dynamics.js');

describe('EditDynamics（文本编辑动力学与突发速率分类）', function () {
    it('空变动返回 empty', function () {
        const res = classifyTextDocumentChange(
            { contentChanges: [], isForeground: true },
            10000,
        );
        assert.strictEqual(res, 'empty');
    });

    it('Undo 和 Redo 保持 undo_redo 分类，不误判为突发', function () {
        const resUndo = classifyTextDocumentChange(
            {
                contentChanges: [{ text: 'const a = 1;', rangeLength: 10 }],
                isForeground: true,
                reason: 1,
            },
            10000,
        );
        assert.strictEqual(resUndo, 'undo_redo');

        const resRedo = classifyTextDocumentChange(
            {
                contentChanges: [{ text: 'const a = 1;', rangeLength: 10 }],
                isForeground: true,
                reason: 2,
            },
            10000,
        );
        assert.strictEqual(resRedo, 'undo_redo');
    });

    it('多处 edits 并发落地（如多光标或结构化 patch）直接判定为 ai_burst', function () {
        const res = classifyTextDocumentChange(
            {
                contentChanges: [
                    { text: 'foo', rangeLength: 0 },
                    { text: 'bar', rangeLength: 0 },
                ],
                isForeground: true,
            },
            10000,
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('后台文档变动直接判定为 ai_burst', function () {
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: 'x', rangeLength: 0 }],
                isForeground: false,
            },
            10000,
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('文档处于非脏态（已保存）时发生重载变动，判定为 ai_burst', function () {
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: 'x', rangeLength: 0 }],
                isForeground: true,
                isDocumentDirty: false,
            },
            10000,
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('前台瞬间大段文本注入（>=30字符）即使无外部先行信号，依然直接判定为 ai_burst', function () {
        const longText = 'function calculateTotal(items: Item[]): number { return 0; }';
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: longText, rangeLength: 0 }],
                isForeground: true,
                isDocumentDirty: true,
            },
            99999, // 距离上次外部信号极远
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('前台多行代码结构注入（换行>=3行）直接判定为 ai_burst', function () {
        const multiline = 'line1\nline2\nline3';
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: multiline, rangeLength: 0 }],
                isForeground: true,
                isDocumentDirty: true,
            },
            99999,
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('前台大段删除/重写（rangeLength >= 30）判定为 ai_burst', function () {
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: '', rangeLength: 45 }],
                isForeground: true,
                isDocumentDirty: true,
            },
            99999,
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('外部写入短窗口内（<1200ms）的非单键打字判定为 ai_burst', function () {
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: 'hello', rangeLength: 0 }],
                isForeground: true,
                isDocumentDirty: true,
            },
            300, // 300ms < 1200ms
        );
        assert.strictEqual(res, 'ai_burst');
    });

    it('真实前台人工单键打字（<=3字符无换行）判定为 manual_keystroke', function () {
        const res = classifyTextDocumentChange(
            {
                contentChanges: [{ text: 'a', rangeLength: 0 }],
                isForeground: true,
                isDocumentDirty: true,
            },
            10000,
        );
        assert.strictEqual(res, 'manual_keystroke');
    });
});
