/**
 * Module: Unit Test — Container Queries & Anti-Extrusion CSS Contract
 * File Path: test/presentation/container-queries.test.js
 * Architecture Role: Verifies the 4-stage container query CSS tokens and CJK guards
 * Dependencies & Triggers: Node.js assert, mocha test runner; consumes out/presentation/container-queries.js
 * Responsibilities:
 *   1. Assert TIMING_VIEWPORT_CONTAINER_CLASS constant identity;
 *   2. Assert container-type and container-name definitions;
 *   3. Assert all 4 responsive container query stages (240px, 320px, 384px, 385px);
 *   4. Assert CJK anti-extrusion and single-enclosure border CSS properties.
 * Exit Semantics & Design Rationale: Deterministic pure string assertions; zero mock overhead.
 */
'use strict';

const assert = require('assert');
const {
    TIMING_VIEWPORT_CONTAINER_CLASS,
    TIMING_VIEWPORT_STYLES,
} = require('../../out/presentation/container-queries.js');

describe('ContainerQueries（容器查询与防挤压排版契约）', () => {
    it('容器类名常量保持与 CSS 契约一致', () => {
        assert.strictEqual(TIMING_VIEWPORT_CONTAINER_CLASS, 'timing-viewport-container');
    });

    it('声明内联尺寸容器类型与 timing-viewport 命名空间', () => {
        assert.ok(TIMING_VIEWPORT_STYLES.includes('container-type: inline-size;'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('container-name: timing-viewport;'));
    });

    it('覆盖 4 阶响应式容器查询阶梯定义', () => {
        // 阶梯 1: 极窄阶梯 <= 240px
        assert.ok(TIMING_VIEWPORT_STYLES.includes('@container timing-viewport (max-width: 240px)'));
        // 阶梯 2: 紧凑侧栏 241px ~ 320px
        assert.ok(TIMING_VIEWPORT_STYLES.includes('@container timing-viewport (min-width: 241px) and (max-width: 320px)'));
        // 阶梯 3: 标准卡片 321px ~ 384px
        assert.ok(TIMING_VIEWPORT_STYLES.includes('@container timing-viewport (min-width: 321px) and (max-width: 384px)'));
        // 阶梯 4: 宽屏自适应 >= 385px
        assert.ok(TIMING_VIEWPORT_STYLES.includes('@container timing-viewport (min-width: 385px)'));
    });

    it('包含 CJK 防文字挤压排版三要素（break-word, normal, text-wrap balance）', () => {
        assert.ok(TIMING_VIEWPORT_STYLES.includes('overflow-wrap: break-word;'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('word-break: normal;'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('text-wrap: balance;'));
    });

    it('落实单闭合边框防重叠原则（内层控件移除左右边框）', () => {
        assert.ok(TIMING_VIEWPORT_STYLES.includes('border-left: none;'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('border-right: none;'));
    });

    it('TIMING_VIEWPORT_STYLES 包含核心容器与自适应排版关键声明', () => {
        assert.ok(TIMING_VIEWPORT_STYLES.includes('.timing-viewport-container'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('container-name: timing-viewport;'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('@container timing-viewport (max-width: 240px)'));
        assert.ok(TIMING_VIEWPORT_STYLES.includes('@container timing-viewport (min-width: 385px)'));
    });
});
