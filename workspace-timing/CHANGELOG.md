# Changelog

## [0.3.5] — 2026-08-12

### Added
- **周报体系完善**：
  - 新增「导出周报」（Markdown）：本周总时长、日均（按本周至今天数）、达标天数（对比每日目标）、本周效率（附"仅本次会话内可信"标注）、每日明细表、与上周对比（环比）。经 `showSaveDialog` 存为 `.md`；中英文面板同步
  - 「周报」面板与柱状图对齐**自然周**（本周一 → 今日），标题下增加周范围副标题（如 `08-10 ~ 08-12（本周）`）；中英文面板同步实现
  - CSV 导出改用自然周每日明细（原为「近 7 天」滚动窗口，与"本周"口径不一致），并修复 `exportDashboard` 的 `Generated` 时间戳误用 `toISOString()`（UTC），改为本地时区

### Changed
- 面板每日统计底层由 `last7Days` 切换为 `weekDailyBreakdown`（自然周口径），移除废弃的 `last7Days` / `last7DaysFromFinished`；`TimeAggregator` 新增 `weekDailyBreakdown(fullWeek)` 与 `lastWeekMs`（上一自然周）
- 本周效率分母与「本周合计」口径一致（均为本周一 → 现在），修复此前"效率按 7 天、周合计按自然周"的错配

## [0.3.4] — 2026-08-12

### Added
- **跨工作区面板可折叠**: 「🌐 跨工作区」标题改为可点击折叠头，点标题收起/展开整个列表；折叠状态经 `localStorage` 记忆（`wt-global-collapsed`），重开面板保持上次状态
- **跨工作区长列表 Top N + 展开全部**: 工作区数量超过 10 个时仅显示前 10 条并附「展开全部（N）」按钮，点击展开全部后按钮变为「收起」，避免长列表刷屏；中英文面板同步实现

### Changed
- 版本号由 0.3.2 补正至 0.3.4（0.3.3 提交遗漏 `package.json` 版本自增，本次一并补齐）

## [0.3.3] — 2026-08-12

### Fixed
- **进行中会话边界丢失（持久化根因）**: `saveCheckpoint()` 此前把 active 会话时长折叠进 `totalMs` 并清零 `currentSessionStartMs`，导致进行中会话的真实起始日无法存续到磁盘。一旦窗口未走 `stop()`（崩溃 / 强杀 / 扩展卸载竞态）即丢失，重载后 `sessions` 为空、`今日=本周` 退化、昨日时长不计入图表。现改为：`totalMs` 恒等于「已结束会话」累加和（权威源），`currentSessionStartMs` 原样保留，进行中会话由 `TimeAggregator` 在今日/本周交集计算时叠加
- **重载不收尾活跃会话**: `recover()` 此前仅把未完成会话时长累加进 `totalMs` 后清零边界，从不生成 `TimeSession`，导致崩溃恢复后「会话数」恒为 0、按日归并缺失。现改为边界优先——将活跃会话收尾为 finished `TimeSession` 并入 `sessions[]` 与 `totalMs`；journal 回放仅在无边界时兜底，并合成一条 finished 会话，杜绝重复计
- **跨午夜进行中会话无按日记录**: 新增 `TimerEngine.splitAt(splitMs)`，由 `SessionManager.saveCheckpoint` 在每次全量存盘前检测午夜跨越并切分进行中会话，使每个自然日都拥有独立 `TimeSession`，日报/周报每日柱子精确反映当天时长
- **首个全量存盘前崩溃丢会话**: `startSession()` 在 `timer.start()` 后立即 `saveCheckpoint()` 持久化边界，确保即便在首个 60s 全量存盘前崩溃，recover 也能凭边界收尾该会话

### Changed
- **计时口径契约**: 自 0.1.x 的「零边界防翻倍」方案，调整为「边界存续 + 边界优先收尾」方案，在消除重复计的同时修复归属丢失（详见 StorageCoordinator / SessionManager 注释）

## [0.3.2] — 2026-08-12

### Fixed
- **跨午夜已结束会话按日错算**: `todayMs` / `last7Days` 此前把「跨午夜的已结束会话」整段时长计入其起始日，导致当日/近 7 天数值虚高、跨日部分丢失（活跃会话此前已修复，已结束会话未修复）。现统一改用「会话区间与目标日窗口交集」计算，与 `thisWeekMs` 口径一致
- **闲置检测形同虚设**: `IdleDetector.lastActivityMs` 被写入却从未读取（死代码），且闲置仅在「失焦→重新聚焦且超时」时判定，聚焦但长时间不操作（阅读/思考）不会被计入。现改为每秒心跳驱动判定，聚焦态下距上次活动超时即判定为闲置（回溯至最后一次活动时刻起算）
- **关闭流程未等待落盘**: `deactivate()` 为同步调用、`orchestrator.stop()` 未被 await，窗口关闭/扩展卸载时最后一次写可能丢失。现改为 `async deactivate` 并 `await` 优雅存盘
- **CSV 导出时区不一致**: `CsvExporter` 会话起止时间使用 `toISOString()`（UTC），与全局「按本地日期统计」口径冲突。现改用本地时区格式化
- **配置应用无异常兜底**: `ConfigWatcher` 的配置变更回调缺少 try/catch，单条配置异常会冒泡为未捕获异常阻塞其他监听器。现补充异常捕获

### Changed
- **LifecycleManager**: `onVSCodeClose` 此前从未被任何事件触发（死代码），现由 `deactivate()` 经其执行 await 优雅存盘

### Perf
- **JournalStorageProvider 写入**: 每次 flush 都 readFile 整份 journal → 拼接 → writeFile 整份（O(文件大小)，多次叠加为 O(n²)）。现维护与磁盘内容等价的「内存镜像」，doAppend 仅做内存拼接后整写，不再每次回读磁盘
- **Scheduler 热更新**: `updateIntervals` 此前「无脑重建全部 4 个定时器」，改个无关配置也会打断所有定时器相位。现仅重启间隔真正变化的定时器
- **聚合计算去重**: `SessionManager` 新增「已结束会话按日分桶」结果缓存，仅在会话列表变化时重建；状态栏与面板每次刷新只需叠加当日活跃增量，消除重复 O(n) 扫描（`last7Days` 改为单次遍历分桶，避免 7×O(n)）

## [0.3.1] — 2026-06-25

### Fixed
- **本周卡片数值耦合今日**: `weekTotalMs` 原为 `sum(last7Days)` 派生值，任何历史日 session 丢失即退化为今日值。改为独立 `thisWeekMs()` 累加器，直接按周一 00:00 截断计算，与今日、累计并列为三种独立计数器
- **柱状图全部柱子同步缩放**: 差分路径原更新全部 7 根柱——今日值增长导致 `maxVal` 变大，历史柱同比缩小。改为仅更新今日柱（最后一根），历史柱高度锁定。比例尺 `_cachedMaxVal` 仅在日期变化时重算
- **跨午夜新日柱子不可见**: 新天值远小于历史 max → 百分比高度被 `Math.max(…, 2)` 钳制为 2px。改为 `calcBarPct()` 取 `max(pct, 4)` + 比例尺下限 `DAILY_CAP_MS`(8h) 确保小值日有可辨识柱高
- **差分更新逻辑名不副实**: 注释写"仅更新今日柱"但代码更新全部柱子 → 修正为 `todayIdx` 单柱更新
- **Dashboard 命令不可用**: `_getHtml()` 路径多嵌套一层 `'presentation'` → 运行时 `__dirname` 已是 `out/presentation/`，再加子目录导致 `ENOENT`。移除冗余的 `'presentation'` 参数

### Changed
- Dashboard 柱状图 CSS `min-height` 保持不变（2px），JS 层 `calcBarPct()` 接管最小值控制
- `weekEfficiency` 计算改用 `chartSumMs`（7 日柱状图合计），与 idle/active 数据时间范围一致

## [0.3.0] — 2026-06-24

### Added
- **闲置检测**: 窗口失焦超时自动计为离开，效率 = 打字/(总长-闲置)（`idleTimeoutMinutes`）
- **每日目标**: 设定目标时长，达成桌面通知 + Dashboard 进度条（`dailyGoalMinutes`）
- **诊断系统**: Logger 环形缓冲区 → Dashboard 一键导出诊断报告（日志+配置+统计）
- **配置热更新**: Dashboard/VS Code 设置变更即时生效（Scheduler.updateIntervals）
- **双语支持**: Dashboard 🌐 按钮切换 + `package.nls` 命令双语 + toast 双语
- **状态栏点击**: 可配切换模式 / 打开面板（`statusBar.clickAction`）
- **HTML 抽离**: Dashboard 从 837 行 TS 模板 → 独立 `dashboard.html` + `dashboard.en.html`

### Fixed
- Reset 命令死链（storage=null）
- 全链审查：清除死代码（unused methods/ICacheStrategy/lint warnings）
- `DailyChartEntry` 补齐 `dateStr` / 参数命名修正
- Toast 硬编码字符串 → i18n 迁移

## [0.2.0] — 2026-06-24

### Added
- **CSV 导出**: Dashboard 按钮一键导出会话记录 + 每日统计 + 效率数据
- **效率追踪**: 监听编辑活跃度，计算实际打字时间 ÷ 计时器时长 = 工作效率比（可开关 `workspaceTiming.efficiency.enabled`）
- **周报效率**: 柱状图每根柱子标注效率百分比，本周汇总效率
- **配置常量化**: 所有硬编码数字/时间间隔抽离至 `models.ts` 统一管理（`MS_PER_SECOND` 等 8 个常量，`localDateStr` 去重）

## [0.1.1] — 2026-06-23

### Fixed
- **屏闪**: 状态栏每秒冗余 `.show()` → 仅文本变化时更新；心跳计时 (1s) 与 UI 刷新 (5s) 解耦；存储文件从 `.vscode/` 移至 `.workspace-timing-data/`
- **数据丢失**: `saveCheckpoint()` 后截断 journal，防止文件无限增长导致扩展主机崩溃
- **计时翻倍**: 持久化时置零 `currentSessionStartMs`，防止崩溃恢复 Step 3 重复补偿
- **时区**: 全部日期计算从 `toISOString()`(UTC) 改为 `localDateStr()`(本地)，解决中国 UTC+8 日期错位 + 柱状图仅显示周五
- **跨日拆分**: 活跃会话按午夜自动拆分到每日（`activeSessionMsOnDate`），解决连续运行多日时今天显示 0
- **崩溃保护**: 面板更新/newPeriod/reset 3 处未处理 Promise 追加 `.catch()`
- **柱状图优化**: 差分更新（指纹比对），仅跨日时重建 DOM
- **关闭存盘**: `deactivate()` 中 `journal.truncate()` 改为 `await`

## [0.1.0] — 初始版本

- 工作区自动计时 / 状态栏实时显示 / Dashboard 面板 / RingBuffer+Journal 双写入 / 崩溃恢复 / 全局禁用策略 / 中英文支持
