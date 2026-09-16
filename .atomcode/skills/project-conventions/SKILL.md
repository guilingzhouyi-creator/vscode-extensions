---
name: project-conventions
description: 本仓库的编码与协作约定（源自 AGENTS.md 与各项目真源文档）。写代码、评审代码、提交 PR 时自动遵守。
user-invocable: false
---

## 规范来源
所有约定以仓库根目录 `AGENTS.md` 为准（指针索引 + 构建验证 + 关键约定 + 命名格式 + 活动范围），
涉及具体主题时按指针打开对应项目的真源文档：
- workspace-timing/ → `workspace-timing/README.md`（TS 五层分层扩展）
- auto-refactor/ → `auto-refactor/README.md`（Node CLI 静态分析工具）
- WebGames/ → `WebGames/docs/README.md`、`WebGames/config/README.md`（Godot 引擎）

## 应用方式
1. 编写或修改代码前，先阅读 `AGENTS.md` 及对应项目指针
2. 严格遵守其中的命名、结构、流程与门禁规则
3. 涉及发布、PR、合并时，遵守门禁治理与 release 流程（scripts/ 下的 pr-gate.sh、release.sh）
4. 若约定文档与通用最佳实践冲突，以 `AGENTS.md` 为准
