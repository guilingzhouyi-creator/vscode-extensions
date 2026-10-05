---
name: workspace-timing-dev
description: >-
  workspace-timing VS Code 计时扩展五层架构解耦、双写崩溃安全与双语字典规范。
  指导 Agent 在 workspace-timing 项目中维护时间聚合核心、RingBuffer 与日志追加崩溃防护、
  有界内存折叠（dailyTotals）、100% 双语国际化（zh-CN/en）与暗色高对比度 UI。
---

# workspace-timing-dev — VS Code 扩展五层架构与崩溃安全研发规范

本技能规范了 `workspace-timing/` 扩展的五层解耦架构、高可靠内存与磁盘双写崩溃安全体系、双语国际化以及视觉对比度契约。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **修改核心计时或数据聚合引擎**（`TimerEngine.ts`、`TimeAggregator.ts`）；
2. **重构多级持久化存储与崩溃恢复逻辑**（`StorageCoordinator.ts`、`HistoryFolder.ts`）；
3. **新增或调整仪表板 Webview UI 或状态栏控制器**（`dashboard.html`、`StatusBarManager.ts`）；
4. **新增用户界面提示、命令文案或设置选项**；
5. **维护内部审查规则**（`workspace-timing/scripts/config/review-rules.json`）。

---

## 二、 五层架构解耦与单向依赖契约

项目严格划分为五大架构层次，依赖必须保持严格的自顶向下单向流动：

```
[UI 表现层] (Webview Dashboard, Status Bar Controller, Dialogs)
     │
     ▼
[Engine 核心引擎] (TimerEngine 计时状态机, TimeAggregator 日报/周报聚合)
     │
     ▼
[Storage 存储协调] (StorageCoordinator, RingBuffer, Journal 日志, HistoryFolder 折叠)
     │
     ▼
[Analytics 遥测层] (Heatmap 算法, 活跃趋势拟合, 多项目占比聚合)
     │
     ▼
[Shared 通用契约] (i18n 双语字典, 数据类型定义, 崩溃安全快照 DTO)
```

**架构红线**：
- 底层模块（Storage / Engine）严禁反向引用上层 UI 模块或 VS Code 窗口 API；
- 核心算法保持纯粹的数据输入与数据计算，具备 100% 独立于 VS Code 宿主的单元自测能力。

---

## 三、 RingBuffer + Journal 追加写崩溃安全与数据折叠

为实现“毫秒级无感记录 + 意外崩溃零丢失”，扩展实施分层缓冲防线：

### 1. 内存零延迟与磁盘实时追加
1. **内存零延迟缓存 (RingBuffer)**：秒级时间片增量仅在内存中聚合，避免频繁磁盘 I/O 导致编辑器掉帧；
2. **轻量追加日志 (Journal NDJSON)**：每隔固定心跳将增量片段以单行追加形式写入本地日志文件，编辑器异常崩溃或系统断电时，下次启动时可即时无损回放（Replay）；
3. **全量快照降频同步**：由 `StorageCoordinator` 级联管理，常规状态降频同步至 VS Code 全局状态与本地 JSON 备份；危险操作（重置、清除）前强制写入前置安全快照。

### 2. 有界内存与智能滚动折叠 (`HistoryFolder`)
为防止长期运行导致内存膨胀，实施严格的时长守恒折叠策略：
- **单日条数保护**：单日内会话记录超过 20 条时，超出部分按 FIFO 淘汰并自动沉淀至 `dailyTotals` 日汇总桶；
- **跨周自动归档**：历史旧周会话自动移出活跃序列并合并入日桶，当周活跃会话完整保留；
- **守恒定理**：折叠后保留序列与日汇总桶的总工时严格恒等于原始全量会话总和。

---

## 四、 UI 100% 双语字典与暗色对比度视觉契约

1. **100% 双语字典覆盖**：
   - 界面文案必须通过 `i18n.t(key)` 提取，严格在 `src/i18n/locales/zh-CN.json` 与 `en.json` 中双向对齐；
   - **一票否决**：严禁在 HTML 模板、TS 逻辑或弹窗中使用硬编码中英文；严禁向用户暴露底层存储术语（如 RingBuffer、NDJSON 等内部技术实现）；
2. **暗色高对比度视觉契约**：
   - 面板样式所有色彩必须通过 `:root` 声明的主题 CSS 变量（`var(--vscode-*)`）驱动；
   - SVG 图标与活跃折线图刻度文字强制使用纯白 `#ffffff` 或主题适配变量，严禁默认回退为暗黑色文字（导致在深色主题下不可见）。

---

## 五、 极速构建与审查规则单源登记

1. **极速构建契约**：
   - `tsconfig.json` 必须保持 `"declaration": false` 与 `"isolatedModules": true`，杜绝类型声明文件生成带来的无谓构建开销；
2. **审查规则单一真源**：
   - 扩展内部审查规则（L0~L5 六层权重）单一真源登记于 `workspace-timing/scripts/config/review-rules.json`；
   - 严禁在脚本中发射未在注册表中登记的规则标识符。

---

## 六、 专属构建、测试与审查命令矩阵

在 `workspace-timing` 目录中作业时，遵循以下执行步骤：

```bash
# 进入项目目录
cd workspace-timing

# 1. 极速增量编译 TypeScript
npm run compile

# 2. 运行快速单元测试套件（90+ 用例，包含折叠/聚合/i18n契约）
npm run test:fast

# 3. 运行扩展 L0~L5 六层权重审查门禁
npm run review

# 4. 同步 Webview 静态资源
npm run sync
```
