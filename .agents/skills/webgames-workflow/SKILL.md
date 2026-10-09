---
name: webgames-workflow
description: >-
  Godot 4.7 卡拉尔世界引擎纯逻辑解耦与配置驱动开发工作流。指导 Agent 在 WebGames 项目中
  严格执行先四阶段蓝图获批后编码的两轮施工纪律、全域配置驱动（GameConfig）、
  视图表现层零业务计算与强类型 Tabs 视图控制器（apply_snapshot）、高承压对象池循环零堆分配（ADV-PRF-002）
  以及原生 Python 静态提取门禁（audit_arch_static.py）极速分析。
---

# webgames-workflow — Godot 4.7 引擎纯逻辑解耦与配置驱动开发规范

本技能规范了 `WebGames/` 项目中业务逻辑无头解耦、配置驱动同构化、前端可视化快照单向注入、强类型 Tabs 视图控制器、对象池零堆分配以及原生 Python 极速静态提取规范。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或修改游戏玩法与后端领域系统**：如经济、战斗、探索、背包、AI 实体与环境代理状态机等纯逻辑求解器；
2. **编写或重构前端 UI 视图与控制器**：`frontend/views/**`、强类型 Tabs 视图控制器与导航；
3. **新增或迁移领域配置表**：`config/domains/**`；
4. **短期施工区研发**：新建四阶段方案蓝图、执行验收、归档案卷；
5. **编写或调试 GDScript 单元测试与静态提取门禁**。

---

## 二、 两轮施工周期与四阶段案卷施工铁律

在 `WebGames/docs/路线图/01_短期施工区/` 中进行研发时，必须严格遵守两轮周期：

### 1. 两轮周期执行标准
- **第 1 轮（检查 ➔ 方案编制 ➔ 严禁提前编码）**：
  ① 检查短期施工区，严格核对当前序号连续性（无跳号、无越序、无重复）；
  ② 依据 `templates/four-stage-blueprint-template/` 编写 4 份分阶段技术规范蓝图；
  ③ **向用户汇报方案并等待明确批准；未获批准前绝对严禁编写任何业务代码，严禁提前修改路线图状态**。
- **第 2 轮（获批复查 ➔ 编码实施 ➔ 全量验收 ➔ 闭环归位）**：
  ① 确认用户明确批准后，按阶段 1~4 依次编码落地；
  ② 运行原生 Python 静态提取门禁与全量单元测试无头验证；
  ③ 在 `WebGames/docs/路线图/路线图总索引.md` 中更新完成状态，形成闭环。

### 2. 案卷目录文件结构铁律
每个案卷目录（如 `blueprint_<主题>/`）下**严格仅允许包含且必须包含 4 份技术规范文件**，严禁自造 `README.md` 或多余文档，严禁包含任何施工批次代号：
1. `001_数据契约与实体定义.md`
2. `002_业务逻辑实现与状态机流转.md`
3. `003_全域配置驱动与泛化路由接入.md`
4. `004_全量回归验收与防复发门禁测试矩阵.md`

> **10 案卷周期归档**：短期施工区每满 10 个施工案卷为一个周期，经四阶段特化校验后，打包归入 `WebGames/docs/归档库/03_短期施工档案卷/` 赋予标准档号并清理看板。

---

## 三、 全域配置驱动与同构目录化标准

1. **统一读取入口**：所有领域数值与静态资源统一经 `GameConfig.get_*` 从 `config/domains/<域>/core.json` 及其子表读取；
2. **严禁根目录平铺配置表**：配置表必须按领域归入 `config/domains/<domain>/`；
3. **泛化路由与热重载**：支持以点分路径形式（如 `GameConfig.get_value("economy.rates.tax")`）访问配置，底层支持细粒度热重载与合法性 Schema 校验。

---

## 四、 前端可视化表现层边界（视图零业务计算与强类型 Tabs 控制器）

`frontend/views/**` 必须保持纯粹的表现层定位，严守四大红线：
1. **视图零业务计算**：视图内严禁调用 `randf()`/`randi()` 伪造随机数、严禁内嵌汇率换算/概率判定/战斗数值公式、严禁自维护业务状态机与伪持久化状态；
2. **强类型 Tabs 视图控制器治理**：
   - 彻底消除 `var v = _view` 等弱类型缩写；
   - 视图控制器必须显式声明强类型子视图引用（如 `var _overview_view: OverviewView`），保障编译期静态类型检查与完整代码提示；
   - 严禁任何动态弱类型穿透与动态反射调用；
3. **唯一数据入口**：业务数据一律通过强类型快照经由 `apply_snapshot(snapshot: Dictionary) -> void` 方法单向注入；视图严禁直读业务 Mock 或私自穿透读取未暴露的后端单例；
4. **单向依赖解耦与资源复用**：视图层仅允许依赖 UI 基础设施、展示组件与 i18n/主题模块，严禁直接依赖后端求解器或私有类；浮层、确认弹窗与通用面板优先复用全局管理器，避免节点泄漏。

---

## 五、 高承压对象池与循环内零瞬态堆分配 (`ADV-PRF-002`)

在每帧更新（`_process` / `_physics_process`）或高频事件循环中，严格落实零瞬态内存分配：
1. **严禁循环内裸调 `.new()` (`ADV-PRF-002`)**：频繁创建的对象（特效、弹道、伤害跳字、事件载荷）必须通过对象池进行借还；
2. **必须实现 `reset_state()` 契约**：归还对象池前或重新借出时，必须显式调用 `reset_state()` 彻底重置所有内部状态、数值与集合引用，杜绝脏数据残留；
3. **预分配容器容量**：数组与字典预先设定容量避免运行时动态扩容导致的内存碎片；
4. **借还生命周期对称性**：获取时初始化并标记活跃，归还时执行 `reset_state()` 并重新入池，析构时统一释放。

---

## 六、 原生 Python 静态提取器与测试工程化拓扑

1. **原生 Python 静态提取器 (`audit_arch_static.py`)**：
   - 彻底剥离 Headless Godot 引擎冷启动依赖，直接基于 Python 执行 AST 分析与架构规范提取；
   - 相比冷启动 Godot 引擎执行审查脚本，执行速度提升 87.5%，提供毫秒级极速本地反馈；
   - 纳管领域配置路由校验、前端表现层零业务计算检查及高频循环内存分配静态预警；
2. **测试脚本拓扑归位**：`tests/unit/` 根目录散落测试脚本数恒为 0。必须按层级归位于：
   - `tests/unit/domains/`（后端领域测试）
   - `tests/unit/frontend/`（前端视图与组件测试）
   - `tests/unit/infrastructure/`（底层基础设施测试）
3. **统一基类与入口契约**：所有测试套件必须继承 `TestCase`（`tests/support/test_case.gd`），统一通过 `static func run_all_tests() -> Dictionary` 执行并经 `TestCase.pack_results` 打包交付；
4. **双向领域对齐**：新增后端领域测试必须在 `config/infrastructure/domains.json` 与 `test_registry.gd` 中双向注册；
5. **排版契约与体积预算**：GDScript 源码严格采用 LF 换行符、`snake_case` 命名风格与标准缩进；核心脚本受单文件双轨体积（$\text{ELOC} \le 900 / \text{LOC} \le 1400$）与 1:3 动态包络约束；
6. **模块头部文档契约**：核心后端求解器与视图控制器入口必须在首行呈现对齐工作区六字段标准的文档块（`Module`, `File Path`, `Architecture Role`, `Dependencies & Triggers`, `Responsibilities`, `Exit Semantics & Design Rationale`）。

---

## 七、 专属构建、测试与审查命令矩阵

在修改 WebGames 代码或配置后，必须在终端依次执行：

```bash
# 1. 运行原生 Python 静态提取门禁（极速剥离引擎冷启动，提速 87.5%）
python WebGames/scripts/py/audit_arch_static.py

# 2. 语法与静态规范检查
bash WebGames/scripts/sh/check-gdscript.sh
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/check-gdscript.ps1

# 3. 无头运行全量单元测试套件
bash WebGames/scripts/sh/test-run.sh
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/test-run.ps1

# 4. 执行 WebGames 专属全量门禁与配置审查
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```

---

## 八、 关联模板与参考指引

- [four-stage-blueprint-template/](templates/four-stage-blueprint-template/)：四阶段技术规范蓝图模板套件；
- [test_case_skeleton.gd](templates/test_case_skeleton.gd)：单元测试标准脚手架；
- [object-pooling-adv-prf-002.md](references/object-pooling-adv-prf-002.md)：对象池零瞬态分配深度指引。
