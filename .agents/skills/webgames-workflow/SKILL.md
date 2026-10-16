---
name: webgames-workflow
description: >-
  Godot 4 引擎纯逻辑解耦与配置驱动工作流。指导 Agent 在 WebGames 项目中执行先方案后编码施工纪律、
  全域配置驱动 (GameConfig)、视图表现层单向快照注入 (apply_snapshot) 与对象池循环零堆分配 (ADV-PRF-002)。
---

# webgames-workflow — Godot 4.7 引擎纯逻辑解耦与配置驱动开发规范

本技能规范了 `WebGames/` 项目中业务逻辑无头解耦、配置驱动同构化、前端可视化快照单向注入、强类型 Tabs 视图控制器、对象池零堆分配以及原生 Python 极速静态提取规范。

> [!IMPORTANT]
> **【项目技术栈本质与非 Web 游戏刚性红线】**：
> 本项目物理目录虽命名为 `WebGames/`（历史命名），但**绝对不是基于浏览器的 Web 游戏、网页游戏或 HTML5 游戏**！
> 其真实物理本质为**基于 Godot 4.7 引擎的卡拉尔世界纯逻辑解耦与配置驱动系统**，使用 **GDScript** 编写，面向桌面与无头独立架构。
> **严禁引入任何 DOM、HTML、CSS、Web API、浏览器运行环境或 JavaScript/TypeScript Web 前端技术栈！**

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

## 三、 全域配置驱动、核心领域闭环与 MOD SDK 契约

1. **统一读取入口与同构目录**：所有领域数值与静态资源统一经 `GameConfig.get_*` 从 `config/domains/<domain>/core.json` 及其子表读取（严禁根目录平铺配置表），支持点分路径访问（如 `GameConfig.get_value("economy.rates.tax")`）、细粒度热重载与 Schema 校验；
2. **账号物理仓储与权威会话核心 (`account/`)**：
   - `AccountDiskRepository` 负责账号本地物理持久化与临时快照原子落盘；
   - `AccountSessionStore` 与快照水化恢复器保障登录态、角色槽位及跨世界切换的幂等恢复；
   - `WorldGateway` 执行世界准入防越权校验，角色创建统一走权威创角与出生锚点分配管线，严禁前端伪造角色初始属性；
3. **MOD DAG 拓扑加载、SDK 静态萃取与双向零漂移工作流**：
   - MOD 加载器基于有向无环图（DAG）执行依赖拓扑排序、版本兼容校验与配置增量覆写，遇循环依赖或越界修改立即熔断隔离；
   - **单向静态 AST 萃取管线**：`sync_mod_sdk.py` 基于 AST 静态分析，从核心数据实体与求解器中自动化提取纯净公共契约，生成并同步至 `WebGames/mods/core_sdk/`；
   - **双向零漂移门禁看守**：`audit_sdk_sync.py` 严格校验 Core 与 `mods/core_sdk/` 保持 100% 差分等价；MOD 开发者严格且仅面向 `core_sdk` 编程，严禁直连或穿透调用底层求解器私有状态。

---

## 四、 前端可视化表现层边界（HUD 结构化切片流与强类型 Tabs 控制器）

`frontend/views/**` 必须保持纯粹的表现层定位，严守四大红线：
1. **视图零业务计算**：视图内严禁调用 `randf()`/`randi()` 伪造随机数、严禁内嵌汇率换算/概率判定/战斗数值公式、严禁自维护业务状态机与伪持久化状态；
2. **强类型 Tabs 视图控制器治理**：
   - 彻底消除 `var v = _view` 等弱类型缩写；
   - 视图控制器必须显式声明强类型子视图引用（如 `var _overview_view: OverviewView`），保障编译期静态类型检查与完整代码提示；
   - 严禁任何动态弱类型穿透与动态反射调用；
3. **HUD 结构化切片流单向注入**：业务数据一律通过强类型快照经由 `apply_snapshot(snapshot: Dictionary) -> void` 方法单向注入；视图严禁直读业务 Mock 或私自穿透读取未暴露的后端单例，消除前端状态滞留；
4. **单向依赖解耦与资源复用**：视图层仅允许依赖 UI 基础设施、展示组件与 i18n/主题模块，严禁直接依赖后端求解器或私有类；浮层、确认弹窗与通用面板优先复用全局管理器，避免节点泄漏。

---

## 五、 高承压对象池与循环内零瞬态堆分配 (`ADV-PRF-002`)

在每帧更新（`_process` / `_physics_process`）或高频事件循环中，严格落实零瞬态内存分配：
1. **严禁循环内裸调 `.new()` (`ADV-PRF-002`)**：频繁创建的对象（特效、弹道、伤害跳字、事件载荷）必须通过对象池进行借还；
2. **必须实现 `reset_state()` 契约**：归还对象池前或重新借出时，必须显式调用 `reset_state()` 彻底重置所有内部状态、数值与集合引用，杜绝脏数据残留；
3. **定长环形轨迹记忆 (Fixed 32-Slot RingBuffer)**：状态历史与轨迹记忆采用定长 32 槽位环形缓冲，双指针回环 $O(1)$ 覆盖写入与快照重现，严禁动态 `push/pop` 导致堆内存碎片；
4. **容器原位注入 (In-Place Injection)**：函数间传递或组装数据时，调用方传入预分配的 `Dictionary` 或 `Array`，由被调用方就地写入覆写，严禁在帧循环中分配并返回全新的临时容器；
5. **预分配容器容量与借还对称性**：容器预分配固定容量；获取时初始化并标记活跃，归还时执行 `reset_state()` 并重新入池，析构时统一释放。

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
5. **排版契约与体积预算**：GDScript 源码严格采用 LF 换行符、`snake_case` 命名风格与标准缩进；核心脚本受单文件双轨体积（$\text{ELOC} \le 900 / \text{LOC} \le 1400$）、1:3 动态反推包络及高负荷脚本（$\text{ELOC} \ge 600$）注释密度 $\ge 8\%$ 约束；
6. **模块头部文档契约**：核心后端求解器与视图控制器入口必须在首行呈现对齐工作区六字段标准的文档块（`Module`, `File Path`, `Architecture Role`, `Dependencies & Triggers`, `Responsibilities`, `Exit Semantics & Design Rationale`）；
7. **零高危技术债务防线**：全工作区 High/Critical 技术债务历史性归零（0 项），新增改动与架构改造严禁引入任何技术债务反弹（一票否决）；
8. **无头自动化测试并发生命周期与 WorkerThreadPool 汇合守卫**：
   - **后台任务互斥同步**：涉及多线程派发（如遥测流、后台计算）的服务（如 `AgentAsyncDispatcher`），必须内置 `Mutex` 锁保护核心队列；
   - **单任务防重入调度**：派发任务进入 `WorkerThreadPool` 前必须检测活跃 Task ID，严禁高频调用时创建无节制的并发孤儿任务；
   - **测试生命周期显式排空**：派发器必须对外提供同步 `pump()`（立即排空待处理队列）与 `flush()`/`teardown()`（等待后台任务完全退出并释放资源）接口；
   - **测试用例清理契约**：在集成测试用例的清理分支中，必须显式调用 `flush()` 清理后台任务，确保 Godot 引擎在无头模式退出时不会因等待未完成的工作线程而产生死锁超时（10000ms 挂起）；
   - **超时排错能见度**：测试运行脚本（`test-run.sh` / `test-run.ps1`）在发生超时失败时，必须自动截取并输出测试日志末尾最后 50 行，提供明确的挂死点上下文。

---

## 七、 专属构建、测试与审查命令矩阵

在修改 WebGames 代码或配置后，必须在终端依次执行：

```bash
# 1. 运行原生 Python 静态提取门禁（极速剥离引擎冷启动，提速 87.5%）
python WebGames/scripts/py/audit_arch_static.py

# 2. 校验 MOD SDK 契约双向零漂移
python WebGames/scripts/py/audit_sdk_sync.py

# 3. 语法与静态规范检查
bash WebGames/scripts/sh/check-gdscript.sh
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/check-gdscript.ps1

# 4. 无头运行全量单元测试套件
bash WebGames/scripts/sh/test-run.sh
# 或在 Windows PowerShell:
pwsh -File WebGames/scripts/ps1/test-run.ps1

# 5. 执行 WebGames 专属全量门禁与配置审查
pwsh -File WebGames/scripts/ps1/audit-all.ps1
```

---

## 八、 关联模板与参考指引

- [four-stage-blueprint-template/](templates/four-stage-blueprint-template/README.md)：四阶段技术规范蓝图模板套件（含阶段 1~4 模板）；
- [test_case_skeleton.gd](templates/test_case_skeleton.gd)：单元测试标准脚手架；
- [tab_view_controller_skeleton.gd](templates/tab_view_controller_skeleton.gd)：强类型 Tabs 视图控制器标准样板；
- [godot-architecture-non-web.md](references/godot-architecture-non-web.md)：Godot 4.7 引擎纯逻辑架构与非 Web 游戏技术栈规范指南；
- [object-pooling-adv-prf-002.md](references/object-pooling-adv-prf-002.md)：对象池零瞬态分配深度指引。
