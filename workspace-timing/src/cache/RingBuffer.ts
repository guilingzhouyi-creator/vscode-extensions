/**
 * Module: Ring Buffer (泛型定长环形缓冲区)
 * File Path: src/cache/RingBuffer.ts
 * Architecture Role: 缓存层高吞吐基础数据结构，提供 O(1) 无动态内存分配的先进先出（FIFO）队列与两阶段消费支持。
 * Dependencies & Triggers: 依赖 domain/models 默认容量；作为 JournalWriter 与高频采集器的核心内存缓冲容器。
 * Responsibilities: 定长循环队列管理；满载覆盖淘汰最旧元素；两阶段只读窥探 (peekAll/peekLast) 与原子推进 (advance)；内存槽位清理防泄漏。
 * Exit Semantics & Design Rationale: 构造时预分配定长数组消除循环内堆分配；严格模运算指针步进；槽位清退置 undefined 协助 GC 垃圾回收。
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
