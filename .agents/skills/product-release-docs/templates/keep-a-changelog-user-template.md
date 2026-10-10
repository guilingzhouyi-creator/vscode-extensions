# Change Log

All notable changes to the extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- 新增项目级时间投入环比分析面板，清晰掌握近两周开发精力分配。

## [1.2.0] - 2026-10-10

### Added
- 新增周度/月度编码时长趋势对比图表，支持快速切换查看跨项目工作量分布。
- 新增暗色高对比度主题适配，图表色阶无缝对齐 VS Code 原生设计系统。
- 引入完整的中英文双语国际化支持，界面文案跟随编辑器语言偏好自动切换。

### Changed
- 优化长周期会话聚合引擎，大幅降低大容量历史数据加载时的内存开销与卡顿。
- 改进状态栏计时器的刷新与休眠调度，窗口失焦时自动平滑降频以降低资源消耗。

### Fixed
- 修复计算机进入睡眠或锁屏唤醒后，当前活动会话时长可能偶发多计的异常。
- 修复跨午夜编程时，部分历史记录未按本地自然日正确切分的边界缺陷。
- 修复 CSV 导出时特殊字符导致电子表格软件解析换行错位的兼容性问题。

### Security
- 增强本地双写存储与追加日志崩溃安全机制，杜绝异常断电或进程强制退出导致的数据损坏。

