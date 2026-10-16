/**
 * RovingFocusController 单元测试套件
 * 运行环境：Node.js Mocha，验证 WAI-ARIA 焦点漫游与键盘状态机
 */
'use strict';

const assert = require('assert');
const { RovingFocusController } = require('../../out/presentation/roving-focus-controller.js');

class MockDomItem {
    constructor(id) {
        this.id = id;
        this.tabIndex = -1;
        this.isFocused = false;
        this.attributes = new Map();
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    hasAttribute(k) { return this.attributes.has(k); }
    focus() { this.isFocused = true; }
    blur() { this.isFocused = false; }
}

class MockDomContainer {
    constructor() {
        this.listeners = new Map();
        this.items = [];
    }
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
    querySelectorAll() {
        return this.items;
    }
}

describe('RovingFocusController（全键盘盲操漫游控制器）', () => {
    it('初始化保持当前项 tabIndex=0，其余项 tabIndex=-1', () => {
        const container = new MockDomContainer();
        const item1 = new MockDomItem('i1');
        const item2 = new MockDomItem('i2');
        const item3 = new MockDomItem('i3');
        container.items = [item1, item2, item3];

        const controller = new RovingFocusController({
            container, itemSelector: '.roving-item', initialIndex: 0,
        });

        assert.strictEqual(controller.activeIndex, 0);
        assert.strictEqual(item1.tabIndex, 0);
        assert.strictEqual(item2.tabIndex, -1);
        assert.strictEqual(item3.tabIndex, -1);
    });

    it('ArrowDown 与 ArrowUp 正确单步漫游', () => {
        const container = new MockDomContainer();
        const item1 = new MockDomItem('i1');
        const item2 = new MockDomItem('i2');
        const item3 = new MockDomItem('i3');
        container.items = [item1, item2, item3];

        const controller = new RovingFocusController({
            container, itemSelector: '.roving-item', initialIndex: 0,
        });

        // ArrowDown -> item 1
        const handledDown = controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
        assert.strictEqual(handledDown, true);
        assert.strictEqual(controller.activeIndex, 1);
        assert.strictEqual(item1.tabIndex, -1);
        assert.strictEqual(item2.tabIndex, 0);
        assert.strictEqual(item2.isFocused, true);

        // ArrowUp -> back to item 0
        const handledUp = controller.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
        assert.strictEqual(handledUp, true);
        assert.strictEqual(controller.activeIndex, 0);
        assert.strictEqual(item1.tabIndex, 0);
    });

    it('首尾循环边界回环 (Wrap-around)', () => {
        const container = new MockDomContainer();
        const item1 = new MockDomItem('i1');
        const item2 = new MockDomItem('i2');
        container.items = [item1, item2];

        const controller = new RovingFocusController({
            container, itemSelector: '.roving-item', initialIndex: 0, loop: true,
        });

        // At index 0, ArrowUp wraps to index 1 (last)
        controller.handleKeyDown({ key: 'ArrowUp', preventDefault: () => {} });
        assert.strictEqual(controller.activeIndex, 1);

        // At index 1, ArrowDown wraps to index 0 (first)
        controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
        assert.strictEqual(controller.activeIndex, 0);
    });

    it('Home 和 End 键极速跳转到首项与尾项', () => {
        const container = new MockDomContainer();
        const item1 = new MockDomItem('i1');
        const item2 = new MockDomItem('i2');
        const item3 = new MockDomItem('i3');
        container.items = [item1, item2, item3];

        const controller = new RovingFocusController({
            container, itemSelector: '.roving-item', initialIndex: 0,
        });

        controller.handleKeyDown({ key: 'End', preventDefault: () => {} });
        assert.strictEqual(controller.activeIndex, 2);

        controller.handleKeyDown({ key: 'Home', preventDefault: () => {} });
        assert.strictEqual(controller.activeIndex, 0);
    });

    it('自动跳过 disabled 与 aria-disabled 禁用项', () => {
        const container = new MockDomContainer();
        const item1 = new MockDomItem('i1');
        const item2 = new MockDomItem('i2');
        item2.setAttribute('disabled', 'true');
        const item3 = new MockDomItem('i3');
        container.items = [item1, item2, item3];

        const controller = new RovingFocusController({
            container, itemSelector: '.roving-item', initialIndex: 0,
        });

        // From index 0, ArrowDown skips item2 (disabled) and lands on item3 (index 2)
        controller.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} });
        assert.strictEqual(controller.activeIndex, 2);
        assert.strictEqual(item3.tabIndex, 0);
    });
});
