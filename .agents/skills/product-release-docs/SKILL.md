---
name: product-release-docs
description: >-
  面向终端用户的产品交付文档、版本发布日志与商业发布页编写规范。指导 Agent 在 VS Code 扩展
  (workspace-timing) 及各类终端交付项目中编写纯客观面向用户的 README 与 CHANGELOG，
  物理隔离内部重构黑话、架构代号与工程门禁细节，落实 Keep-a-Changelog 规范与语义化版本交付。
---

# product-release-docs — 面向终端用户的产品交付文档与发布日志规范

本技能确立了全工作区对外交付型项目（如 VS Code 扩展 `workspace-timing`）面向终端用户的产品文档与更新日志编写标准，坚决实施**用户价值导向与内部工程黑话物理隔离**。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **扩展版本发布与打包前夕**：在执行 `package.ps1` 打包或触发发布流程前维护 `CHANGELOG.md`；
2. **产品级发布页编写与修订**：编写或更新面向 VS Code Marketplace 或开源用户的根目录 `README.md`；
3. **版本更新日志审计**：审查更新日志中是否意外混入重构批次、复杂度指标、分层代号或门禁脚本黑话；
4. **用户交互文案本地化对齐**：校验交付文档中的功能描述与双语字典中的实际界面用词是否一致。

---

## 二、 用户价值导向与工程黑话物理隔离契约

变更日志与产品 README 的读者是使用工具的终端开发者，而非系统架构师或门禁审查员。

| 审查维度 | 严格禁止混入的内部工程黑话 (❌ 违规) | 必须呈现的终端用户技术价值 (✅ 合规) |
| :--- | :--- | :--- |
| **架构与解耦** | 提及“五层解耦”、“消融跳板”、“依赖注入”、“抽离 Domain” | 阐述“操作响应更加敏捷”、“大项目图表渲染速度提升” |
| **体积与复杂度** | 提及“CC <= 15”、“ELOC 预算压减”、“1:3 动态包络” | 阐述“资源占用优化”、“后台运行更加轻量省电” |
| **门禁与测试** | 提及“commit-msg 门禁”、“audit-all 5 大支柱绿色通行” | 阐述“核心算法稳定性提升”、“边界场景容错加固” |
| **工期与批次** | 提及敏捷工期、阶段代号、批次代号 | 阐述清晰的产品功能特性与改进项 |

---

## 三、 Keep-a-Changelog 结构化规范

更新日志严格遵循 [Keep a Changelog](https://keepachangelog.com/) 与 [Semantic Versioning](https://semver.org/) 格式：

1. **版本分级标题**：`## [X.Y.Z] - YYYY-MM-DD`（必须标注语义化版本号与 ISO 发布日期）；
2. **标准六大语义分类**（按需呈现，无改动分类省略）：
   - `### Added`：新功能、新面板、新视图或新配置项；
   - `### Changed`：现有行为调整、界面交互优化或性能显著提升；
   - `### Deprecated`：将在未来版本中移除的既有功能弃用声明；
   - `### Removed`：正式移除的废弃功能；
   - `### Fixed`：用户可见缺陷、图表异常或统计偏差修复；
   - `### Security`：本地存储防丢、崩溃安全或权限隔离加固。

---

## 四、 面向终端用户的商业发布页 README 架构

产品发布页（如 `workspace-timing/README.md`）必须采用纯粹的产品宣传与上手指引结构：

```text
├── # 扩展名称与简要产品定位标语
├── ## 核心特性概览 (Features)         # 图文呈现核心卖点与用户价值
├── ## 快速上手指引 (Quick Start)      # 1-2-3 安装与使用极简指南
├── ## 配置选项字典 (Settings)         # 用户可调配置参数表与默认值
└── ## 反馈与支持 (Feedback)           # Issues 链接与开源反馈通道
```

> [!CAUTION] 商业发布页防污染红线
> 根目录 `README.md` 是面对外部用户的产品展示窗。**严禁**在其中嵌入内部重构路线图、历史施工案卷、测试覆盖率内部跑分或技术债务清理流水账。内部架构文档应严格收敛至 `docs/architecture.md`。

---

## 五、 本地审查与质性断言标准

在提交产品文档前，执行本地预审：

```powershell
# 1. 检查扩展资产健全度与 README 格式
bash scripts/sh/check-display-assets.sh

# 2. 预审暂存区提交
pwsh -File scripts/ps1/pre-commit-gate.ps1
```

**质性断言标准**：
- `CHANGELOG.md` 零内部工程黑话，零敏捷冲刺代号；
- 条目全部以终端用户收益为核心主谓宾表达；
- `README.md` 包含核心特性、快速上手与配置表格，排版清晰；
- 全工作区 High/Critical 技术债务保持 0 项基线，文档演进严禁引入技术债务反弹。

---

## 六、 关联模板与参考指引

- [user-facing-changelog-guide.md](references/user-facing-changelog-guide.md)：面向用户的变更日志写作深度指南；
- [keep-a-changelog-user-template.md](templates/keep-a-changelog-user-template.md)：标准 Keep-a-Changelog 用户模板；
- [product-readme-template.md](templates/product-readme-template.md)：面向终端用户的发布页 README 骨架模板。

