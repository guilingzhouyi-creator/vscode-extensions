---
name: webgames-workflow
description: >-
  Godot 4.7 卡拉尔世界引擎纯逻辑解耦与配置驱动开发工作流。指导 Agent 在 WebGames 项目中
  严格执行先四阶段细则获批后编码的两轮施工纪律、全域配置驱动（GameConfig）、
  视图表现层零业务计算（apply_snapshot）、高承压对象池循环零堆分配（ADV-PRF-002）与单测继承规范。
---

# webgames-workflow — Godot 4.7 引擎纯逻辑解耦与配置驱动开发规范

本技能规范了 `WebGames/` 项目中业务逻辑无头解耦、配置驱动同构化、前端可视化快照注入、对象池零堆分配以及两轮四阶段方案施工标准。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或修改游戏玩法与后端领域系统**（如经济、战斗、探索、背包、NPC 状态机）；
2. **编写或重构前端 UI 视图**（`frontend/views/**`、组件与导航）；
3. **新增或迁移领域配置表**（`config/domains/**`）；
4. **短期施工区研发**（新建 Phase 细则、执行验收、归档案卷）；
5. **编写或调试 GDScript 单元测试**。

---

## 二、 两轮施工周期与四阶段案卷施工铁律

在 `WebGames/docs/路线图/01_短期施工区/` 中进行研发时，必须严格遵守两轮周期：

### 1. 两轮周期执行标准
- **第 1 轮（检查 ➔ 方案编制 ➔ 严禁提前编码）**：
  ① 检查短期施工区，严格核对当前序号连续性（无跳号、无越序、无重复）；
  ② 编写 4 份分阶段施工细则；
  ③ **向用户汇报方案并等待明确批准；未获批准前绝对严禁编写任何业务代码，严禁提前修改路线图状态**。
- **第 2 轮（获批复查 ➔ 编码实施 ➔ 全量验收 ➔ 闭环归位）**：
  ① 确认用户明确批准后，按阶段 1~4 依次编码落地；
  ② 执行全量单元测试与无头验证；
  ③ 在 [路线图总索引.md](WebGames/docs/路线图/路线图总索引.md) 中更新完成状态，形成闭环。

### 2. 案卷目录文件结构铁律
每个案卷目录（如 `Phase_NN_<主题>/`）下**严格仅允许包含且必须包含 4 份文件**，严禁自造 `README.md` 或多余文档：
1. `KALAR-DEV-YYYY-ST{NN}-001_阶段1_数据契约与实体定义.md`
2. `KALAR-DEV-YYYY-ST{NN}-002_阶段2_业务逻辑实现与状态机流转.md`
3. `KALAR-DEV-YYYY-ST{NN}-003_阶段3_全域配置驱动与泛化路由接入.md`
4. `KALAR-DEV-YYYY-ST{NN}-004_阶段4_全量回归验收与防复发门禁测试矩阵.md`

> **10 案卷周期归档**：短期施工区每满 10 个施工案卷为一个周期，经四阶段特化校验后，打包归入 `docs/归档库/03_短期施工档案卷/` 赋予标准档号并清理看板。

---

## 三、 全域配置驱动与同构目录化标准

1. **统一读取入口**：所有领域数值与静态资源统一经 `GameConfig.get_*` 从 `config/domains/<域>/core.json` 及其子表读取；
2. **严禁根目录平铺配置表**：配置表必须按领域归入 `config/domains/<domain>/`；
3. **泛化路由与热重载**：支持以点分路径形式（如 `GameConfig.get_value("economy.rates.tax")`）访问配置，底层支持细粒度热重载与合法性 Schema 校验。

---

## 四、 前端可视化表现层边界（视图零业务计算）

`frontend/views/**` 必须保持纯粹的表现层定位，严守四大红线：
1. **视图零业务计算**：视图内严禁调用 `randf()`/`randi()` 伪造随机数、严禁内嵌汇率换算/概率判定/战斗数值公式、严禁自维护业务状态机与伪持久化状态；
2. **唯一数据入口**：业务数据一律通过强类型快照经由 `apply_snapshot(snapshot: Dictionary)` 方法单向注入；视图严禁直读业务 Mock 或私自穿透读取未暴露的后端单例；
3. **单向依赖解耦**：视图层仅允许依赖 UI 基础设施、展示组件与 i18n/主题模块，严禁直接依赖后端求解器或私有类；
4. **组件复用与弱引用**：浮层、确认弹窗与通用面板优先复用全局管理器，避免节点泄漏。

---

## 五、 高承压对象池与循环内零瞬态堆分配 (`ADV-PRF-002`)

在每帧更新（`_process` / `_physics_process`）或高频事件循环中，严格落实零瞬态内存分配：
1. **严禁循环内裸调 `.new()`**：频繁创建的对象（特效、弹道、伤害跳字、事件载荷）必须通过对象池进行借还；
2. **必须实现 `reset_state()`**：归还对象池前或重新借出时，必须显式调用 `reset_state()` 彻底重置所有内部状态与引用字段，杜绝脏数据残留；
3. **预分配容器容量**：数组与字典如能预知规模，预先设定容量避免运行时动态扩容导致的内存碎片。

---

## 六、 测试工程化拓扑与 GDScript 规范

1. **测试脚本拓扑归位**：`tests/unit/` 根目录散落测试脚本数恒为 0。必须按层级归位于：
   - `tests/unit/domains/`（后端领域测试）
   - `tests/unit/frontend/`（前端视图与组件测试）
   - `tests/unit/infrastructure/`（底层基础设施测试）
2. **统一基类与入口契约**：所有测试套件必须继承 `TestCase`（`tests/support/test_case.gd`），统一通过 `static func run_all_tests() -> Dictionary` 执行并经 `TestCase.pack_results` 打包交付；
3. **双向领域对齐**：新增后端领域测试必须在 `config/infrastructure/domains.json` 与 `test_registry.gd` 中双向注册；
4. **排版契约**：GDScript 源码严格采用 2 空格或 Tab 缩进、`snake_case` 命名风格与 **LF 换行符**。

---

## 七、 专属构建、测试与审查命令矩阵

在修改 WebGames 代码或配置后，必须在终端依次执行：

```bash
# 1. 语法与静态规范检查
bash WebGames/scripts/sh/check-gdscript.sh
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/check-gdscript.ps1

# 2. 无头运行全量单元测试套件
bash WebGames/scripts/sh/test-run.sh
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/test-run.ps1

# 3. 执行 WebGames 专属全量门禁与配置审查
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```
