---
name: workspace-timing-dev
description: >-
  workspace-timing VS Code 计时扩展五层架构解耦、双写崩溃安全与双语字典规范。
  指导 Agent 在 workspace-timing 项目中维护时间聚合核心、RingBuffer 与日志追加崩溃防护、
  规范化命名（stagingUri、segmentedSessions、[DELTA]）、100% 双语国际化（zh-CN/en）、
  暗色高对比度 UI 以及与全仓双层同构门禁的深度对接。
---

# workspace-timing-dev — VS Code 扩展五层架构与崩溃安全研发规范

本技能规范了 `workspace-timing/` 扩展的五层解耦架构、高可靠内存与磁盘双写崩溃安全体系、命名规范化、双语国际化、视觉对比度契约以及与全工作区双层同构门禁的深度对接。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **修改核心计时或数据聚合引擎**（`TimerEngine.ts`、`TimeAggregator.ts`）；
2. **重构多级持久化存储、崩溃安全双写与日志回放逻辑**（`StorageCoordinator.ts`、`HistoryFolder.ts`、RingBuffer、Journal）；
3. **新增或调整仪表板 Webview UI 或状态栏控制器**（`dashboard.html`、`StatusBarManager.ts`）；
4. **新增用户界面提示、命令文案或设置选项**（双语字典严格覆盖）；
5. **维护内部审查规则与全仓门禁对接**（`workspace-timing/scripts/config/review-rules.json`、`scripts/review.js`）。

---

## 二、 五层架构解耦与单向依赖契约

项目严格划分为五大架构层次，依赖必须保持严格的自顶向下单向流动：

```text
[UI 表现层] (Webview Dashboard, Status Bar Manager, Modal Dialogs)
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
- 底层模块（Storage / Engine / Analytics / Shared）严禁反向引用上层 UI 模块或 VS Code 窗口 API；
- 核心算法保持纯粹的数据输入与数据计算，具备 100% 独立于 VS Code 宿主的单元自测能力。

---

## 三、 RingBuffer + Journal 追加写崩溃安全与数据折叠

为实现“毫秒级无感记录 + 意外崩溃零丢失”，扩展实施分层缓冲防线：

### 1. 内存零延迟与磁盘实时追加
1. **内存零延迟缓存 (RingBuffer)**：秒级时间片增量仅在内存中聚合，避免频繁磁盘 I/O 导致编辑器掉帧；
2. **轻量追加日志 (Journal NDJSON)**：每隔固定心跳将增量片段以带有 `[DELTA]` 标识前缀的单行追加形式写入本地日志文件；编辑器异常崩溃或断电时，下次启动可即时无损回放（Replay）；
3. **全量快照降频原子写入**：由 `StorageCoordinator` 级联管理，写入前先落盘至 `stagingUri` 暂存文件，完成完整性核验后再执行原子重命名替换；危险操作（重置、清除）前强制写入前置安全快照。

### 2. 有界内存与智能滚动折叠 (`HistoryFolder`)
为防止长期运行导致内存膨胀，实施严格的时长守恒折叠策略：
- **单日条数保护**：单日内会话记录超过 20 条时，超出部分按 FIFO 淘汰并自动沉淀至 `dailyTotals` 日汇总桶；
- **跨周自动归档**：历史旧周会话自动移出活跃序列并合并入日桶，当周活跃会话完整保留；
- **守恒定理**：折叠后保留序列与日汇总桶的总工时严格恒等于原始全量会话总和。

---

## 四、 生产命名规范化与跨日会话原子切分

### 1. 统一生产命名契约
- **`stagingUri`**：磁盘写入与快照原子替换时的专用暂存 URI，禁止使用模糊的 `tmpPath` 或 `tempUri`；
- **`segmentedSessions`**：跨自然日切分或滚动折叠后的标准会话片段序列，替代歧义的 `sessions` 或 `splitSessions`；
- **`[DELTA]`**：日志追加与事件广播中的增量数据行前缀标记，供 Journal 日志回放器精确识别增量数据行。

### 2. 跨自然日会话切分与休眠恢复
- 系统挂起、休眠唤醒（`resumeFromSleep`）或意外恢复时，若运行区间跨越自然日边界，严禁将多日时长作为单段长会话直接封存；
- 必须通过 `TimeAggregator.splitByNaturalDay(startMs, endMs)` 将跨日会话原子拆分为各自然日的 `segmentedSessions` 片段，分别封存并保证时长守恒；
- 会话封存时，仅将归属于当前自然日的片段累加至今日计数器，非本日片段不得污染今日活跃统计。

---

## 五、 UI 100% 双语字典与暗色对比度视觉契约

### 1. 100% 双语字典覆盖
- 界面文案必须通过 `i18n.t(key)` 提取，严格在 `src/i18n/zh-CN.ts` 与 `src/i18n/en.ts`（及扩展清单 `package.nls.json` / `package.nls.zh-cn.json`）中镜像双向对齐；
- **一票否决**：严禁在 HTML 模板、TS 逻辑、状态栏提示或弹窗中使用硬编码中英文；
- 严禁向用户暴露底层存储术语（如 RingBuffer、NDJSON、dailyTotals 等内部技术实现）。

### 2. 暗色高对比度视觉契约
- 面板样式所有色彩必须通过 `:root` 声明的主题 CSS 变量（`var(--vscode-*)`）驱动；
- SVG 图标与活跃折线图刻度文字强制使用纯白 `#ffffff` 或主题适配明亮变量，严禁默认回退为暗黑色文字（导致在深色主题下不可见）；
- 严格遵循 WCAG AA 级以上色彩对比度标准。

### 3. 产品交付物与工程日志严格隔离契约
- 面向用户的扩展 `README.md` 严格定位为商用级产品发布展示页，严禁平铺开发路线图与内部施工标记；
- 面向用户的 `CHANGELOG.md` 严格以用户价值与体验提升为导向，绝对严禁泄露内部架构重构黑话（如消融单行跳板、RingBuffer崩溃安全、AST切片局部复杂度等工程治理术语）。

---

## 六、 全仓双层同构门禁深度对接与审查规则

`workspace-timing` 深度融入全工作区的 Tier 1 本地左移与 Tier 2 远端同构门禁：

### 1. 门禁分流调度与对应指令
当修改触及 `workspace-timing/**` 路径时，门禁系统触发三阶递进校验：
1. **增量极速编译**：`npm run compile`（严格基于 `tsconfig.json` 的 `isolatedModules` 与无 `declaration` 快速发射）；
2. **单元测试与回归套件**：`npm run test:fast`（执行 145 项单元测试，重点看守会话折叠、跨日切分、时长守恒与崩溃回放）；
3. **专有规则审查门禁**：`npm run review`（执行 `scripts/dist/review/run-review.js` 检查 L0~L5 六层共 49 条规则）。

### 2. 49 条审查规则单一真源对齐 (SSOT)
- 审查规则单一真源登记于 `workspace-timing/scripts/config/review-rules.json`，并自动聚合至全仓 `scripts/common/rule-catalog.json`；
- 规则严格划分为六层前缀：
  - `L0-COMPILE`：代码必须 100% 编译通过；
  - `L1-STORAGE-CRASH`：原子替换、快照前置与崩溃安全防护；
  - `L2-TIMING-CONSERVATION`：跨日拆分与时长守恒契约；
  - `L3-I18N-COVERAGE`：中英文双语字典 100% 镜像与硬编码字面量拦截；
  - `L4-PERF-RESOURCE` / `L4-TEST-BUDGET`：定时器无泄漏清理、高频循环零瞬态堆分配与测试耗时基准预算（`TB-REGRESSION`）；
  - `L5-UI-CONTRAST` / `L5-REFACTOR`：主题 CSS 变量驱动、暗色高对比度视觉合规与重构适配；
- 严禁在审查脚本或提交说明中发射未在规则库登记的规则代号；
- 核心源码文件受单文件双轨体积（$\text{ELOC} \le 900 / \text{LOC} \le 1400$）、1:3 动态反推包络与高负荷逻辑（$\text{ELOC} \ge 600$）注释密度 $\ge 8\%$ 约束，模块入口首行必须规范呈现六字段 JSDoc 架构契约与算法不变式；
- 全工作区 High/Critical 技术债务历史性归零（0 项），新增改动与重构严禁引入任何技术债务反弹（一票否决）。

---

## 七、 专属构建、测试与审查命令矩阵

在 `workspace-timing` 目录中作业时，遵循以下执行步骤：

```bash
# 进入项目目录
cd workspace-timing

# 1. 极速增量编译 TypeScript
npm run compile

# 2. 运行快速单元测试套件（145 项用例，包含折叠/聚合/i18n/双轨工时契约）
npm run test:fast

# 3. 运行扩展 L0~L5 六层权重审查门禁（49 规则看守）
npm run review

# 4. 同步 Webview 静态资源
npm run sync
```
