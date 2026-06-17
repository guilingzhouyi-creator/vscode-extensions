/**
 * RingBuffer — 泛型环形缓冲区
 *
 * 固定容量，O(1) 读写，支持批量 flush。
 * 用于缓存 TimeSlice，支持：
 *   1. 批量 flush 到 journal 减少 I/O
 *   2. 实时读取最近 N 条记录供 UI 展示活跃曲线
 *   3. 固定容量控制内存上限
 */
export declare class RingBuffer<T> {
    private readonly buffer;
    private head;
    private tail;
    private _count;
    private readonly _capacity;
    constructor(capacity?: number);
    /** 固定容量 */
    get capacity(): number;
    /** 当前条目数 */
    get count(): number;
    /** 是否已满 */
    get isFull(): boolean;
    /** 是否为空 */
    get isEmpty(): boolean;
    /**
     * O(1) 写入一条。
     * 缓冲区满时覆盖最旧条目，并返回被覆盖的值。
     */
    push(item: T): T | undefined;
    /**
     * 取出所有未读条目，O(n)。
     * 返回后缓冲区清空。
     */
    flush(): T[];
    /**
     * 读取最近 N 条记录（不取出）。
     * 用于 UI 查询活跃曲线数据。
     */
    peekLast(n: number): T[];
    /** 清空缓冲区 */
    clear(): void;
}
