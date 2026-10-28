---
name: release-package-workflow
description: >-
  【触发：打包/发布/vsix/HotSync/版本号/发版日志/热同步】打包 VS Code 扩展、执行 -HotSync 热同步或编写 Keep-a-Changelog 发版日志时触发。确保产物自动轮转与用户文档零工程黑话。
---

# release-package-workflow — 产品交付文档、扩展打包热同步与发布闭环规范

本技能将**面向终端用户的产品交付文档（`README.md` / `CHANGELOG.md` 零工程黑话隔离）**与**VS Code 扩展本地编译打包、双端热同步自愈（`-HotSync`）、SemVer 版本递增及自动化发布打标**统一收口为端到端交付闭环。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[test-benchmark-engineering](../test-benchmark-engineering/SKILL.md)、[docs-archive-governance](../docs-archive-governance/SKILL.md) → **本技能** → —；并行支援 `coding-craft`、`constraint-driven-development`、`debugging-and-error-recovery`、`gate-governance`。
- **领域**：VS Code 扩展与计时视图（链上第 5 步）；其余 2 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `vs-extension`：`wt-construct`、`wt-review`、`wt-refactor`、`wt-explore`
- **何时联动**：打包 vsix 并热同步 → `release-package-workflow` + `workspace-timing-dev` + `gate-governance`；发版日志与版本号对齐 → `release-package-workflow` + `docs-archive-governance` + `batch-commit`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

1. **编写或修订面向终端用户的 `README.md` 与 `CHANGELOG.md`**：隔离内部工程重构黑话，呈现纯粹的用户价值；
2. **本地打包与开发期双端热同步**：执行 `package.ps1` / `package.sh` 生成 `.vsix` 或通过 `-HotSync` 毫秒级同步至 VS Code / Cursor 并自愈 `extensions.json`；
3. **语义化版本演进与 Git Tag 发布**：执行 `version-bump.sh`、`check-display-assets.sh` 与 `release-tag.sh`。

---

## 二、 用户价值导向与产品文档零黑话隔离契约 (`DOC-RD-001` / `DOC-CL-001`)

变更日志（`CHANGELOG.md`）与扩展根目录 `README.md` 的受众是终端开发者用户，严禁混入内部工程与门禁黑话：

| 审查维度 | 严格禁止混入的内部工程黑话 (❌ 违规) | 必须呈现的终端用户价值 (✅ 合规) |
| :--- | :--- | :--- |
| **架构与解耦** | “五层解耦”、“消融跳板”、“抽离 Domain”、“SubAgent 装配” | “提升面板响应速度”、“大型工作区统计秒级渲染” |
| **体积与复杂度** | “CC <= 15”、“ELOC 预算压减”、“1:3 动态包络”、“零瞬态堆分配” | “降低后台内存与 CPU 占用”、“长时间运行更轻量省电” |
| **门禁与工期** | “commit-msg 门禁”、“audit-all 全绿”、“Phase_XX / 批次 N” | “增强边界场景稳定性”、“完善多语言本地化翻译” |

1. **Keep-a-Changelog 结构规范**：版本标题为 `## [X.Y.Z] - YYYY-MM-DD`，按需使用 `Added`、`Changed`、`Deprecated`、`Removed`、`Fixed`、`Security` 六类二级标题；
2. **商用发布页 `README.md` 结构**：仅保留【产品定位标语 $\to$ 核心特性概览 (Features) $\to$ 快速上手 (Quick Start) $\to$ 配置选项字典 (Settings) $\to$ 反馈通道】，内部架构说明一律收口至 `docs/architecture.md`。

---

## 三、 本地打包、双端热同步与注册表自愈 (`package.ps1` / `package.sh`)

产物统一输出至 `dist/<ext>/`，默认保留最新 5 个历史版本（`-Keep 5` 自动轮转修剪）：
- **`-HotSync` 双端热同步**：跳过 `.vsix` 压缩与解包，直接将编译产物同步至 `$env:USERPROFILE\.vscode\extensions` 与 `$env:USERPROFILE\.cursor\extensions` 下的 `<publisher>.<name>-<version>` 目录；
- **`Repair-ExtensionRegistry` 自愈机制**：热同步前自动解析宿主 `extensions.json`，探测 `relativeLocation` 物理目录是否存在，剔除已失效的幽灵条目（Ghost Entries）并以无 BOM UTF-8 写回，根除扩展命令找不到或状态栏丢失问题。

---

## 四、 SemVer 版本递增 (`version-bump.sh`) 与发布打标 (`release-tag.sh`)

```bash
# 1. 校验 128x128 图标、横幅与 README/CHANGELOG 零黑话合规
bash scripts/sh/check-display-assets.sh

# 2. 语义化版本递增（自动将 [Unreleased] 封存至 [vX.Y.Z] - YYYY-MM-DD）
bash scripts/sh/version-bump.sh workspace-timing patch --dry-run

# 3. 本地打包与热同步自愈
pwsh -File scripts/ps1/package.ps1 -HotSync

# 4. 干净树验证并打标触发 CI Release
bash scripts/sh/release-tag.sh workspace-timing patch --message "v0.5.1 — 优化存储崩溃安全与双语字典" --no-push
```

---

## 五、 关联参考与模板资产

- [extension-registry-repair.md](references/extension-registry-repair.md)：扩展注册表幽灵条目自愈原理与面向用户变更日志转化对照指南；
- [package-release-runbook.md](templates/package-release-runbook.md)：含 Keep-a-Changelog 模板、商用 README 骨架与端到端发布检查单的综合手册。
