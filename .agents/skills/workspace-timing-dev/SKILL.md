---
name: workspace-timing-dev
description: >-
  【触发：计时扩展/VS扩展/计时/UI国际化/环形缓冲/崩溃安全/双语字典】开发或维护 workspace-timing 扩展时触发。落实五层解耦、RingBuffer 与 Journal 双写崩溃安全、双语字典(zh-CN/en)与暗色 UI。
---

# workspace-timing-dev — VS Code 扩展五层架构、崩溃安全与双语字典规范

本技能规范了 `workspace-timing/` 扩展的五层单向解耦、RingBuffer + Journal 崩溃安全持久化、跨自然日原子切分、100% 双语字典覆盖及 L0~L5 审查规则对接。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | VS Code 扩展与计时视图（领域入口） |
| **前置** | —（作为领域入口，无前置） |
| **接续** | [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md) |
| **并行支援** | [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[coding-craft](../coding-craft/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md) |
| **领域链** | VS Code 扩展与计时视图：workspace-timing-dev → state-concurrency-and-crash-recovery → interaction-design-physics → test-benchmark-engineering → release-package-workflow |

**何时联动**：计时视图卡顿或丢帧 → `workspace-timing-dev` + `interaction-design-physics` + `algorithmic-operator-engineering`；进程被杀后缓冲区数据丢失 → `workspace-timing-dev` + `state-concurrency-and-crash-recovery` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 一、 五层单向解耦架构与无头可测性

依赖严格自顶向下单向流动：`UI 表现层 (Webview/StatusBar) -> Engine 核心引擎 (TimerEngine/TimeAggregator) -> Storage 存储协调 (StorageCoordinator/RingBuffer/Journal/HistoryFolder) -> Analytics 遥测层 -> Shared 通用契约 (i18n/DTO)`。
- **零反向依赖 (`LAY-IMPORT` / `LAY-CYCLE`)**：Storage / Engine / Analytics / Shared 严禁反向引用 UI 层或 `vscode.window` API；
- **纯逻辑脱机单测**：核心计时与聚合算法 100% 支持脱离 VS Code 宿主在 Mock Clock 下运行单测（<!-- METRICS:BEGIN ws-test-case-count -->**205 项**<!-- METRICS:END ws-test-case-count -->用例）。

---

## 二、 RingBuffer + Journal 崩溃安全与跨自然日工时守恒

1. **三级崩溃安全防线**：
   - **内存 RingBuffer**：秒级时间片内存聚合，零磁盘 I/O 掉帧；
   - **增量追加 Journal (`[DELTA]`)**：心跳追加单行 NDJSON，异常断电或崩溃重启后自动无损回放（详见 [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)）；
   - **全量检查点原子替换 (`stagingUri`)**：先写入 `stagingUri` 校验完整性，再原子重命名替换目标文件；危险重置前强制写入前置快照。
2. **`HistoryFolder` 有界折叠与跨自然日切分 (`segmentedSessions`)**：
   - 单日会话超 20 条按 FIFO 淘汰并沉淀入 `dailyTotals` 日桶，旧周会话自动归档，严格满足总工时守恒；
   - 休眠唤醒（`resumeFromSleep`）跨越午夜或跨周时，经 `TimeAggregator.splitByNaturalDay(startMs, endMs)` 拆分为 `segmentedSessions`；当 `rawManual === 0 && rawAi === 0 && durationMs > 0` 时，必须将全部 `segDuration` 正向回退计入 `manualMs`，严禁比例乘零吞没时长。

---

## 三、 UI 100% 双语字典 (`HC-UI-STRING`) 与暗色高对比度视觉契约

1. **100% 双语字典镜像**：所有界面文案经 `i18n.t(key)` 提取，在 `src/i18n/zh-CN.ts` 与 `src/i18n/en.ts`（及 `package.nls*.json`）双向对齐；严禁硬编码中英文或向用户暴露 `RingBuffer`/`NDJSON`/`dailyTotals` 等内部术语；
2. **暗色高对比度与抗抖动排版**：色彩经 `:root` 的 `var(--vscode-*)` 驱动，SVG 与折线图刻度文字强制使用 `#ffffff` 或明亮主题变量（WCAG AA+）；动态数字声明 `font-variant-numeric: tabular-nums`，遵循单闭合边框与 IME 合成态互锁（见 [interaction-design-physics](../interaction-design-physics/SKILL.md)）。

---

## 四、 L0~L5 审查门禁（单源 `review-rules.json`）与验证命令

```bash
cd workspace-timing
npm run compile && npm run test:fast && npm run review
```

- [five-layer-architecture-and-i18n.md](references/five-layer-architecture-and-i18n.md)：五层架构边界、`[DELTA]` 日志回放方程、工时守恒定理与 L0~L5 审查层级详解；
- [i18n-dictionary-template.json](templates/i18n-dictionary-template.json) / [time-aggregator-test-skeleton.ts](templates/time-aggregator-test-skeleton.ts)：双语字典样板与跨午夜工时守恒确定性单测脚手架。
