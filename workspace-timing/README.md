# Workspace Timing ⏱

> 全本地工作区时长追踪 — 零配置、零上传、零隐私风险
> Fully local workspace time tracker — no account, no cloud, no privacy risk

## 功能 | Features

| 功能 Feature | 说明 Description |
|------|------|
| ⏱ 自动计时 Auto-timing | 打开工作区即开始，关闭自动存盘 / Starts on open, saves on close |
| 📊 周报柱状图 Weekly chart | 本周（周一至今）每日时长 + 效率百分比 / This week (Mon→today) daily hours + efficiency % |
| ⚡ 效率转化 Efficiency | 编辑活跃度 / 在桌时长 = 真实效率 / Active typing / desk time |
| 💤 闲置检测 Idle detection | 失焦超时自动剔除 / Auto-exclude away time |
| 🎯 每日目标 Daily goal | 达成桌面通知 + 进度条 / Desktop notification + progress bar |
| 🌐 跨工作区 Cross-workspace | 聚合所有项目的累计时长 / Aggregate all projects |
| 🛡 崩溃保护 Crash-safe | Journal + 环形缓冲区 双写入 / Journal + RingBuffer dual-write |
| 📥 CSV 导出 CSV export | 每日明细 + 效率 + 闲置 / Daily detail + efficiency + idle |
| 🔧 诊断报告 Diagnostics | 200条日志 + 配置快照 / 200 log entries + config snapshot |
| 🌍 双语支持 Bilingual | 中文/English Dashboard一键切换 / One-click language toggle |

## 数据存储 | Storage

所有数据完全本地，不发送任何信息到外部
All data is fully local — nothing is sent anywhere:

- workspaceState — VS Code 内部 KV 主存储 / internal KV primary storage
- .workspace-timing-data/data.json — 文件备份 / file backup
- .workspace-timing-data/journal — 崩溃保护 / crash protection

## 安装 | Install

VS Code Marketplace 搜索 **Workspace Timing**，或 / or:

    code --install-extension guilingzhouyi.workspace-timing

## 已知限制 | Known Limitations

- **本周效率为会话内指标**：效率（编辑活跃度占比）只在扩展运行的当前会话内统计，重启 VS Code 后归零。它反映"本次运行期间"的真实打字专注度，跨会话不累积。
- **周报口径为自然周**：面板柱状图与导出的周报均采用"本周一 00:00 → 今天"的口径（导出整周报告时为周一→周日），与系统日期的"周"对齐，而非滚动 7 天。
- **CSV 时间为本地时区**：导出时间戳与每日明细按本地日期划分，非 UTC。

## 许可证 | License

MIT
