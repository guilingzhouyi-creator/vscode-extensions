---
name: webgames-workflow
description: >-
  【触发：WebGames/Godot/GDScript/游戏逻辑/写玩法/对象池/快照注入】开发或修改 WebGames 游戏模块时必须触发。坚持全域 GameConfig 配置驱动、视图表现层单向快照注入(apply_snapshot)与循环零堆分配(ADV-PRF-002)。
---

# webgames-workflow — Godot 4.7 引擎纯逻辑解耦与配置驱动开发规范

本技能规范了 `WebGames/` 项目中业务逻辑无头解耦、全域配置驱动、前端单向快照注入、对象池循环零堆分配（`ADV-PRF-002`）及原生 Python 静态提取门禁。

> [!IMPORTANT]
> **【非 Web 游戏刚性红线】**：`WebGames/`（历史命名）是**基于 Godot 4.7 引擎与 GDScript 的卡拉尔世界纯逻辑解耦独立系统**，面向桌面与无头架构。**严禁引入任何 DOM、HTML、CSS、浏览器 API 或 JS/TS Web 前端技术栈！**

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | 游戏引擎与 Godot 视图（领域入口） |
| **前置** | —（作为领域入口，无前置） |
| **接续** | [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) |
| **并行支援** | [coding-craft](../coding-craft/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md)、[debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md) |
| **领域链** | 游戏引擎与 Godot 视图：webgames-workflow → algorithmic-operator-engineering → interaction-design-physics → test-benchmark-engineering |

**何时联动**：新玩法先出四阶段方案 → `spec-driven-development` + `webgames-workflow` + `test-benchmark-engineering`；热路径循环里出现对象分配 → `webgames-workflow` + `algorithmic-operator-engineering` + `complexity-budget`
<!-- SKILL-LINKS:END -->

## 一、 两轮施工周期与四阶段案卷铁律

在 `WebGames/docs/路线图/01_短期施工区/` 研发时，严格执行两轮周期：
1. **第 1 轮（检查 $\to$ 方案编制 $\to$ 严禁提前编码）**：核对序号连续性，依据 [four-stage-blueprint-template.md](templates/four-stage-blueprint-template.md) 编写 4 份分阶段规范蓝图（`001_数据契约与实体定义.md`、`002_业务逻辑实现与状态机流转.md`、`003_全域配置驱动与泛化路由接入.md`、`004_全量回归验收与防复发门禁测试矩阵.md`，案卷目录严禁自造 `README.md` 或多余文件），**汇报并等待用户批准，未获批前严禁写业务代码或改路线图状态**；
2. **第 2 轮（获批编码 $\to$ 全量验收 $\to$ 闭环归位）**：获批后按阶段 1~4 编码，通过 Python 静态门禁与无头测试后更新 `路线图总索引.md`（每满 10 个案卷归档至 `03_短期施工档案卷/`）。

---

## 二、 全域配置驱动、表现层单向快照与 MOD SDK 契约

1. **全域 `GameConfig` 驱动**：所有领域数值统一经 `GameConfig.get_*` 从 `config/domains/<domain>/core.json` 读取（严禁根目录平铺配置表），支持点分路径与热重载；
2. **账号仓储与 MOD SDK 双向零漂移**：
   - `AccountDiskRepository` 负责原子落盘，`AccountSessionStore` 与 `WorldGateway` 执行会话幂等恢复与世界准入校验；
   - `sync_mod_sdk.py` 经 AST 静态萃取公共契约至 `WebGames/mods/core_sdk/`，由 `audit_sdk_sync.py` 看守 Core 与 `core_sdk` 100% 差分等价（公开规范见 [SPECIFICATION.md](../../../WebGames/mod_sdk/docs/SPECIFICATION.md)、[AGENT_INTERACTION.md](../../../WebGames/mod_sdk/docs/AGENT_INTERACTION.md)、[COMPANION_PROTOCOL.md](../../../WebGames/mod_sdk/docs/COMPANION_PROTOCOL.md)、[TOTAL_CONVERSION_SPEC.md](../../../WebGames/mod_sdk/docs/TOTAL_CONVERSION_SPEC.md)、[ART_AND_ASSETS_GUIDE.md](../../../WebGames/mod_sdk/docs/ART_AND_ASSETS_GUIDE.md)）；
3. **前端表现层四大红线 (`frontend/views/**`)**：
   - **视图零业务计算**：严禁调用 `randf()`/`randi()` 或内嵌战斗/汇率公式；
   - **强类型 Tabs 控制器**：显式声明强类型子视图引用（如 `var _overview_view: OverviewView`），消除弱类型缩写与反射穿透；
   - **单向快照注入**：业务数据唯一入口为 `apply_snapshot(snapshot: Dictionary) -> void`，严禁直读后端求解器私有状态。

---

## 三、 对象池循环零分配 (`ADV-PRF-002`) 与无头测试工程化

1. **高承压对象池与定长环形缓冲**：帧循环（`_process` / `_physics_process`）与高频事件流严禁裸调 `.new()`（`ADV-PRF-002`）；池化对象必须实现 `reset_state()` 对称借还；轨迹历史采用定长 32 槽位 RingBuffer 与容器原位注入；
2. **原生 Python 静态门禁与无头测试汇合**：
   - `audit_arch_static.py` 剥离 Godot 冷启动直接执行 AST 审计（提速 87.5%）；
   - 测试脚本按 `tests/unit/{domains,frontend,infrastructure}/` 归位（根目录 0 散落），继承 `TestCase` 并在 `domains.json` 与 `test_registry.gd` 双向注册；
   - 多线程派发器（如 `AgentAsyncDispatcher`）必须内置 `Mutex` 防重入并提供 `pump()` / `flush()` / `teardown()`，测试清理分支显式 `flush()` 防无头退出死锁，超时自动打印日志末尾 50 行。

---

## 四、 验证命令与关联资产

```bash
python WebGames/scripts/py/audit_arch_static.py && python WebGames/scripts/py/audit_sdk_sync.py
pwsh -File WebGames/scripts/ps1/check-gdscript.ps1 && pwsh -File WebGames/scripts/ps1/test-run.ps1
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```

- [godot-architecture-non-web.md](references/godot-architecture-non-web.md)：三层解耦拓扑、非 Web 红线与 `ADV-PRF-002` 对象池 `reset_state()` 深度规范；
- [four-stage-blueprint-template.md](templates/four-stage-blueprint-template.md)：阶段 001~004 四阶段技术规范蓝图一体化标准骨架；
- [tab_view_controller_skeleton.gd](templates/tab_view_controller_skeleton.gd) / [test_case_skeleton.gd](templates/test_case_skeleton.gd)：强类型视图控制器与无头单测样板（编码风格须遵循 [GD老练风格硬性规范标准.md](../../../WebGames/docs/模板/GD老练风格硬性规范标准.md)）。
