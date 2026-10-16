/**
 * SplitPaneResizer 单元测试套件
 * 运行环境：Node.js Mocha，基于轻量 MockElement 验证手势物理模型
 */
'use strict';

const assert = require('assert');
const { SplitPaneResizer } = require('../../out/presentation/split-pane-resizer.js');

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.attributes = new Map();
        this.style = {};
        this.listeners = new Map();
        this.children = [];
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    removeAttribute(k) { this.attributes.delete(k); }
    hasAttribute(k) { return this.attributes.has(k); }
    addEventListener(evt, fn) {
        if (!this.listeners.has(evt)) this.listeners.set(evt, []);
        this.listeners.get(evt).push(fn);
    }
    removeEventListener(evt, fn) {
        const arr = this.listeners.get(evt);
        if (arr) {
            const idx = arr.indexOf(fn);
            if (idx >= 0) arr.splice(idx, 1);
        }
    }
    dispatchEvent(e) {
        const arr = this.listeners.get(e.type);
        if (arr) {
            for (const fn of arr) fn(e);
        }
    }
    querySelectorAll(selector) {
        if (selector === 'iframe') {
            return this.children.filter(c => c.tagName === 'iframe');
        }
        return [];
    }
    getBoundingClientRect() {
        return { left: 0, top: 0, width: 1000, height: 500 };
    }
}

describe('SplitPaneResizer（分栏物理分割手柄）', () => {
    it('初始化按指定比例设置 flex 样式', () => {
        const container = new MockElement();
        const handle = new MockElement();
        const first = new MockElement();
        const second = new MockElement();

        const resizer = new SplitPaneResizer({
            container, handle, firstPane: first, secondPane: second, initialRatio: 0.6,
        });

        assert.strictEqual(resizer.ratio, 0.6);
        assert.strictEqual(first.style.flex, '0 0 60.00%');
        assert.strictEqual(second.style.flex, '0 0 40.00%');
    });

    it('4px 移动死区验证：位移 < 4px 不触发拖拽，>= 4px 激活 data-pane-dragging', () => {
        const container = new MockElement();
        const handle = new MockElement();
        const first = new MockElement();
        const second = new MockElement();
        const iframe = new MockElement('iframe');
        container.children.push(iframe);

        const resizer = new SplitPaneResizer({
            container, handle, firstPane: first, secondPane: second,
        });

        // PointerDown at (100, 100)
        handle.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 100, clientY: 100 });
        assert.strictEqual(resizer.isDragging, false);

        // Move 2px dx (102, 100) -> Hypotenuse = 2px < 4px
        resizer['onPointerMove']({ clientX: 102, clientY: 100 });
        assert.strictEqual(resizer.isDragging, false);
        assert.strictEqual(container.getAttribute('data-pane-dragging'), null);

        // Move 5px dx (105, 100) -> Hypotenuse = 5px >= 4px -> Trigger drag!
        resizer['onPointerMove']({ clientX: 105, clientY: 100 });
        assert.strictEqual(resizer.isDragging, true);
        assert.strictEqual(container.getAttribute('data-pane-dragging'), 'true');
        assert.strictEqual(iframe.style.pointerEvents, 'none');

        // PointerUp
        resizer['onPointerUp']();
        assert.strictEqual(resizer.isDragging, false);
        assert.strictEqual(container.getAttribute('data-pane-dragging'), null);
        assert.strictEqual(iframe.style.pointerEvents, '');
    });

    it('双击手柄触发 50/50 居中吸附', () => {
        const container = new MockElement();
        const handle = new MockElement();
        const first = new MockElement();
        const second = new MockElement();

        const resizer = new SplitPaneResizer({
            container, handle, firstPane: first, secondPane: second, initialRatio: 0.25,
        });

        assert.strictEqual(resizer.ratio, 0.25);
        resizer.snapToCenter();
        assert.strictEqual(resizer.ratio, 0.5);
        assert.strictEqual(first.style.flex, '0 0 50.00%');
    });

    it('Escape 键回滚拖拽前比例', () => {
        const container = new MockElement();
        const handle = new MockElement();
        const first = new MockElement();
        const second = new MockElement();

        const resizer = new SplitPaneResizer({
            container, handle, firstPane: first, secondPane: second, initialRatio: 0.4,
        });

        handle.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 100, clientY: 100 });
        resizer['onPointerMove']({ clientX: 150, clientY: 100 });
        assert.notStrictEqual(resizer.ratio, 0.4);

        // Press Escape
        resizer['onKeyDown']({ key: 'Escape' });
        assert.strictEqual(resizer.ratio, 0.4);
        assert.strictEqual(resizer.isDragging, false);
    });

    it('< 18% 边缘折叠收拢', () => {
        const container = new MockElement();
        const handle = new MockElement();
        const first = new MockElement();
        const second = new MockElement();
        let collapsedNotified = false;

        const resizer = new SplitPaneResizer({
            container, handle, firstPane: first, secondPane: second,
            onCollapse: (c) => { collapsedNotified = c; }
        });

        resizer.setRatio(0.12);
        assert.strictEqual(resizer.ratio, 0);
        assert.strictEqual(resizer.isCollapsed, true);
        assert.strictEqual(collapsedNotified, true);
    });
});
