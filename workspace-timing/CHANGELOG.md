# Changelog

## [Unreleased]

### Engineering Infrastructure（工程基础设施）
- **配置边界单一真源（双真源漂移收敛）**：`models.ts` 新增合法域常量与净化器（ringBuffer [64,65536] / journalFlush [1000,300000] / fullSave [5000,600000] / retention [0,3650] / maxSessions ≥0 / weeklyLimit [1,168]），ConfigWatcher 与 Scheduler 热更新路径统一接入（含上界钳制与枚举漂移回退）；新增 ConfigBounds 单测套件（11 项断言，含与 package.json contributes 三方一致的防漂移回归）；fullSaveInterval 热更新下界由 1000ms 收紧至 5000ms（与 UI 契约一致）；移除从未被消费的 `workspaceTiming.cloudSync.provider` 死配置
- **文本布局门禁 L3-DOC-LAYOUT**：CHANGELOG 布局契约机器化（DOC-CL-001 Unreleased 节存在 / 002 版本头格式与降序 / 003 与 package.json 版本同步 / 004 分类标题标准表 / 005 列表粗体导语 / 006 日期合法不超前）+ README 必需节与路线图版本同步（DOC-RD-001/002）；eslint 覆盖扩展至 scripts/（no-tabs/trailing/eol 卫生规则）；变更日志全部历史条目补齐粗体导语
- **打包内容收口**：`.vscodeignore` 排除本地审查缓存（`.auto-refactor-cache*/`、`.bench-corpus*/`、`.corpus*/`）与 `**/*.tsbuildinfo`——此前实测发布包混入 ~820KB 内部审查缓存；根目录遗留的 0.4.5/0.4.6/0.4.7/0.4.9 四个 vsix 归位统一 `dist/<扩展名>/` 布局
- **审查注册表清理**：退役的本地 perf-patterns 检查器残留配置段（`perfPatterns`，无消费者）移除，注册表升版 v7；本地孤儿产物 `scripts/dist/audit/perf-patterns.js` 删除

## [0.4.9] — 2026-09-05

> 注：0.4.8 编号跳过（未发布），本版直接自 0.4.7 升级。

### Engineering Infrastructure（工程基础设施）
- **引擎 0.3.0 第四批：治理反模式规则内化 + WebGames 桥接实证**：governance 新增 GOV-PRF-003（定时器字面量，error）/GOV-PRF-004（同步 IO 阻塞宿主，warning）——本地 L4 perf-patterns 检查器退役（引擎覆盖同语义，注册表 v4）；GOV-PRF-004 正则缺陷由自检夹具暴露（动词+Sync 拼接式正则匹配不上 readFileSync，改显式 API 名枚举）；后置管线收敛为 finalizeReport 后程序化 scan() 与 CLI 行为一致；suppress 按 analyzer 预索引；**WebGames 桥接脚本在 0.3.0 引擎上实测通过（bridge exit 0，向后兼容确认）**；GOV-PRF-001 对 NDJSON 逐行回放的误报以带理由豁免降级记录（规则局限可见）
- **算法提效 + 引擎 0.3.0 第三批内化**：L1 eslint 增量缓存（冷 1.9s→暖 1.1s）、L0 tsc incremental（1.25s→0.61s 暖态，编排器内部 3083→2516ms）；引擎新增 secrets 内建分析器（token 特征默认开、高熵检测可选防 vendor 噪声）、unused-export/unused-module 检测（post-scan 依赖图段，entryGlobs 入口白名单兼容无扩展名 graph key）、`self-test` 子命令（已知违规夹具断言全部内建分析器命中——本批即靠它暴露"程序化 scan() 绕过后置管线"的架构缺口，管线随之收敛为 finalizeReport 使 scan/CLI 行为一致）；全链 10 检查器 PASS，新分析器发现全部入棘轮基线（222 条存量 + secrets 零命中）
- **算法硬化与性能修正（第三轮，夹具测试驱动）**：环注入端到端测试暴露三色 DFS 两处同型缺陷——外层起点与内层邻接的未访问缺省均误取 BLACK 导致整轮遍历被跳过（引擎 findImportCycles 与本地 layer-boundary 各一处，已修复并写入自检夹具 LAY-CYCLE 用例永久看守）；循环依赖 pass 改迭代帧栈（万节点深链无栈溢出）并按实测采用混合读盘策略（≤500 文件同步快路径，更大仓库并行窗口，36 文件实测开销 24ms→10ms）
- **审查能力上移引擎（auto-refactor 0.2.0 双向泛化）**：经批准将本项目 adapter 层验证过的四项能力泛化进引擎——带理由声明式豁免（matchFile/Analyzer/Rule/Symbol + downgradeTo，报告留痕不静默）、棘轮分组粒度（grouped：分析器|规则|文件 计数，行漂移免疫）、分级 gate `--fail-on-severity`（布尔 failOnIssue 的泛化，基线存在时仅对新增判定）、dependency-graph 内建分析器（post-scan 全局循环依赖 + 可选分组导入规则，detectCycles 默认关闭不改变既有消费者门禁结果）；本项目 adapter 相应瘦身（本地豁免匹配与棘轮计数代码删除，改为消费引擎 isNew/suppression 标注），豁免清单迁移至工具配置；引擎自带 equivalence/governance/diff 三套回归全绿
- **脚本库整体迁移 TypeScript**：18 个脚本全部 `.mjs` → `.ts`（NodeNext + strict，JSON 边界经配置契约类型收窄）；独立 `scripts/tsconfig.json` 编译到 `dist/` ESM 镜像（子包 `{"type":"module"}`，与根包 commonjs 隔离）；`npm run review*` 先构建后运行——审查工具构建链与业务编译链完全独立，保持自举安全；新增悬空源文件运行时守卫（增量构建残留旧产物不可再静默执行）；注册表升版 v3
- **审查系统自规范化升级（第二轮）**：新增 L1 代码质量检查器（eslint 结构化纳入门禁，六层规则模型补齐）；auto-refactor 存量债务棘轮（按分析器|规则|文件分组比对基线，仅新增发现阻断，"存量只许消化不许增长"）；编排器信封身份与发现契约校验、`--changed` 定向扫描（git 变更保守映射）、stage2 结果复用（测试套件单轮只执行一次）；元审查新增跨检查器规则 ID 归属冲突检测与 `@origin` 头契约强制
- **自动化审查系统落地**：新增 `scripts/` 标准化脚本库（common 原子能力层 + 9 个分级检查器 + 编排器 + Quality Gate），`npm run review` 一键审查，`reports/review/report-latest.{json,md}` 结构化报告；规则注册表/适配器配置/工具配置三类分离
- **auto-refactor 外部审查能力接入**：经 `scripts/tooling/refactor-adapter.mjs` 单点适配（仅依赖稳定 CLI 契约与 ScanReport schema），路径/超时/阈值/豁免全部配置化；工具缺失/崩溃/超时优雅降级（NOT_AVAILABLE/TIMEOUT 显式留痕），输出损坏 fail-closed 阻断；外部项目零污染、可替换
- **审查规则分层成文**：L0 编译测试 / L2 依赖矩阵+循环依赖 / L3 硬编码分类·脚本规范·元审查 / L4 确定性性能模式+测试时长预算 / L5 重构审查；规则 ID 全库唯一命名空间（LAY-/HC-/SCR-/RCFG-/PERF-/TB-/ARF-）
- **元审查机制**：孤儿/悬空检查器双向阻断、规则声明↔实施双向核对、依赖矩阵路径存在性、夹具自检（`npm run review:selftest`）——审查系统自身失效不可能静默 PASS
- **首战战果**：审查系统上线即检出并修复 1 处 i18n 拼接绕过（restore 错误提示），并沉淀 4 项已评审接受的复杂度债与空 catch 惯例的带理由豁免清单

### Performance & Optimization（性能与开销优化）
- **激活事件现代化**：`activationEvents` 从全星号 `*` 改为 `onStartupFinished`，窗口启动不再被扩展激活阻塞（计时行为不变，启动后立即开始），消除对 VS Code 首屏加载的性能拖累
- **设置项生效**：`statusBar.format`（compact/detailed，从未被消费的失效配置）重构为 `statusBar.mode`（today-total/total-today/compact）；状态栏初始模式随设置生效，点击循环切换后自动持久化，重载窗口后保持用户选择

### Refactoring（架构与解耦）
- **集成层窄端口化**：`ConfigWatcher` 不再依赖 `TimerOrchestrator` 具体类，改经消费方定义的 `RuntimeConfigPort` 端口（单一 `applyConfig` 入口）注入配置热应用，门面内部结构（禁用策略/调度器/会话上限）对集成层封闭
- **面板 DTO 组装器抽离**：新增 `DashboardDataAssembler` 纯函数组装器，`TimerOrchestrator` 只负责快照采集；周报趋势拼装在面板与导出两条路径去重共用，门面瘦身约 110 行
- **移除 `LifecycleManager` 空壳**：无任何行为、无测试的预留脚手架整体删除，激活/停用路径同步清理
- **只读契约深化**：`TimerEngine.data` 视图的 sessions 冻结为 `ReadonlyArray`（编译期）并 `Object.freeze`（运行期），内部改为"替换式演进"；TimeAggregator/HistoryFolder 纯函数签名同步接受只读入参，越权突变在编译与运行双重被拒
- **排序不变量固化**：`DataValidator` 对还原文件会话按起始时间升序排序——`weeklySummary` 逆序提前退出与折叠 FIFO 溢出语义所依赖的有序输入不再信任外部文件
- **存储协调器纯化**：`StorageCoordinator.save` 以副本盖时间戳，不再原地改写调用方入参；`FileStorageProvider` 改为"临时文件 + rename"原子写，崩溃不再产生半截 JSON 备份

### Fixed（缺陷修复）
- **注释与实现漂移修正**：`TimeAggregator.todayMs` 注释声称的"逆序扫描 + break 提前退出"与正向实现不符，且该优化对乱序输入是正确性隐患——按真实语义重写注释（正向粗筛 + 3s TTL 抑制）
- **i18n 收口**：补齐全部硬编码用户可见文案——手动存盘结果（saveNow）、还原失败提示、Webview 面板标题、`<html lang>` 随界面语言、导出对话框文件过滤器（原中英混用）；`newPeriod` 面板路径改为编排完成后提示，与 reset 时序一致

### Removed（死代码清理）
- **删除生产无引用的 `TimerEngine.trimSessions`、`TimeAggregator.sumSlices/mergeJournal`、`SizeBasedCacheStrategy/HybridCacheStrategy`、`DisableManager.onChange`、`Scheduler.saveNow` 与扩展入口的空事件订阅**

### Tests（测试增强）
- **新增 Scheduler 套件（9 项）**：心跳推片、全量存盘节拍、间隔钳制与热更新、journalEnabled 旁路、休眠恢复检测、跨午夜轮转、stop 清理、flush 失败不中断循环（覆盖率 48% → 98%）
- **新增 StorageCoordinator 套件（9 项）**：降频级联、强制备份、无副作用边界、load 兜底优先级、restore 截断、deleteAll、安全快照、部分失败不阻断（覆盖率 0% → 91%）
- **新增 TimerEngine 只读视图冻结语义回归**；113 项单测全部通过

## [0.4.7] — 2026-08-29

### Performance & Optimization（性能与开销优化）
- **多周趋势窗口化轻量聚合**：重构 `TimeAggregator.weeklyTrend` 为有界窗口聚合算法（$O(\text{weeks} \times 7)$ 查表与会话粗筛），彻底剔除对全生命周期跨年历史数据生成完整序列与 $O(N \log N)$ 排序的冗余开销，单次面板刷新聚合计算耗时从毫秒级降至亚毫秒级（<0.02ms）
- **历史折叠引擎零拷贝快退**：为 `HistoryFolder.foldExpiredSessions` 增加空会话与无超限零分配快路径，空闲周期执行无额外对象创建开销
- **会话粗筛与热点路径优化**：在 `todayMs`、`last7Days`、`dailyDetail`、`heatmapDays`、`weeklySummary` 等高频聚合方法中统一引入时间窗提前过滤守卫，跳过不相交的历史区间，大幅削减垃圾回收（GC）压力

### Fixed（缺陷修复）
- **持久化配置系统生效**：修复面板与命令修改设置未持久化写回 VS Code settings.json 导致窗口重载后配置失效的问题；实现 `persistTimingConfig` 全量双向持久化桥接服务，支持重载窗口与重启 IDE 配置 100% 保持
- **周上限达标点等比缩放与居中偏右（75%）分割线**：重构多周趋势轨道刻度算法，设定基准达标点处于 75% 黄金分割区，预留 25% 超限缓冲视觉空间；未超限时分割线恒定居中靠右（75%），超限时进度条等比向右延伸并深红外发光，彻底解决红线被挤压在 100% 边缘的不协调问题

## [0.4.6] — 2026-08-28

### Fixed（缺陷修复）
- **崩溃恢复双重计数修复（核心）**：跨午夜轮转与休眠恢复后发生崩溃时，封存段时长会被 journal 回放再次累加（昨日/休眠前时长虚高翻倍）。现于轮转/恢复落盘时推进 journal 回放水位线（`metadata.lastJournalTs`），恢复仅回放边界后的新会话段增量，封存段只计一次
- **Journal 失败回退时序颠倒修复**：journal 追加失败回退缓冲时按倒序 push，导致时间片顺序反转、恢复分组误判断点；现改为正序回退，保持切片时序
- **覆盖度量口径修正**：c8 覆盖率从仅 domain 层放宽到全部源码层（真实行覆盖 43.07%），崩溃恢复/会话编排/存储协调等核心风险层纳入度量

### Tests（测试增强）
- **新增「跨午夜轮转 → 崩溃 → 重启恢复不双计」端到端回归测试**（真实 RecoveryService + 可回放 journal）
- **轮转/休眠用例补充 journal 水位线持久化断言**（当前 93 项单测全部通过）

## [0.4.5] — 2026-08-28

### Added（新功能）
- **周工作上限设置模块**：支持自定义每周工作时长阈值（1~168 小时，默认 40h，默认不开启），可在 VS Code 设置或面板「基本设置」中快捷配置
- **现代化动态渐变进度条 & 阈值分割线**：多周趋势栏中在阈值对应位置渲染发光红色分割线；进度条采用多阶动态渐变色彩（安全区青蓝、临近区琥珀橙向珊瑚红平滑过渡、超限区深红霓虹外发光），时长数值同步变色
- **超限健康休息提醒**：当本周工作时长首次超过设定上限时，弹出 VS Code 警告提醒劳逸结合，每周仅提醒一次防重复打扰
- **多周趋势截止日期标注**：趋势栏日期范围由单一起始日期升级为完整周期区间（如 `08-24 ~ 08-30`）
- **双阈值无损自动回收机制**：支持时间窗（`retentionDays`）与条数容量（`maxSessions`）双重约束，溢出会话自动先进先出（FIFO）按自然日沉淀折叠入 `dailyTotals`，彻底废除暴力丢弃，保障全历史工时与会话数严格守恒

### Fixed（缺陷修复）
- **全历史会话数口径统一**：面板顶部“会话数”统一聚合 `dailyTotals` 沉淀层会话数、未折叠会话数与进行中会话，解决长期使用后总会话数统计虚低问题
- **跨午夜今日概念漂移**：长久运行跨越午夜（00:00:00）时，自动将会话封存入昨日并将今日计时起点重置为今日零点，对齐 OS 系统时间
- **系统休眠/挂起恢复防时钟跳变**：检测休眠时钟突变（>15s），休眠期间时长不计入工作工时
- **周工时上下界与非法输入过滤**：全链路对周上限时长进行校验与钳制（1~168h，非法值/NaN 自动安全回退）
- **跨周自然日精确切分与隔离**：重构周报与周上限计算底层，跨周日界（周日 23:00~周一 02:00）的会话按自然日拆分，历史周工时绝不误计入新一周

## [0.4.4] — 2026-08-26

### Added（新功能）
- **按小时分布 X 轴刻度**：今日「按小时分布」柱状图新增 24 格刻度行（与柱状图逐格对齐，每 4 小时标注一次：00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00），每根柱可直观对应具体小时；无数据时刻度随图表一并隐藏

## [0.4.3] — 2026-08-26

### Added（新功能）
- **界面语言显式切换**：面板「基本设置」新增语言下拉框（自动 / 中文 / English），选中立即热生效（i18n 词条切换 + 面板自动重建）；`DashboardData` 透传 `locale`，消息路由接入 `setLocale` 与面板重建链路

### Fixed（缺陷修复）
- **图表切换残留帧**：由柱状图切到活跃曲线时，旧柱状图需等下一轮数据刷新才隐藏（最长 5 秒同屏闪烁）；现切换瞬间立即隐藏柱状图/空态/周合计
- **活跃曲线非光滑**：曲线由 36 根柱状条改为 SVG 光滑曲线（Catmull-Rom→三次贝塞尔 + 面积填充），峰值圆角、空闲段自然下探

## [0.4.2] — 2026-08-26

### Added（新功能）
- **活动时间线热力图回归**：面板新增 GitHub 风格 12 周热力图（周一为首行、5 档着色 0/<1h/1~2h/2~4h/≥4h），复用按日聚合数据零额外采集；含周几标签、日期范围与图例，中英文同步
- **按小时分布可视化**：今日明细区新增 24 小时柱状图（跨小时会话按实际经过时间分摊，峰值小时高亮，悬停显示时长）
- **实时活跃曲线**：面板周报区支持「周柱状图 ↔ 活跃曲线」一键切换；活跃曲线展示最近约 5 分钟每秒活跃度（5 秒桶聚合），随刷新周期自动更新。`JournalWriter` 新增独立保留窗，不受 journal flush 清空影响

### Fixed（缺陷修复）
- **面板脚本语法错误**（critical）：跨工作区总览拼接 `'<strong>'' +` 多一个单引号，内联脚本抛 SyntaxError 导致**整个面板失效**（统计卡/开关/按钮/图表全部不响应）；已修复并清除 i18n 改造残留的重复拼接
- **配置数值越界防护**：`ringBufferCapacity` / journal 间隔 / 全量存盘间隔等配置无下限钳制，0 或负值会导致 RingBuffer 构造崩溃或 `setInterval` 毫秒级疯狂触发（CPU/I/O 热点）；现统一在读取与热更新路径钳制（capacity ≥1、间隔 ≥1000ms、会话数/保留天数 ≥0）
- **stop() 状态卡死**：`endSession` 抛异常时 `_state` 永久停在 saving，`saveNow` 等依赖 running 态的路径全部失效；改 try/finally 保证状态恢复
- **面板隐藏仍执行聚合**：面板不可见时每 5 秒仍执行全量 O(N) 聚合（`updateData` 内部空转）；现仅在面板可见时刷新
- **帮助图标 tooltip 空内容**：9 处设置项 help-icon 悬停显示空框（tip 词条已有但未接线）；已填充中英双语说明
- **状态栏硬编码中文**：默认显示模式「今日/累计」在英文界面仍显示中文；已改 i18n 词条并删除领域层死方法 `formatDual`
- **webview 数字输入越界**：清空输入框会提交 0 覆盖配置；现按输入框 min/max 钳制、非法输入不发送
- **热力图窗口与口径修复**：窗口起点未回退 11 周（此前只渲染本周）；折叠桶与原始会话同日由叠加改为覆盖（口径与 fullDailySeries 一致，不重不漏）；窗口日期改用 `Date(y,m,d)` 构造规避 DST 列错位

### Performance & Optimization（性能与开销优化）
- **热力图窗口化**：不再调用 `fullDailySeries` 遍历并排序全历史日桶，只聚合窗口内 84 天（历史越久收益越大）
- **大数组防护**：跨工作区列表求最大值由 `Math.max(...spread)` 改为循环（工作区数量无上限，防栈溢出）

### Tests（测试增强）
- **单元测试新增 6 例**：`heatmapDays` 网格/覆盖口径/窗口边界；`JournalWriter.getRecent` 保留窗 FIFO 淘汰/空窗（总计 59 passing）

## [0.4.1] — 2026-08-24

### Fixed（缺陷修复）
- **面板「会话数」口径统一**：顶部统计卡此前只数已结束会话，与周报摘要区（含进行中会话）同屏不一致（如 0 vs 1）；现统一为「已结束 + 进行中」
- **跨工作区累计虚高治理**：globalState 跨版本持久共享，历史失联工作区（已删除/改道项目、旧双计数时代的膨胀值）永远计入总和；现 sync 时自动回收超过 30 天未同步的陈旧条目
- **新增「清除跨工作区累计」命令**：仅清空全局聚合数据，不影响各工作区本地计时（原 reset 会连本地数据一起清除）
- **reset 后恢复计时**：此前 reset 只停止不重启，计时永久停摆、面板数据陈旧；现清空后立即重新开始会话并推送最新数据
- **时钟回拨防御**：stop/snapshot 的会话历时不允许为负，防止 totalMs 被扣减、sessions 出现负时长
- **journal 回放过滤脏数据**：拒绝负值/非有限数的切片，防损坏行污染恢复结果
- **weeklySummary 周窗口 DST 安全化**：周终点改用本地日期归一化（原固定 +7×24h 在夏令时周与真实下周一零点相差 ±1 小时）

## [0.4.0] — 2026-08-24

### ⚠️ Breaking（架构精简）
本版本是一次大规模**减法重构**：移除闲置检测、效率统计、每日目标、周目标/连续打卡、热力图、月报、JSON 导出与定时自动导出等功能，回归「轻量、可靠、零噪音」的计时内核。

- **移除模块**：`ActivityTracker` / `IdleDetector` / `JsonExporter` / `WeeklyReportExporter` / `PeriodReportExporter`；对应配置项（`idleTimeoutMinutes`、`efficiency.enabled`、`dailyGoalMinutes`、`autoExport.*` 等）一并删除
- **导出器收敛**：新增统一 `ReportExporter`（日报/周报 Markdown），CSV 导出保留
- **面板内联化**：Dashboard HTML/CSS/JS 内联进 `DashboardPanel.ts`，移除独立 html 资源与 copy-assets 构建步骤
- **存储路径迁移**：数据文件由 `.workspace-timing-data/` 迁至 `.vscode/`（旧目录文件不再读取，可手动删除）
- **命令面板文案**：移除 nls 占位机制，改为直接英文字符串

### Fixed（缺陷修复）
- **reset 命令失效**（critical）：`extension.ts` 向 `CommandRegistrar` 传入 `storage=null`，导致「重置数据」永远命中无工作区守卫；现将存储引用提升为模块级并传入真实引用
- **时区口径统一**（critical）：聚合层此前混用 UTC（`toISOString`）与本地时区，UTC+8 用户早晨 8 点前的会话被归到前一天、周起始标签错位；现全模块统一本地时区归桶
- **跨午夜会话切分恢复**（critical）：回归 v0.3.2 已修复的缺陷——跨午夜会话整段计入开始日；现按自然日切分片段归属（日报/今日统计/7 日图/周报全链路口径一致），DST 安全
- **跨工作区聚合接线修复**（major）：`global.sync` 此前仅在手动存盘触发，周期存盘路径未接入，聚合长期陈旧；现挂载到 Scheduler 全量存盘回调并加防重入守卫
- **saveNow 口径漂移**：全局同步改用与 checkpoint 一致的 `totalMs`（不含进行中会话），消除全局累计与本地累计永久漂移
- **Scheduler 并发加固**：journal flush 与全量存盘回调增加防重入守卫；`flushAll` 补 await；`saveNow` 存盘时序修正
- **checkpoint 会话裁剪**：周期存盘时同步执行 `trimSessions(maxSessions)`（此前仅会话结束时裁剪，长期不关窗口会无限增长）
- **newPeriod 状态保留**：新建周期不再意外重置用户的启用/禁用状态
- **hourly 分布失真**：小时分布按会话实际经过时间分摊（原整段记入开始小时）；活跃时段改为按累计时长选取（原按跨度）

### Changed（变更）
- **配置热更新补齐**：调度间隔（journal flush / 全量存盘）与会话历史上限支持运行期生效，无需重载窗口；仍需重启的项在面板标注「重启窗口后生效」
- **Webview 安全加固**：面板注入 CSP（nonce 脚本白名单），符合 VS Code Webview 安全指南
- **ConfigWatcher 配置变更处理补回 try/catch**；移除死代码 `LifecycleManager.onVSCodeClose`
- **清理 out/ 中已删源码对应的孤儿编译产物**（不再打进发布包）

### Added（新功能）
- **单元测试扩充至 20 例**：本地时区归桶、跨午夜切分、hourly 分摊、activeWindow 口径、周界切分、TimerEngine 边界

## [0.3.8] — 2026-08-12

### Added（新功能 · P1 功能批次）
- **活动时间线热力图**：面板新增 GitHub 风格热力图，展示近 12 周（按周一为周首、含本周）每日累计时长的 5 档着色；零额外采集成本——直接复用已结束会话的按日分桶缓存（`finishedSessionsByDate`），活跃会话仅叠加至「今日」格；hover 显示日期与时长，含图例与周范围副标题。中英文面板同步
- **周目标 + 连续打卡（streak）**：在每日目标之外新增「每周目标」（小时，面板设置，0 = 关闭），周报/月报展示周期目标进度；新增「连续打卡」——当今日累计达到每日目标且今日尚未计入时连续天数 +1，跨天中断从 1 重新计数，结果持久化于工作区状态（`WorkspaceTimingData.streak`），达成时弹出桌面通知（🔥 N 天）。中英文面板同步
- **月报 + 周期报告泛化**：新增 `PeriodReportExporter`，周报/月报共用一套生成器；面板新增「导出月报」（Markdown），含本月总时长、日均、达标天数、与上月对比
- **全量 JSON 导出**：面板新增「导出 JSON」，输出包含累计/目标/连续打卡/每日·每月明细/热力图/原始会话列表的完整数据束，便于二次分析或迁移
- **定时自动导出**：新增 `workspaceTiming.autoExport` 设置（`enabled` / `intervalMinutes` / `format` / `targetPath`），由全量存盘周期（≈60s）驱动 `maybeAutoExport`，按间隔自动写盘 CSV / JSON / 周报 / 月报至目标目录（默认工作区根目录），无需手动操作

### Changed（变更）
- **`DashboardData` 新增 `heatmap` / `monthTotalMs` / `weeklyGoalMs` / `streak` 字段；`TimingConfig` 新增 `weeklyGoalMs` 与 `autoExport`；`WorkspaceTimingData` 新增可选的 `streak` 持久化字段（旧数据缺失时按 0 处理**，向后兼容）
