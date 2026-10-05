/**
 * RingBuffer — 泛型环形缓冲区
 *
 * 固定容量，O(1) 读写，支持两阶段提交批量消费。
 * 用于缓存 TimeSlice，支持：
 *   1. 两阶段提交（peekAll + advance）：落盘失败不丢失、不破坏时序
 *   2. 实时读取最近 N 条记录供 UI 展示活跃曲线
 *   3. 固定容量控制内存上限
 *
 * 数学不变量：
 *   - 容量：capacity >= 1 且不可变
 *   - 条目数：0 <= count <= capacity
 *   - 指针范围：0 <= head, tail < capacity
 *   - 环形跨度：当 count < capacity 时，head = (tail + count) % capacity；
 *              当 count == capacity 时，head == tail 且 isFull == true。
 */

import { DEFAULT_RING_BUFFER_CAP } from '../domain/models';

export class RingBuffer<T> {
    private readonly buffer: (T | undefined)[];
    private head: number = 0;    // 写指针（下一个写入位置）
    private tail: number = 0;    // 读指针（下一个读取/推进位置）
    private _count: number = 0;
    private readonly _capacity: number;

    constructor(capacity: number = DEFAULT_RING_BUFFER_CAP) {
        if (capacity < 1) {
            throw new Error(`RingBuffer capacity must be >= 1, got ${capacity}`);
        }
        this._capacity = capacity;
        this.buffer = new Array<T | undefined>(capacity);
    }

    /** 固定容量 */
    get capacity(): number {
        return this._capacity;
    }

    /** 当前条目数 */
    get count(): number {
        return this._count;
    }

    /** 是否已满 */
    get isFull(): boolean {
        return this._count === this._capacity;
    }

    /** 是否为空 */
    get isEmpty(): boolean {
        return this._count === 0;
    }

    /**
     * O(1) 写入一条。
     * 缓冲区满时覆盖最旧条目，并返回被覆盖的值。
     */
    push(item: T): T | undefined {
        const index = this.head;
        const overwritten = this.buffer[index];
        this.buffer[index] = item;
        this.head = (this.head + 1) % this._capacity;

        if (this._count < this._capacity) {
            this._count++;
        } else {
            // 满缓冲覆盖时同步移动读指针
            this.tail = (this.tail + 1) % this._capacity;
        }

        return overwritten;
    }

    /**
     * 读取当前所有未消费条目切片（两阶段提交的预读阶段）。
     * 不移动 tail 指针，不改变缓冲区状态。
     */
    peekAll(): T[] {
        if (this._count === 0) {
            return [];
        }

        const items: T[] = new Array(this._count);
        let srcIdx = this.tail;
        for (let i = 0; i < this._count; i++) {
            items[i] = this.buffer[srcIdx] as T;
            srcIdx = (srcIdx + 1) % this._capacity;
        }
        return items;
    }

    /**
     * 原子推进读指针并清空已确认消费的槽位（两阶段提交的确认阶段）。
     *
     * @param count - 已确认消费的条目数（必须 <= this.count）
     */
    advance(count: number): void {
        if (count <= 0) {
            return;
        }
        const toAdvance = Math.min(count, this._count);
        for (let i = 0; i < toAdvance; i++) {
            this.buffer[this.tail] = undefined;
            this.tail = (this.tail + 1) % this._capacity;
        }
        this._count -= toAdvance;
    }

    /**
     * 取出所有未读条目，O(n)。
     * 返回后缓冲区清空（单阶段直接消费）。
     */
    flush(): T[] {
        const items = this.peekAll();
        this.advance(items.length);
        return items;
    }

    /**
     * 读取最旧的一条（不取出），O(1)。空缓冲区返回 undefined。
     */
    peekOldest(): T | undefined {
        if (this._count === 0) {
            return undefined;
        }
        return this.buffer[this.tail];
    }

    /**
     * 读取最新的一条（不取出），O(1)。空缓冲区返回 undefined。
     */
    peekNewest(): T | undefined {
        if (this._count === 0) {
            return undefined;
        }
        const idx = (this.head - 1 + this._capacity) % this._capacity;
        return this.buffer[idx];
    }

    /**
     * 读取最近 N 条记录（不取出）。
     * 用于 UI 查询活跃曲线数据。
     */
    peekLast(n: number): T[] {
        if (n <= 0 || this._count === 0) return [];

        const take = Math.min(n, this._count);
        const result: T[] = new Array(take);
        let srcIdx = (this.tail + this._count - take) % this._capacity;

        for (let i = 0; i < take; i++) {
            result[i] = this.buffer[srcIdx] as T;
            srcIdx = (srcIdx + 1) % this._capacity;
        }

        return result;
    }

    /** 清空缓冲区 */
    clear(): void {
        this.buffer.fill(undefined);
        this.head = 0;
        this.tail = 0;
        this._count = 0;
    }
}
