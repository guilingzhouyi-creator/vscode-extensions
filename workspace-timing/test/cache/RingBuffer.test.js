/**
 * RingBuffer — 纯 Node 单元测试
 *
 * 验证：容量约束、FIFO 写入与覆盖、peekOldest/peekNewest/peekLast 顺序、
 * 满缓冲 flush 零丢失、clear 清空。
 * 依赖 out/ 编译产物，先 npm run compile。
 */
'use strict';

const assert = require('assert');
const { RingBuffer } = require('../../out/cache/RingBuffer.js');

describe('RingBuffer（泛型环形缓冲区）', () => {
    it('构造参数校验：容量小于 1 时抛错，默认容量为 1024', () => {
        assert.throws(() => new RingBuffer(0), /capacity must be >= 1/);
        assert.throws(() => new RingBuffer(-5), /capacity must be >= 1/);

        const def = new RingBuffer();
        assert.strictEqual(def.capacity, 1024);
        assert.strictEqual(def.count, 0);
        assert.strictEqual(def.isEmpty, true);
        assert.strictEqual(def.isFull, false);
    });

    it('push：正常写入并更新 count / isEmpty / isFull', () => {
        const rb = new RingBuffer(3);
        assert.strictEqual(rb.isEmpty, true);

        const ov1 = rb.push(10);
        assert.strictEqual(ov1, undefined);
        assert.strictEqual(rb.count, 1);
        assert.strictEqual(rb.isEmpty, false);
        assert.strictEqual(rb.isFull, false);

        rb.push(20);
        rb.push(30);
        assert.strictEqual(rb.count, 3);
        assert.strictEqual(rb.isFull, true);
    });

    it('push：超出容量时覆盖最旧条目并返回被覆盖值，推进 tail', () => {
        const rb = new RingBuffer(3);
        rb.push('a');
        rb.push('b');
        rb.push('c');

        const ov = rb.push('d');
        assert.strictEqual(ov, 'a', '返回被覆盖的最旧条目 a');
        assert.strictEqual(rb.count, 3);
        assert.strictEqual(rb.isFull, true);

        assert.strictEqual(rb.peekOldest(), 'b', '最旧条目变为 b');
        assert.strictEqual(rb.peekNewest(), 'd', '最新条目变为 d');
    });

    it('peekOldest 与 peekNewest：空缓冲返回 undefined，非空返回对应条目 (O(1))', () => {
        const rb = new RingBuffer(4);
        assert.strictEqual(rb.peekOldest(), undefined);
        assert.strictEqual(rb.peekNewest(), undefined);

        rb.push(100);
        assert.strictEqual(rb.peekOldest(), 100);
        assert.strictEqual(rb.peekNewest(), 100);

        rb.push(200);
        rb.push(300);
        assert.strictEqual(rb.peekOldest(), 100);
        assert.strictEqual(rb.peekNewest(), 300);
    });

    it('peekLast：按时序读取最近 N 条（不改变缓冲区状态）', () => {
        const rb = new RingBuffer(4);
        assert.deepStrictEqual(rb.peekLast(0), []);
        assert.deepStrictEqual(rb.peekLast(-1), []);
        assert.deepStrictEqual(rb.peekLast(5), []);

        rb.push(1);
        rb.push(2);
        rb.push(3);

        assert.deepStrictEqual(rb.peekLast(2), [2, 3]);
        assert.deepStrictEqual(rb.peekLast(3), [1, 2, 3]);
        assert.deepStrictEqual(rb.peekLast(10), [1, 2, 3], '超量请求截断为 count');
        assert.strictEqual(rb.count, 3, 'peek 不消耗条目');

        // 覆盖后再 peekLast（跨环绕边界）
        rb.push(4); // [1, 2, 3, 4]
        rb.push(5); // 覆盖 1 -> [5, 2, 3, 4], 顺序为 2, 3, 4, 5
        assert.deepStrictEqual(rb.peekLast(3), [3, 4, 5]);
        assert.deepStrictEqual(rb.peekLast(4), [2, 3, 4, 5]);
    });

    it('flush：取出全部未读条目并清空缓冲区，满缓冲时零丢失', () => {
        const rb = new RingBuffer(3);
        assert.deepStrictEqual(rb.flush(), []);

        rb.push('x');
        rb.push('y');
        assert.deepStrictEqual(rb.flush(), ['x', 'y']);
        assert.strictEqual(rb.count, 0);
        assert.strictEqual(rb.isEmpty, true);

        // 满缓冲且发生覆盖后的 flush（head === tail 指针重合边界）
        rb.push(1);
        rb.push(2);
        rb.push(3);
        rb.push(4); // 覆盖 1
        assert.strictEqual(rb.count, 3);
        assert.strictEqual(rb.isFull, true);

        const flushed = rb.flush();
        assert.deepStrictEqual(flushed, [2, 3, 4], '满缓冲 flush 数据完整按时序取出');
        assert.strictEqual(rb.count, 0);
        assert.strictEqual(rb.isEmpty, true);
        assert.strictEqual(rb.peekOldest(), undefined);
        assert.strictEqual(rb.peekNewest(), undefined);
    });

    it('clear：重置所有指针与数组槽位', () => {
        const rb = new RingBuffer(3);
        rb.push(1);
        rb.push(2);
        rb.push(3);
        rb.clear();

        assert.strictEqual(rb.count, 0);
        assert.strictEqual(rb.isEmpty, true);
        assert.strictEqual(rb.peekOldest(), undefined);
        assert.strictEqual(rb.peekNewest(), undefined);
        assert.deepStrictEqual(rb.flush(), []);

        // clear 后可重新正常写入
        rb.push(99);
        assert.strictEqual(rb.count, 1);
        assert.strictEqual(rb.peekOldest(), 99);
    });
});
