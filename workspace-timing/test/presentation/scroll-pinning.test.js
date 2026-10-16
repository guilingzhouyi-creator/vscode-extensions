/**
 * ScrollPinningController 单元测试套件
 * 运行环境：Node.js Mocha，验证 150ms 冷却图钉、40px 吸附容差与 120px 微胶囊状态机
 */
'use strict';

const assert = require('assert');
const { ScrollPinningController } = require('../../out/presentation/scroll-pinning.js');

class MockScrollContainer {
    constructor(scrollTop = 0, clientHeight = 300, scrollHeight = 300) {
        this.scrollTop = scrollTop;
        this.clientHeight = clientHeight;
        this.scrollHeight = scrollHeight;
        this.scrollToCalls = [];
        this.listeners = new Map();
    }

    scrollTo(opts) {
        this.scrollToCalls.push(opts);
        this.scrollTop = opts.top;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
        const list = this.listeners.get(type);
        if (list) {
            const idx = list.indexOf(listener);
            if (idx >= 0) list.splice(idx, 1);
        }
    }

    dispatch(type, event = {}) {
        const list = this.listeners.get(type);
        if (list) {
            for (const fn of list) fn(event);
        }
    }
}

describe('ScrollPinningController（150ms 冷却视口图钉控制器）', () => {
    it('初始化默认吸附：当距离底部 <= 40px 时处于 pinned 状态且微胶囊隐藏', () => {
        const container = new MockScrollContainer(0, 300, 320); // 距离底部 20px
        const controller = new ScrollPinningController({ container });

        assert.strictEqual(controller.pinned, true);
        assert.strictEqual(controller.capsuleVisible, false);
        assert.strictEqual(controller.getDistanceFromBottom(), 20);
    });

    it('用户主动向上滚动脱离底部（distance > 40px）时解除吸附', () => {
        const container = new MockScrollContainer(100, 300, 500); // 距离底部 100px
        let pinnedEvents = [];
        const controller = new ScrollPinningController({
            container,
            onPinnedStateChange: p => pinnedEvents.push(p),
        });

        // 模拟用户滚轮输入
        controller.recordUserInput(1000);

        assert.strictEqual(controller.pinned, false);
        assert.strictEqual(controller.getDistanceFromBottom(), 100);
        assert.strictEqual(controller.capsuleVisible, false); // 100px <= 120px，微胶囊不显示
    });

    it('当脱离底部距离 > 120px 时，快速直达悬浮微胶囊进入显示态', () => {
        const container = new MockScrollContainer(50, 300, 600); // 距离底部 250px
        let capsuleEvents = [];
        const controller = new ScrollPinningController({
            container,
            onCapsuleVisibilityChange: v => capsuleEvents.push(v),
        });

        controller.recordUserInput(1000);

        assert.strictEqual(controller.pinned, false);
        assert.strictEqual(controller.capsuleVisible, true);
        assert.deepStrictEqual(capsuleEvents, [true]);
    });

    it('150ms 用户输入冷却窗口：在冷却时间内追加内容物理剥夺滚动权限', () => {
        const container = new MockScrollContainer(0, 300, 300);
        const controller = new ScrollPinningController({ container });

        // 记录用户输入时间戳 1000
        controller.recordUserInput(1000);

        // 此时推流追加新内容（时间 1080，在 150ms 冷却窗口内）
        container.scrollHeight = 800;
        const scrolled = controller.notifyContentAppended(1080);

        // 物理剥夺滚动权限，返回 false 且未触发 scrollTo
        assert.strictEqual(scrolled, false);
        assert.strictEqual(container.scrollToCalls.length, 0);
    });

    it('冷却窗口结束后若处于吸附态，自动使用 behavior: "auto" 瞬时无抖贴底', () => {
        const container = new MockScrollContainer(0, 300, 300);
        const controller = new ScrollPinningController({ container });

        // 初始吸附态，无输入干扰（冷却已过）
        container.scrollHeight = 900;
        const scrolled = controller.notifyContentAppended(2000);

        assert.strictEqual(scrolled, true);
        assert.strictEqual(container.scrollToCalls.length, 1);
        assert.deepStrictEqual(container.scrollToCalls[0], { top: 600, behavior: 'auto' });
        assert.strictEqual(controller.pinned, true);
    });

    it('scrollToBottom("smooth") 快速直达底部并即时恢复吸附态与隐藏胶囊', () => {
        const container = new MockScrollContainer(50, 300, 800); // 脱离底部
        const controller = new ScrollPinningController({ container });
        controller.recordUserInput(1000);

        assert.strictEqual(controller.pinned, false);
        assert.strictEqual(controller.capsuleVisible, true);

        controller.scrollToBottom('smooth');

        assert.strictEqual(controller.pinned, true);
        assert.strictEqual(controller.capsuleVisible, false);
        assert.deepStrictEqual(container.scrollToCalls[0], { top: 500, behavior: 'smooth' });
    });

    it('dispose() 解绑事件且后续操作安全空转', () => {
        const container = new MockScrollContainer(0, 300, 300);
        const controller = new ScrollPinningController({ container });

        controller.dispose();
        const scrolled = controller.notifyContentAppended(2000);

        assert.strictEqual(scrolled, false);
        assert.strictEqual(container.listeners.get('scroll').length, 0);
    });
});
