# Workspace Timing  ⏱

> 🪶 轻量化 · 高可扩展 — 环形缓冲区 + Journal 双写入架构；预留多工作区对比、云端同步、团队看板扩展点。  
> Lightweight & extensible — RingBuffer + Journal dual-write architecture; ready for multi-workspace comparison, cloud sync, and team dashboard.

## 功能亮点 | Features

- ⏱ **自动计时** · Auto-timing — 打开工作区即开始计时
- 📊 **周报图表** · Weekly chart — 最近 7 天柱状图
- 🌐 **跨工作区** · Cross-workspace — 聚合所有工作区的时长
- 🛡️ **崩溃保护** · Crash-safe — Journal 文件防止数据丢失
- 🎨 **仪表板** · Dashboard — 实时统计、设置、图表
- 📅 **日/累计分离** · Daily & total — 今日和累计分别显示

## Usage

| Command | 说明 | Description |
|---------|------|-------------|
| `Workspace Timing: Open Dashboard` | 打开统计面板 | Open the stats & settings panel |
| `Workspace Timing: Enable Timing` | 启用计时 | Enable timing for current workspace |
| `Workspace Timing: Disable Timing` | 禁用计时 | Disable timing for current workspace |
| `Workspace Timing: Toggle Global Timing` | 全局开关 | Global on/off switch |
| `Workspace Timing: New Counting Period` | 新建周期（保留历史） | Reset counter, keep history |
| `Workspace Timing: Reset Timing Data` | 重置全部数据（不可恢复） | Delete all data (irreversible) |

点击状态栏计时器可在三种显示模式间切换 | Click the timer in the status bar to cycle display modes：
`今日 · 累计` → `累计 · 今日` → `仅今日`

## 存储 | Storage

计时数据存放在：
- `workspaceState` — 主存储（VS Code 内部 KV）
- `.vscode/workspace-timing.json` — 文件备份（项目可见，可版本控制）
- `.vscode/workspace-timing.journal` — 崩溃保护（自动清理）
- `ExtensionContext.globalState` — 跨工作区聚合

## 要求 | Requirements

- VS Code 1.85.0 及以上

## 扩展设置 | Extension Settings

* `workspaceTiming.enabled`: 启用/禁用计时
* `workspaceTiming.globalDisabled`: 全局禁用
* `workspaceTiming.statusBar.*`: 状态栏显示选项
* `workspaceTiming.storage.*`: 存储与崩溃保护设置

## 许可证 | License

MIT
