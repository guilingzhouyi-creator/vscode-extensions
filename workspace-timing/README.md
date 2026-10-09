# Workspace Timing ⏱

![Workspace Timing banner](images/banner.png)

> 🪶 轻量无感 · 崩溃无忧 — 精准记录项目编码时长；多维可视化统计、AI 双轨工时感知、空闲智能截断、中英双语与数据安全保护。  
> Lightweight & crash-safe — Track coding time effortlessly; rich analytics, AI dual-track sensing, idle auto-pause, bilingual UI, and multi-tier data protection.

---

## ✨ 功能亮点 | Features

- ⏱ **自动无感计时** · Auto-timing — 打开项目即自动开始计时，实时统计编码时长，零弹窗、零打扰。
- 🤖 **开发者与 AI 协作双轨感知** · Dual-track AI sensing — 智能监听键盘输入与外部智能体文件改动事件，在运行期动态区分手动编码与 AI 协作工时。
- ⏸ **自适应空闲暂停与智能截断** · Smart idle auto-pause — 离开键盘超时自动切入空闲暂停态，并在恢复活动时智能截断离开期间的无效等待时长，保证工时记录真实客观。
- 🎯 **周工作上限与健康提醒** · Weekly limit & rest reminders — 自定义周工时目标，动态渐变进度条与阈值分割线，达标超限贴心提醒劳逸结合。
- 📈 **高精度平滑活跃曲线** · Smooth activity curve — 5 档等分物理刻度与全宽自适应，实时直观呈现专注节奏。
- 🔥 **24 周全宽活动热力图** · Activity heatmap — GitHub 风格每日活跃时间线，5 档浓度直观展示半年度工作投入度。
- ⏰ **24 小时活跃分布** · Hourly breakdown — 今日 24 小时时间槽分布与物理刻度标尺，峰值时段高亮一览无余。
- 🌐 **多工作区聚合对比** · Cross-workspace — 聚合管理多个项目工时，内置多项目占比对比柱状图。
- 🛡️ **多级存储与崩溃防丢** · Crash protection — 毫秒级内存缓冲 + 实时增量日志 + 定时完整快照，意外退出时具备前向回放补偿能力，保障数据高完整度。
- 🎨 **现代化暗色仪表板** · Modern dashboard — 实时统计概览、配置热更新、明细钻取、报表一键导出。
- 🌐 **无缝双语支持** · Bilingual i18n — 简体中文 / English 随系统自适应或手动热切换，界面文案 100% 覆盖。
- 📤 **多格式报表导出** · Multi-format export — 支持会话明细 CSV、全历史聚合日报 CSV、Markdown 日报与周报。
- 💾 **安全快照与数据还原** · Snapshot & restore — 危险重置或清除前自动生成快照，支持从备份文件安全还原。

---

## 💻 命令清单 | Commands

| Command | 说明 | Description |
|---------|------|-------------|
| `Workspace Timing: Open Dashboard` | 打开统计与设置面板 | Open the stats & settings dashboard |
| `Workspace Timing: Enable Timing` | 启用当前工作区计时 | Enable timing for current workspace |
| `Workspace Timing: Disable Timing` | 禁用当前工作区计时 | Disable timing for current workspace |
| `Workspace Timing: Toggle Global Timing` | 全局启用/禁用开关 | Global on/off toggle for all workspaces |
| `Workspace Timing: Toggle Status Bar Display Mode` | 循环切换状态栏显示模式 | Cycle status bar modes (today/total/compact) |
| `Workspace Timing: Export CSV` | 导出当前工作区会话明细 CSV | Export workspace session records as CSV |
| `Workspace Timing: Export Aggregated Daily CSV` | 导出全历史聚合日报序列 CSV | Export all-history daily totals as CSV |
| `Workspace Timing: New Counting Period` | 新建周期（重置累计，保留历史） | Reset total counter, keep session history |
| `Workspace Timing: Clear History Details` | 清除历史明细（保留累计总时长） | Clear history sessions, keep total duration |
| `Workspace Timing: Clear Cross-Workspace Totals` | 清除跨工作区累计数据 | Clear aggregated multi-workspace totals |
| `Workspace Timing: Restore from Backup File` | 从 JSON 备份文件还原 | Restore timing data from a JSON backup file |
| `Workspace Timing: Reset Timing Data` | 重置本工作区全部数据 | Reset workspace timing data completely |
| `Workspace Timing: Force Save Now (Debug)` | 立即强制存盘（调试用） | Force immediate flush & checkpoint |

> 💡 **状态栏快捷交互**：直接点击状态栏右侧的时钟图标，可在三种模式间无缝切换：  
> `今日 30m · 累计 2h` → `累计 2h · 今日 30m` → `30m`（仅今日）

---

## 🗄️ 存储架构与智能归档 | Storage Architecture & Smart Archiving

扩展采用多级分层存储与有界内存自动归档体系，兼顾极低系统开销与极致数据可靠性：
1. **内存零延迟缓存**：高频收集秒级时间片增量，内存中完成计算，杜绝磁盘频繁 I/O 与卡顿。
2. **实时增量日志**：定期追加写入轻量增量日志，遇系统休眠、崩溃或断电可在下次启动时即时无损回放。
3. **智能滚动归档与容量保护**：采用单日 20 条上限与每周跨周自动归档机制，超出配额的历史条目自动沉淀至日汇总数据层（dailyTotals），在保证总工时精确守恒的前提下避免长期运行内存膨胀。
4. **主数据持久化**：结合 VS Code 原生存储与工作区本地文件双重校验，提供可版本控制的格式化备份。
5. **跨工作区聚合中枢**：全局维护所有工作区时长索引，自动回收长期未同步的陈旧项目数据。

---

## ⚙️ 扩展设置 | Extension Settings

| 配置项 | 默认值 | 说明 |
|--------|:------:|------|
| `workspaceTiming.locale` | `auto` | 界面语言 (`auto` 跟随 VS Code / `zh-CN` / `en`) |
| `workspaceTiming.enabled` | `true` | 是否启用当前工作区的时长追踪 |
| `workspaceTiming.globalDisabled` | `false` | 全局禁用所有工作区的时长追踪 |
| `workspaceTiming.statusBar.enabled` | `true` | 是否在状态栏右侧显示计时器 |
| `workspaceTiming.statusBar.mode` | `today-total` | 状态栏初始显示模式（点击状态栏循环切换并自动保存） |
| `workspaceTiming.weeklyLimit.enabled` | `false` | 是否启用周工作上限监控与休息提醒 |
| `workspaceTiming.weeklyLimit.hours` | `40` | 周工作上限时长（小时，范围 1~168） |
| `workspaceTiming.idleTimeoutMinutes` | `5` | 空闲超时判定分钟数（0 = 禁用空闲暂停，范围 0~120） |
| `workspaceTiming.aiDetectionEnabled` | `true` | 是否启用开发者与 AI 协作双轨工时智能感知 |
| `workspaceTiming.aiCooldownSeconds` | `120` | AI 协作活跃冷却观察窗口（秒，范围 10~600） |
| `workspaceTiming.storage.backupToFile` | `true` | 启用工作区本地文件备份 |
| `workspaceTiming.storage.journalEnabled` | `true` | 启用实时数据防丢保护 |
| `workspaceTiming.storage.ringBufferCapacity` | `1024` | 实时记录缓存上限 |
| `workspaceTiming.storage.journalFlushInterval` | `10000` | 实时数据自动保存间隔 (ms) |
| `workspaceTiming.storage.fullSaveInterval` | `60000` | 全量检查点保存间隔 (ms) |
| `workspaceTiming.storage.maxSessions` | `140` | 详细会话保留条数上限（默认 140 条，对应单周 7 天 × 每日 20 条配额；0 = 不限） |
| `workspaceTiming.storage.historyRawRetentionDays` | `45` | 详细会话保留天数（超出自动归档为日汇总） |
| `workspaceTiming.storage.safetySnapshot` | `true` | 重置/清除/还原等操作前自动写入安全快照 |
| `workspaceTiming.cloudSync.enabled` | `false` | 云端同步开关（即将推出） |

---

## 📄 许可证 | License

MIT License © 2026 OriginalTC
