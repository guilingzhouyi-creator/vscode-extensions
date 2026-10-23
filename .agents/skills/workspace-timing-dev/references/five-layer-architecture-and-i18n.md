# VS Code 计时扩展五层架构、`[DELTA]` 崩溃回放与工时守恒定理指南

> 本指南整合了 `workspace-timing/` 五层单向依赖边界、RingBuffer + Journal 三级崩溃回放流程与 FIFO 折叠守恒方程。

---

## 一、 三级崩溃安全防线与 `[DELTA]` 启动回放自愈

```text
[Level 1: 内存秒级聚合 (RingBuffer)] ──▶ [Level 2: 心跳追加 Journal ([DELTA] NDJSON)] ──▶ [Level 3: stagingUri 原子重命名快照]
```

1. **规范生产命名契约**：
   - `stagingUri`：快照原子替换专用暂存 URI（禁 `tmpPath` / `tempUri`）；
   - `segmentedSessions`：跨自然日切分或 FIFO 折叠后的标准会话片段序列（禁 `splitSessions`）；
   - `[DELTA]`：Journal 增量追加行的标准语义前缀。
2. **启动回放与 FIFO 折叠总工时守恒定理**：
   扩展激活时读取最近一次检查点快照，重放其后所有 `[DELTA]` 行（执行去重与单调性校验）后刷新快照并截断日志。单日会话超 20 条时按 FIFO 沉淀入 `dailyTotals`，严格保持工时守恒：
   $$\sum_{s \in \text{Sessions}_{\text{raw}}} \text{duration}(s) \equiv \sum_{s \in \text{segmentedSessions}_{\text{active}}} \text{duration}(s) + \sum_{d \in \text{dailyTotals}} \text{dailyTotals}[d]$$

---

## 二、 L0~L5 六层审查规则体系 (`scripts/config/review-rules.json`)

| 审查层 | 核心守卫代号 | 拦截目标 |
| :---: | :--- | :--- |
| **L0** | `L0-COMPILE` / `L0-TEST` | TypeScript 零错误编译（`declaration: false`）与 100% 单测通过 |
| **L1** | `L1-LINT` / `L1-*` | 快照前置保护、崩溃安全写入与代码质量基线 |
| **L2** | `LAY-CYCLE` / `LAY-IMPORT` | 五层单向依赖、零循环引用与宿主 API 隔离 |
| **L3** | `HC-UI-STRING` / `HC-ABS-PATH` | 双语字典 100% 镜像、零硬编码 UI 字符串与路径、发布页布局洁净 |
| **L4 / L5** | `TB-REGRESSION` / `ARF-THRESHOLDS` | 测试耗时单调棘轮与零高危技术债防反弹 |
