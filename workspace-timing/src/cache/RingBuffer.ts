/**
 * RingBuffer — 泛型环形缓冲区
 *
 * 固定容量，O(1) 读写，支持批量 flush。
 * 用于缓存 TimeSlice，支持：
 *   1. 批量 flush 到 journal 减少 I/O
 *   2. 实时读取最近 N 条记录供 UI 展示活跃曲线
 *   3. 固定容量控制内存上限
 */

export class RingBuffer<T> {
    private readonly buffer: (T | undefined)[];
    private head: number = 0;    // 写指针
    private tail: number = 0;    // 读指针
    private _count: number = 0;
    private readonly _capacity: number;

    constructor(capacity: number = 1024) {
        if (capacity < 1) {
            throw new Error(`RingBuffer capacity must be >= 1, got ${capacity}`);
        }
        this._capacity = capacity;
        this.buffer = new Array<T>(capacity);
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
            // 覆盖时同步移动读指针
            this.tail = (this.tail + 1) % this._capacity;
        }

        return overwritten;
    }

    /**
     * 取出所有未读条目，O(n)。
     * 返回后缓冲区清空。
     */
    flush(): T[] {
        if (this._count === 0) return [];

        const items: T[] = new Array(this._count);
        let idx = 0;

        while (this.tail !== this.head) {
            const item = this.buffer[this.tail];
            if (item !== undefined) {
                items[idx++] = item;
            }
            this.buffer[this.tail] = undefined;
            this.tail = (this.tail + 1) % this._capacity;
        }

        this._count = 0;
        return items;
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
