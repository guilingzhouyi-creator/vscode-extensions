# 内存 RingBuffer + Journal 追加写崩溃安全体系分析

## 一、 崩溃安全三道防线

`workspace-timing` 设计了三道同心圆防线确保时长零丢失与内存有界：

```
[Level 1: 内存秒级聚合] ───> 极速计算，零 I/O 延迟 (RingBuffer)
        │
        ▼ (心跳追加)
[Level 2: 增量追加 Journal] ──> 单行 NDJSON 顺序写，前缀 [DELTA]，断电即时回放
        │
        ▼ (降频同步)
[Level 3: 全量检查点快照] ────> stagingUri 暂存原子落盘，有界日汇总桶沉淀
```

---

## 二、 日志回放 (Journal Replay) 机制

1. **增量标记识别**：
   - Journal 中每行记录以 `[DELTA]` 作为语义前缀标识增量片段；
   - 包含增量时间戳区间、工时毫秒数与工作区哈希；
2. **启动自愈流程**：
   - 扩展激活时，先读取最近一次成功落盘的全量检查点快照；
   - 扫描 Journal 文件，重放快照时间点之后所有带有 `[DELTA]` 的增量行；
   - 重放时执行去重与时间单调性校验，完成对齐后触发一次全量检查点快照并截断日志。

---

## 三、 FIFO 数据折叠与总工时守恒定理

### 守恒定理：
$$\sum_{s \in \text{Sessions}_{raw}} \text{duration}(s) \equiv \sum_{s \in \text{segmentedSessions}_{active}} \text{duration}(s) + \sum_{d \in \text{dailyTotals}} \text{dailyTotals}[d]$$

当一个自然日内的会话片段记录数超过 20 条时，最久远的已完成会话片段将按 FIFO 顺序被弹出活跃列表，其累计时长原子沉淀至当天的 `dailyTotals` 日汇总桶内。该机制确保了无论扩展连续运行多少年，内存占用与 JSON 文件体积恒定保持在 $\mathcal{O}(1)$ 有界水平。
