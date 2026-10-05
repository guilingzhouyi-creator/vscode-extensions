---
name: docs-archive-governance
description: >-
  工作区全宗技术档案归档、顶层自治蓝图演进与文档门禁规范。指导 Agent 在维护顶层设计蓝图
  （agent-native-system-blueprint.md）、全宗交付物归档（archive/deliverables/）、
  历史四阶段案卷封存、相对路径链接健康度与纯粹面向用户文档标准。
---

# docs-archive-governance — 全宗技术档案、蓝图演进与文档门禁规范

本技能规范了工作区顶层多智能体自治蓝图、历史全宗技术档案库、各子项目文档拓扑及静态文档质量门禁的标准作业流程。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **更新或演化顶层架构设计蓝图**（`docs/agent-native-system-blueprint.md`）；
2. **归档阶段性审查报告、重构交付物或评审案卷**（`archive/deliverables/`）；
3. **周期性封存短期施工案卷**（归档至 `docs/归档库/03_短期施工档案卷/`）；
4. **新增或修改任何面向用户的公共文档**（根目录 README、子项目 README、CHANGELOG）；
5. **执行全仓 Markdown 链接存活性与排版门禁检查**。

---

## 二、 顶层架构蓝图演进纪律

顶层设计案卷 [docs/agent-native-system-blueprint.md](docs/agent-native-system-blueprint.md) 定义了多 Agent 自治体系的核心愿景：
1. **Cell 平权自治体系**：单 Cell 内部三个平权 AgentLoop 实体（构建、独立测试、交叉审查），支持随负载向专业部门分化与 HTN-B 拓扑调度；
2. **一体两面三层拓扑 Diff**：一面服务 Agent 执行与审查，一面服务人类审阅；三层覆盖单元 Diff、跨域 Diff 与冲突仲裁；
3. **R1~R5 记忆提纯管线**：从瞬时上下文折叠沉淀至长期泛化技能库；
4. **分形 Git 门禁架构**：工作树按 Agent 与 SubAgent 严格隔离，门禁逐级守卫合入主干。

> **演进纪律**：修改顶层蓝图必须保持高阶系统性，不得将某个单项目代码级的零碎补丁直接填入蓝图，必须体现演进路线图与状态机切换。

---

## 三、 全宗技术档案与历史卷只读封存规范

工作区包含两级全宗技术档案库：
- **仓库级历史全宗**：`archive/deliverables/`（全仓重大重构方案、审查报告、治理交付物留痕）；
- **项目级技术全宗**：`WebGames/docs/归档库/`（国家标准级技术案卷）。

### 归档与封存硬性标准：
1. **标准档案元数据头块**：归档文件前 20 行必须包含键值头：
   ```markdown
   档号: KALAR-DEV-YYYY-ST{NN}-{PPP}
   验收状态: PASS / LOCKED
   ```
2. **只读不可变性（Freeze）**：历史归档案卷为已完成验收的客观历史存证，严禁为了规避静态门禁违规而擅自篡改已封存案卷中的代码片段或参数；
3. **单向沉淀流程**：活跃看板（如短期施工区）中的任务完成后，按 10 案卷周期打包转移至归档库，清理活跃看板指针。

---

## 四、 链接有效性与相对路径铁律

所有 Markdown 文档中的超链接必须遵守严格的静态门禁约束：
1. **严禁绝对路径与网络协议链接本地域**（`LINK-ABS-FILE-URI`）：
   - 严禁出现 `file:///`、Windows 盘符（如 `c:/...`）或特定机器用户名路径；
   - 必须统一采用项目内的**相对路径**（如 `[architecture](docs/architecture.md)`）；
2. **目标文件真实存在（`LINK-DEAD`）**：
   - 链接指向的相对路径在磁盘必须真实存在，重命名或移动文档必须全局同步更新所有引用；
3. **锚点严格对齐（`LINK-ANCHOR-DEAD`）**：
   - 锚点链接（如 `#section-name`）必须精确匹配目标文档中真实存在的 Markdown 标题。

---

## 五、 面向用户文档纯粹性与零黑话边界

1. **价值导向，剥离施工代号**：
   - 面向用户或外部贡献者的文档（如 README、CHANGELOG、UI 提示文案）必须纯粹基于功能特性、交付价值与使用指南撰写；
   - **绝对严禁**出现内部施工批次黑话代号（禁止词：`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip`；WebGames 前端视图标准规范命名 `fe_01`~`fe_17` 除外）；
2. **中立、客观与求真务实**：
   - 严禁夸大、敷衍或贬损用语；技术事实叙述客观准确。

---

## 六、 文档审查与静态门禁验证命令

在修改或归档文档后，必须执行以下验证命令：

```bash
# 1. 验证仓库静态打包资产健全性
bash scripts/sh/check-display-assets.sh

# 2. 运行 WebGames 专项文档静态门禁（命名、布局、死链、mermaid 语法）
python WebGames/scripts/py/audit_docs.py
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/audit-docs.ps1

# 3. 运行全仓多维文档与语法自测
node auto-refactor/scripts/validate-docs.js
```
