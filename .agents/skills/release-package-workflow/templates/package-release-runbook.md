# 产品文档样板与扩展打包发布标准作业手册 (Release Runbook)

## 一、 Keep-a-Changelog 标准用户模板 (`CHANGELOG.md`)

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.2.0] - 2026-10-23
### Added
- 新增按周与按月的编码时长趋势分布视图，支持一键导出统计摘要。
### Changed
- 优化状态栏计时指示器后台刷新策略，降低空闲态资源占用。
### Fixed
- 修复跨午夜连续编码时当日时长切分偶发偏移的缺陷。
```

---

## 二、 面向用户的产品发布页骨架 (`README.md`)

```markdown
# <Extension Display Name>

> 一句话阐明核心用户价值（严禁出现内部架构代号、门禁跑分或重构批次）。

## 核心特性 (Features)
- **实时精准计时**：自动追踪活动编辑器编码时长，支持多工作区独立统计。
- **本地崩溃防丢**：采用双写容灾保护，异常断电或重启编辑器零数据丢失。

## 快速上手 (Quick Start)
1. 安装扩展后，底部状态栏自动显示今日活跃编码时长；
2. 点击状态栏图标或执行命令 `Workspace Timing: Show Dashboard` 打开可视化看板。

## 配置选项 (Settings)
| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `workspaceTiming.idleTimeoutSeconds` | `number` | `300` | 无操作进入空闲暂停的秒数阈值 |
```

---

## 三、 端到端打包与发布核查清单

- [ ] **1. 资产与零黑话自检**：运行 `bash scripts/sh/check-display-assets.sh`，确认 `images/icon.png` (128x128)、`README.md` 与 `CHANGELOG.md` 零内部工程黑话；
- [ ] **2. 全量测试与门禁通行**：运行 `cd workspace-timing && npm run compile && npm run test:fast && npm run review`；
- [ ] **3. 本地打包与热同步验证**：运行 `pwsh -File scripts/ps1/package.ps1 -HotSync`，在宿主编辑器重载验证功能；
- [ ] **4. 版本递增与打标**：确认 `git status -s` 为空后，执行 `bash scripts/sh/version-bump.sh workspace-timing patch` 与 `bash scripts/sh/release-tag.sh`。
