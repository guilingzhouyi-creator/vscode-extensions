# WebGames/tests — 自动化测试体系与用例编写指南 (Test Engineering & Authoring Guide)

> 本目录为 WebGames（卡拉尔世界引擎）全域自动化测试工程体系根目录。  
> 全量无头运行：`pwsh scripts/ps1/test-run.ps1` ｜ 覆盖率审计：`python scripts/py/audit_test_coverage.py --strict`  
> 统一基类：[tests/support/test_case.gd](support/test_case.gd) ｜ 规范真源：[docs/模板/GD老练风格硬性规范标准.md](../docs/模板/GD老练风格硬性规范标准.md)（第八章）

---

## 一、 目录拓扑与分层职责 (Directory Topology)

全域测试实行物理分层隔离，**`tests/unit/` 根目录严格禁止散落任何测试脚本（0 散落红线，违规将阻断门禁）**：

```text
WebGames/tests/
├── unit/                         # 单元测试根目录（严禁直接放置 *.gd 脚本！）
│   ├── domains/                  # 后端纯领域模型与求解器单测（1:1 对齐 domains.json）
│   ├── frontend/                 # 前端状态机、视图模型与 UI 表现层逻辑单测
│   └── infrastructure/           # 核心基础设施层单测（事件总线、存储服务、日志等）
├── guards/                       # 架构守护、配置自检与契约防护套件
├── integration/
│   └── pipelines/                # 跨领域长链路、状态机联动与业务管道集成测试
├── fixtures/
│   └── factories/                # 测试数据装配器与伪数据工厂（严禁带 test_ 前缀）
├── support/                      # 测试框架底层基类与共享辅助库（TestCase）
├── test_runner.gd                # 无头批量测试运行主调度器
├── test_registry.gd              # 全域非领域测试套件自发现注册表
└── batch_syntax_checker.gd       # 语法与编译批量校验器
```

### 1.1 命名规范矩阵与公式

| 分层类别 | 目标存放目录 | 严格命名公式 | 命名示例 | 继承要求 |
| :--- | :--- | :--- | :--- | :--- |
| **纯后端领域** | `tests/unit/domains/` | `test_<domain_id>.gd`（1:1 对齐 `domains.json`） | `test_inventory.gd` | `extends TestCase` |
| **前端视图单测** | `tests/unit/frontend/` | `test_fe_NN_<view_name>.gd`（NN: 01~17 两位视图编号） | `test_fe_01_account_entry.gd` | `extends TestCase` |
| **前端基建单测** | `tests/unit/frontend/` | `test_frontend_<topic>.gd`（全小写语义前缀） | `test_frontend_robustness.gd` | `extends TestCase` |
| **底层基础设施** | `tests/unit/infrastructure/` | `test_<service>.gd` | `test_event_bus.gd` | `extends TestCase` |
| **架构与配置守护**| `tests/guards/` | `test_<name>_guard.gd`（长效单源，严禁随案卷分裂） | `test_frontend_boundary_guard.gd` | `extends TestCase` |
| **跨域业务管道** | `tests/integration/pipelines/` | `test_<name>_pipeline.gd` | `test_combat_dual_random_and_timeline_pipeline.gd` | `extends TestCase` |
| **测试夹具工厂** | `tests/fixtures/factories/` | `<entity>_factory.gd`（严禁 `test_` 前缀） | `contract_registry_factory.gd` | `extends RefCounted` |

### 1.2 测试命名绝对红线与禁止黑名单

全域测试文件名、符号与路径**严禁包含任何施工批次与临时性标记**，禁止词包括：`p[0-9]+`（如 `p82`）、`phase[0-9]+`、`st[0-9]+`、`fe[0-9]+`（除 `fe_01`~`fe_17` 视图单测外）、`temp`、`new`、`v[0-9]+`、`wip`。

| 违规类型 | ❌ 严禁的反例 | ✅ 正确的规范示范 | 治理与归并原则 |
| :--- | :--- | :--- | :--- |
| **施工批次黑话** | `test_fe_p82_robustness.gd` | `test_frontend_robustness.gd` | 前端通用基建单测统一使用 `test_frontend_<topic>.gd` |
| **前端非标前缀** | `test_ui_state_and_mock_services.gd` | `test_frontend_ui_state_and_mock.gd` | 消除无 `test_frontend_` 前缀的孤儿命名 |
| **护栏案卷分裂** | `test_frontend_p82_boundary_guard.gd` | 归并进 `test_frontend_boundary_guard.gd` | 护栏为全局防腐资产，新断言归并进既有同域护栏，禁建新文件 |
| **业务单测别名** | `test_inv.gd` / `test_p45_combat.gd` | `test_inventory.gd` | 严格 1:1 对齐 `domains.json` 的 `id`，禁缩写与批次号 |
| **数据工厂倒错** | `test_contract_registry_factory.gd` | `contract_registry_factory.gd` | 工厂不是测试用例，严禁冠以 `test_` 前缀 |

---

## 二、 规范化测试套件编写模板 (Test Suite Boilerplate)

所有测试脚本必须继承 `TestCase`（位于 `res://tests/support/test_case.gd`），并提供统一静态入口与结构化指标打包：

```gdscript
# ==============================================================================
# 模块路径: res://tests/unit/domains/test_example.gd
# 职责: 验证 ExampleDomain 核心数据契约与状态流转
# ==============================================================================
class_name TestExampleDomain
extends TestCase

## -----------------------------------------------------------------------------
## 统一测试运行入口 (Runner Entry Point)
## -----------------------------------------------------------------------------
static func run_all_tests() -> Dictionary:
	setup()
	var results: Array[Dictionary] = []

	results.append(_test_stage1_contracts())
	results.append(_test_stage2_state_transitions())
	results.append(_test_stage3_config_fallback())
	results.append(_test_stage4_boundary_defense())

	teardown()
	return TestCase.pack_results("example", results)

## -----------------------------------------------------------------------------
## 测试用例定义 (Test Cases)
## -----------------------------------------------------------------------------
static func _test_stage1_contracts() -> Dictionary:
	var model := ExampleModel.new()
	var ok := TestCase.assert_not_null(model, "模型实例非空")
	ok = ok and TestCase.assert_eq(model.get_type(), "DEFAULT", "契约类型默认对齐")
	return TestCase.make_result("stage1_contracts", ok)

static func _test_stage2_state_transitions() -> Dictionary:
	var model := ExampleModel.new()
	var res: Dictionary = model.transition_to("ACTIVE")
	var ok := TestCase.assert_true(res.get("success", false), "成功转移至活跃态")
	return TestCase.make_result("stage2_state_transitions", ok, {"extra_info": "state verified"})

static func _test_stage3_config_fallback() -> Dictionary:
	# 验证配置不存在时安全降级
	var val: int = GameConfig.get_int("domains.example", "missing_key", 42)
	var ok := TestCase.assert_eq(val, 42, "配置缺失时回退默认降级值")
	return TestCase.make_result("stage3_config_fallback", ok)

static func _test_stage4_boundary_defense() -> Dictionary:
	var model := ExampleModel.new()
	var res: Dictionary = model.transition_to("")
	var ok := TestCase.assert_false(res.get("success", true), "非法参数应被优雅拒绝")
	return TestCase.make_result("stage4_boundary_defense", ok)
```

---

## 三、 `TestCase` 核心 API 手册

| API 方法签名 | 作用说明 | 典型用法示例 |
| :--- | :--- | :--- |
| `assert_eq(actual, expected, msg)` | 断言严格相等 (`==`) | `TestCase.assert_eq(user.gold, 100)` |
| `assert_ne(actual, expected, msg)` | 断言不相等 (`!=`) | `TestCase.assert_ne(status, "ERROR")` |
| `assert_true(condition, msg)` | 断言布尔为 true | `TestCase.assert_true(res.success)` |
| `assert_false(condition, msg)` | 断言布尔为 false | `TestCase.assert_false(item.is_empty())` |
| `assert_null(val, msg)` | 断言为 null | `TestCase.assert_null(error)` |
| `assert_not_null(val, msg)` | 断言不为 null | `TestCase.assert_not_null(entity)` |
| `assert_gt(val, threshold, msg)` | 断言大于 (`>`) | `TestCase.assert_gt(health, 0)` |
| `assert_gte(val, threshold, msg)` | 断言大于等于 (`>=`) | `TestCase.assert_gte(level, 1)` |
| `assert_lt(val, threshold, msg)` | 断言小于 (`<`) | `TestCase.assert_lt(speed, 999)` |
| `assert_lte(val, threshold, msg)` | 断言小于等于 (`<=`) | `TestCase.assert_lte(weight, max_weight)` |
| `assert_almost_eq(a, b, epsilon, msg)` | 浮点数近似相等 | `TestCase.assert_almost_eq(rate, 0.333, 0.001)`|
| `assert_has_key(dict, key, msg)` | 字典包含指定键 | `TestCase.assert_has_key(data, "id")` |
| `make_result(name, passed, extra)` | 打包单个用例结构体 | `return TestCase.make_result("login", true)` |
| `pack_results(domain, results)` | 汇总打包整个套件指标 | `return TestCase.pack_results("auth", results)`|

---

## 四、 领域测试双向登记契约 (Registration SSOT)

新增或重命名后端领域测试时，必须在 `WebGames/config/infrastructure/domains.json` 的 `domains` 数组中完成 1:1 双向登记：

```json
{
  "id": "my_new_domain",
  "name": "My New Domain",
  "path": "backend/domains/my_new_domain",
  "test": "res://tests/unit/domains/test_my_new_domain.gd",
  "enabled": true
}
```

- **验证工具**：执行 `python scripts/py/audit_test_coverage.py --strict`，若配置声明与测试文件不匹配将直接报错。

---

## 五、 测试执行与本地验证命令

```bash
# 1. 运行全量测试套件（109 套件，快速无头）
powershell -ExecutionPolicy Bypass -File scripts/ps1/test-run.ps1
# 或 Linux/Git Bash:
bash scripts/sh/test-run.sh

# 2. 检查领域测试覆盖率与双向登记完整性
python WebGames/scripts/py/audit_test_coverage.py --strict

# 3. 运行全量 20 项工程质量门禁
powershell -ExecutionPolicy Bypass -File scripts/ps1/audit-all.ps1
```

---

## 六、 测试工程严禁违规的负面清单 (Prohibitions Matrix)

| 违规维度 | ❌ 严禁行为 (反例阻断) | ✅ 规范契约 (正例要求) | 门禁看守与机制 |
| :--- | :--- | :--- | :--- |
| **目录物理散落** | `tests/unit/` 根散落放置任何测试脚本 | 严格归入 `domains/` / `frontend/` / `infrastructure/` | `0 散落红线`，门禁阻断 |
| **测试裸随机** | 裸调用 `randf()` / `randi()` / `randomize()` | 统一经 `DeterministicRNG` 设置固定测试种子 | `audit_hardcode.py` |
| **高频堆分配污染** | 循环体内高频 `.new()` / `.duplicate(true)` | 遵守 `ADV-PRF-002`，预分配固定容器或对象复用 | `ADV-PRF-002` 门禁 |
| **环境与状态泄漏** | 总线监听未解绑、测试存档未清理 | `teardown()` 中幂等解绑 EventBus，沙箱路径销毁 | 测试无副作用契约 |
| **伪数据工厂倒错** | 工厂命名为 `test_<entity>_factory.gd` | 统一命名为 `<entity>_factory.gd`（严禁 `test_` 前缀） | `test_architecture_guard.gd` |
| **裸脚本无底座** | 脚本未继承 `TestCase`、自制断言 | 统一继承 `TestCase` 并调用 `pack_results` 打包汇总 | CI/CD 自动化汇总 |

