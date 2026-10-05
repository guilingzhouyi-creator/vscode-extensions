# 内存 RingBuffer + Journal 追加写崩溃安全体系分析

## 一、 崩溃安全三道防线

`workspace-timing` 设计了三道同心圆防线确保时长零丢失与内存有界：

```
[Level 1: 内存秒级聚合] ───> 极速计算，零 I/O 延迟
        │
        ▼ (心跳追加)
[Level 2: 增量追加 Journal] ──> 单行 NDJSON 顺序写，异常断电即时回放
        │
        ▼ (降频同步)
[Level 3: 全量检查点快照] ────> 状态持久化与有界日汇总桶沉淀
```

---

## 二、 FIFO 数据折叠与总工时守恒定理

### 守恒定理：
$$\sum_{s \in \text{Sessions}_{raw}} \text{duration}(s) \equiv \sum_{s \in \text{Sessions}_{active}} \text{duration}(s) + \sum_{d \in \text{dailyTotals}} \text{dailyTotals}[d]$$

当一个自然日内的会话片段记录数超过 20 条时，最久远的已完成会话片段将按 FIFO 顺序被弹出活跃列表，其累计时长原子沉淀至当天的 `dailyTotals` 日汇总桶内。该机制确保了无论扩展连续运行多少年，内存占用与 JSON 文件体积恒定保持在 $\mathcal{O}(1)$ 有界水平。
