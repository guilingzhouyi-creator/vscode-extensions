/**
 * ThinkingAccordionLock 状态机单元测试套件
 * 运行环境：Node.js Mocha，验证分析进行中强制锁定展开、交还控制权与 Markdown 引用导出
 */
'use strict';

const assert = require('assert');
const { ThinkingAccordionLock } = require('../../out/presentation/thinking-accordion-lock.js');

describe('ThinkingAccordionLock（分析过程手风琴折叠互斥状态机）', () => {
    it('常规初始化态：未处于分析中时允许自由展开与折叠', () => {
        const lock = new ThinkingAccordionLock({
            title: '测试手风琴',
            initiallyExpanded: false,
        });

        assert.strictEqual(lock.isAnalyzing, false);
        assert.strictEqual(lock.isLocked, false);
        assert.strictEqual(lock.isExpanded, false);

        // 自由展开
        const toggleRes1 = lock.toggle();
        assert.strictEqual(toggleRes1, true);
        assert.strictEqual(lock.isExpanded, true);

        // 自由折叠
        const toggleRes2 = lock.toggle();
        assert.strictEqual(toggleRes2, true);
        assert.strictEqual(lock.isExpanded, false);
    });

    it('分析进行中（isAnalyzing=true）强制锁定展开，拦截一切折叠操作', () => {
        const lock = new ThinkingAccordionLock({
            title: '工作区长分析报告',
            initiallyExpanded: false,
        });

        // 启动分析
        lock.startAnalyzing('正在解析时间聚合日志...');

        assert.strictEqual(lock.isAnalyzing, true);
        assert.strictEqual(lock.isLocked, true);
        assert.strictEqual(lock.isExpanded, true); // 强制展开

        // 用户或程序尝试 toggle 折叠 -> 必须被拒绝拦截！
        const toggleResult = lock.toggle();
        assert.strictEqual(toggleResult, false);
        assert.strictEqual(lock.isExpanded, true); // 维持展开，防止视口坍缩

        // 尝试显式 collapse() -> 同样被拒绝拦截！
        const collapseResult = lock.collapse();
        assert.strictEqual(collapseResult, false);
        assert.strictEqual(lock.isExpanded, true);
    });

    it('分析完成后瞬时交还折叠控制权，支持后续用户折叠', () => {
        const lock = new ThinkingAccordionLock();
        lock.startAnalyzing('分析中...');
        assert.strictEqual(lock.isLocked, true);

        // 分析完成
        lock.finishAnalyzing('分析完成，发现 3 处工时峰值。');

        assert.strictEqual(lock.isAnalyzing, false);
        assert.strictEqual(lock.isLocked, false);
        assert.strictEqual(lock.isExpanded, true); // 完成时保持展开方便查阅

        // 此时用户可以正常折叠
        const collapseResult = lock.collapse();
        assert.strictEqual(collapseResult, true);
        assert.strictEqual(lock.isExpanded, false);
    });

    it('exportQuotedText() 导出标准 Markdown blockquote 格式与双语头部', () => {
        const lock = new ThinkingAccordionLock({
            title: '周工时报告',
            initialContent: '第一行内容\n第二行内容',
        });

        // 中文头部导出
        const zhOutput = lock.exportQuotedText({
            includeHeader: true,
            locale: 'zh-CN',
        });
        assert.strictEqual(
            zhOutput,
            '> 【分析过程与思考明细】 — 周工时报告\n> 第一行内容\n> 第二行内容'
        );

        // 英文头部导出
        const enOutput = lock.exportQuotedText({
            includeHeader: true,
            locale: 'en',
        });
        assert.strictEqual(
            enOutput,
            '> [Analysis & Thinking Process] — 周工时报告\n> 第一行内容\n> 第二行内容'
        );
    });

    it('exportQuotedText() 正确清洗连续多余空行', () => {
        const lock = new ThinkingAccordionLock({
            initialContent: '第一行\n\n\n\n第二行',
        });

        const output = lock.exportQuotedText({
            includeHeader: false,
            cleanBlankLines: true,
        });

        // 4 个连续换行被清洗为单个空引用行
        assert.strictEqual(output, '> 第一行\n>\n> 第二行');
    });
});
