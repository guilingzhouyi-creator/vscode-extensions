---
档号: KALAR-DEV-2026-ST58-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST58 (Phase_62_后台运维视图与公告CRUD深化)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_62_后台运维视图与公告CRUD深化 —— 阶段2：运维视图接线与CRUD算法实现
形成日期: 2026-09-05
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: AdminConsoleView; NarrativeOrchestratorView; AdminConsoleView 视图骨架; NarrativeOrchestratorView 视图骨架; NotificationBulletin 视图扩展
---

# 施工细则：阶段2_运维视图接线与CRUD算法实现

> 施工开始日期：2026-09-05 下午（细则获批后触发）
> 责任人：卡拉尔世界引擎架构组
> 状态：📝 待获批（依赖 Phase 62 S1 获批）

> [!NOTE]
> **【施工目标】**：在 Phase 62 S1 建立的 15 条契约端点数据模型基础上，落地 2 个新后台视图（`admin_console_view` + `narrative_orchestrator_view`）的 `.gd` 实现骨架、扩展 `notification_bulletin` 视图的 `ops_announcement` Tab、并实现 4 个后台运维域 + 3 个 INFRA 只读仪表的接线算法——每个后台运维视图通过 `BaseViewContractBinder`（Phase 59 S2 已闭环）的五个钩子（`_contract_init` / `_refresh_contract_field` / `_subscribe_contract_events` / `_dispatch_contract_command` / `_handle_contract_error`）消费契约端点，并接入 GM 权限闸门、审计原因校验、CRUD 事务化三大新增算法。所有接线均**复用** Phase 57 建立的 `ContractParser` 三算法与 Phase 59 S2 建立的 `BaseViewContractBinder`，**禁止**重新实现契约解析器或视图基类。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST58-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST58-ATT_附件_案卷共享契约与上下文.md)。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST58-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST58-001_阶段1_后台运维视图入口与契约端点数据模型设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST58-003_阶段3_后台运维视图工程化与既有基础设施接入.md) ｜ [阶段4](KALAR-DEV-2026-ST58-004_阶段4_后台运维契约与视图端到端测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：
  - Phase 62 S1 建立的 15 条契约条目（`CT-AS-AC-01~03`、`CT-CV-AC-01~03`、`CT-NO-NV-01~03`、`CT-BB-NB-01~03`、`CT-WS-AC-01`、`CT-FT-AC-01`、`CT-TL-AC-01`）；
  - Phase 59 S2 建立的 `BaseViewContractBinder`（`_contract_init` / `_refresh_contract_field` / `_subscribe_contract_events` / `_dispatch_contract_command` / `_handle_contract_error`）；
  - Phase 57 S2 建立的 `ContractParser` 三算法（`resolve_dto_mapping` / `route_domain_event` / `dispatch_ui_command`）；
  - Phase 55 S2 建立的 `ValueDomainValidator`（VD_* 值域校验）；
  - `docs/audit/AUDIT_REPORT_UI缺失.md:132-137`：P2-6/P2-7/P2-8/P3-9 四条后台运维视图需求。

* **核心不变量约束断言**：
  - `Inv-OP2-1`（基类复用零重写）：2 个新后台视图 + `notification_bulletin` 扩展 Tab **必须**全部继承 `BaseViewContractBinder`，禁止在本阶段创建任何派生自 `Control` 直接实现契约钩子的独立视图；
  - `Inv-OP2-2`（权限闸门强制化）：`admin_console_view` 与 `narrative_orchestrator_view` 的 `_contract_init` **必须**首先调用 `_assert_gm_auth_scope()` 校验会话的 GM/OPS 权限级别；权限不足必须抛出 `ContractPermissionError`（承接 Phase 59 S2 建立的五态错误工厂），且**必须**在视图的 `_ready` 内以 3 秒超时快速失败，禁止阻塞主线程；
  - `Inv-OP2-3`（CRUD 事务化）：`BulletinBoardMaintenanceSolver.create_update_delete_announcement` 与 `CdkeyVoucherSolver.redeem_or_revoke` 的 COMMAND 派发**必须**通过 `ContractTransactionCoordinator`（本阶段新增，见 §3）串联"值域校验 → 审计原因校验 → 事务快照 → 契约派发 → 事件广播"五步，禁止视图直接调用后端；
  - `Inv-OP2-4`（审计原因强制）：所有 GM/OPS 命令的 `params_schema.audit_reason` 字段**必须**满足 `VD_AS_AUDIT_REASON_MINLEN`（≥ 8 字符、非纯空白、非占位符），违反必须拒绝派发并写入 `audit_config.py` 违规日志；
  - `Inv-OP2-5`（INFRA 只读保护）：3 条 INFRA 只读契约**必须**在 `_dispatch_contract_command` 内被显式拒绝（endpoint_kind == DTO 且 `infra_exempt == true`），返回 `ContractReadOnlyError`；禁止任何 UI 端点触发 INFRA 域写操作；
  - `Inv-OP2-6`（视图基类零修改）：本阶段**严禁**修改 `BaseViewContractBinder.gd`（Phase 59 S2 已闭环）与 `ContractParser.gd`（Phase 57 S2 已闭环）；所有新增算法必须在**新**文件内实现。

* **防漂移最高指示**：
  - 本阶段**只**实现视图接线算法 + 2 个新视图的 `.gd` 骨架 + 1 个新增 `ContractTransactionCoordinator`，**不**触碰任何后端 `.gd` 文件，也**不**修改既有视图的 `.gd` 实现（`notification_bulletin` 仅在 `_ready` 内追加 1 个 Tab 挂接点）；
  - 严禁在本阶段重复实现契约解析、值域校验、错误工厂——必须复用 Phase 57/59 已闭环的基础设施。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1. AdminConsoleView 视图骨架（.gd 实现）

```gdscript
# 文件：frontend/views/admin_console_view.gd
# 依赖：BaseViewContractBinder（Phase 59 S2）、ContractParser（Phase 57 S2）
# 契约消费：CT-AS-AC-01~03、CT-CV-AC-01~03、CT-WS-AC-01、CT-FT-AC-01、CT-TL-AC-01（共 9 条）
# 权限闸门：GM_L1（最低权限要求）

extends BaseViewContractBinder

class_name AdminConsoleView

const AUTH_SCOPE_REQUIRED := "GM_L1"

signal gm_command_submitted(command_id: String, payload: Dictionary)
signal cdkey_operation_submitted(voucher_id: String, operation: String)
signal dashboard_data_refreshed(tick: int)

func _init() -> void:
	_contract_domain_registry = {
		"ops_gm_panel": "admin_sandbox",
		"ops_cdkey": "cdkey_voucher",
		"ops_dashboard_world": "world_state",
		"ops_dashboard_canary": "feature_toggle_canary",
		"ops_dashboard_telemetry": "telemetry"
	}
	super._init()

# --- BaseViewContractBinder 钩子覆写 ---

func _contract_init() -> void:
	_assert_gm_auth_scope(AUTH_SCOPE_REQUIRED)
	_register_contracts_for_domains(["admin_sandbox", "cdkey_voucher", "world_state", "feature_toggle_canary", "telemetry"])
	_subscribe_contract_events("admin_sandbox.command_executed", "_on_gm_command_executed")
	_subscribe_contract_events("cdkey_voucher.batch_updated", "_on_cdkey_batch_updated")

func _refresh_contract_field(contract_id: String, path: String, value: Variant) -> void:
	# 委托给基类实现：ContractParser.resolve_dto_mapping 已完成字段映射
	super._refresh_contract_field(contract_id, path, value)

func _dispatch_contract_command(contract_id: String, params: Dictionary) -> void:
	# 权限闸门 + 审计原因校验 + 事务化派发（承接 Inv-OP2-3/4）
	var contract := ContractRegistryIndex.find_by_id(contract_id)
	if contract.infra_exempt:
		throw ContractReadOnlyError.new("INFRA 只读契约禁止派发: %s" % contract_id)
	_validate_audit_reason(params.get("audit_reason", ""))
	var txn := ContractTransactionCoordinator.begin({
		"contract_id": contract_id,
		"params": params,
		"initiated_by": SessionContext.current_gm_id()
	})
	# 派发契约命令（ContractParser.dispatch_ui_command 已实现）
	var result := ContractParser.dispatch_ui_command(contract_id, params)
	txn.commit(result)
	# 广播信号
	match contract_id.split("-")[1]:
		"AS":
			gm_command_submitted.emit(params.command_id, params.payload)
		"CV":
			cdkey_operation_submitted.emit(params.voucher_id, params.operation)

func _handle_contract_error(error: ContractError) -> void:
	match error.get_class():
		"ContractPermissionError":
			_show_permission_denied(error)
		"ContractReadOnlyError":
			_show_readonly_denied(error)
		"ContractValidationError":
			_show_validation_error(error)
		_:
			_show_generic_contract_error(error)

# --- GM 权限闸门（本阶段新增算法）---

func _assert_gm_auth_scope(required_scope: String) -> void:
	var session := SessionContext.current()
	if session == null:
		throw ContractPermissionError.new("会话未建立")
	var required_level := _parse_gm_level(required_scope)
	var actual_level := _parse_gm_level(session.gm_level)
	if actual_level < required_level:
		throw ContractPermissionError.new(
			"GM 权限不足: required=%s, actual=%s" % [required_scope, session.gm_level])

static func _parse_gm_level(scope: String) -> int:
	var level_map := {"NONE": 0, "L0": 0, "L1": 1, "L2": 2, "L3": 3, "L4": 4, "OPS": 3}
	return level_map.get(scope, -1)

# --- 审计原因校验（承接 Inv-OP2-4）---

static func _validate_audit_reason(reason: String) -> void:
	if reason.length() < 8:
		throw ContractValidationError.new("审计原因过短（< 8 字符）")
	if reason.strip_edges().length() == 0:
		throw ContractValidationError.new("审计原因仅包含空白字符")
	var placeholders := ["DUMMY", "PLACEHOLDER", "N/A", "test", "测试"]
	for p in placeholders:
		if reason.to_upper() == p.to_upper():
			throw ContractValidationError.new("审计原因使用占位符: %s" % p)
```

### 2. NarrativeOrchestratorView 视图骨架（.gd 实现）

```gdscript
# 文件：frontend/views/narrative_orchestrator_view.gd
# 依赖：BaseViewContractBinder（Phase 59 S2）、ContractParser（Phase 57 S2）
# 契约消费：CT-NO-NV-01~03（共 3 条）
# 权限闸门：OPS

extends BaseViewContractBinder

class_name NarrativeOrchestratorView

const AUTH_SCOPE_REQUIRED := "OPS"

signal dag_recompiled(dag_id: String, result: Dictionary)
signal dag_node_selected(node_id: String)
signal chronology_stage_changed(stage_id: String)

func _contract_init() -> void:
	_assert_gm_auth_scope(AUTH_SCOPE_REQUIRED)
	_register_contracts_for_domains(["narrative_orchestration"])
	_subscribe_contract_events("narrative_orchestration.dag_recompiled", "_on_dag_recompiled")

func _dispatch_contract_command(contract_id: String, params: Dictionary) -> void:
	var contract := ContractRegistryIndex.find_by_id(contract_id)
	if contract.infra_exempt:
		throw ContractReadOnlyError.new("INFRA 只读契约禁止派发: %s" % contract_id)
	_validate_audit_reason(params.get("audit_reason", ""))
	var result := ContractParser.dispatch_ui_command(contract_id, params)
	match params.operation:
		"RECOMPILE":
			dag_recompiled.emit(params.dag_id, result)
		"RUN":
			dag_recompiled.emit(params.dag_id, result)

func _handle_contract_error(error: ContractError) -> void:
	super._handle_contract_error(error)
```

### 3. ContractTransactionCoordinator（新增算法）

```gdscript
# 文件：frontend/views/_contract_transaction_coordinator.gd
# 依赖：ContractParser（Phase 57 S2）、ValueDomainValidator（Phase 55 S2）、EventBus（Phase 47）
# 职责：将 GM/OPS 命令的派发事务化为五步流水线（Inv-OP2-3）

extends RefCounted
class_name ContractTransactionCoordinator

static func begin(context: Dictionary) -> ContractTransaction:
	return ContractTransaction.new(context)

class_name ContractTransaction

var _context: Dictionary
var _snapshot_id: String
var _committed: bool = false

func _init(context: Dictionary) -> void:
	_context = context.duplicate(true)

func commit(result: Variant) -> void:
	_committed = true
	# 广播事务完成事件（承接 Phase 47 EventBus）
	EventBus.emit_signal("contract.transaction_committed", {
		"contract_id": _context.contract_id,
		"initiated_by": _context.initiated_by,
		"timestamp": Time.get_unix_time_from_system()
	})

func is_committed() -> bool:
	return _committed
```

### 4. NotificationBulletin 视图扩展（Tab 挂接）

```gdscript
# 文件：frontend/views/notification_bulletin.gd（Phase 62 只追加 1 个 Tab 挂接点，其他逻辑不变）
# 变更：在 _ready 内追加 ops_announcement Tab 挂载

func _ready() -> void:
	# ... 既有跑马灯初始化逻辑保持不变 ...

	# Phase 62 追加：ops_announcement Tab 挂载
	if SessionContext.current() != null and SessionContext.current().gm_level >= 3:
		var ops_tab := TabContainer.new()
		ops_tab.name = "ops_announcement"
		ops_tab.auth_scope = "OPS"
		# 挂接 bulletin_board_maintenance 契约（3 条）
		ops_tab.contract_domains = ["bulletin_board_maintenance"]
		add_child(ops_tab)
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 2.1**：新建 `frontend/views/admin_console_view.gd`（~200 行），继承 `BaseViewContractBinder`，实现 5 个钩子 + `_assert_gm_auth_scope` + `_validate_audit_reason`；
- [ ] **Step 2.2**：新建 `frontend/views/narrative_orchestrator_view.gd`（~120 行），继承 `BaseViewContractBinder`，实现 5 个钩子；
- [ ] **Step 2.3**：新建 `frontend/views/_contract_transaction_coordinator.gd`（~60 行），实现 `ContractTransactionCoordinator` + `ContractTransaction` 两类的 begin/commit 事务化派发；
- [ ] **Step 2.4**：修改 `frontend/views/notification_bulletin.gd` 的 `_ready` 方法，在跑马灯初始化后追加 `ops_announcement` Tab 挂载点（Inv-OP2-1 基类复用）；**严禁**修改其他逻辑；
- [ ] **Step 2.5**：在 `BaseViewContractBinder.gd` 中**只读**消费 5 个钩子的语义，本阶段**严禁**修改基类文件（Inv-OP2-6）；
- [ ] **Step 2.6**：在 `ContractParser.gd` 中**只读**消费 3 算法的语义，本阶段**严禁**修改解析器文件（Inv-OP2-6）；
- [ ] **Step 2.7**：GM 权限闸门失败路径**必须**在视图 `_ready` 内以 3 秒超时快速失败（使用 Godot 的 `await get_tree().create_timer(3.0).timeout`），禁止阻塞主线程；
- [ ] **Step 2.8**：所有 GM/OPS 命令派发前**必须**校验 `audit_reason` 长度 ≥ 8 字符（`VD_AS_AUDIT_REASON_MINLEN`），拒绝占位符（DUMMY/PLACEHOLDER/N/A/test/测试）；
- [ ] **Step 2.9**：INFRA 只读契约**必须**在 `_dispatch_contract_command` 内被拒绝，返回 `ContractReadOnlyError`（Inv-OP2-5）；
- [ ] **Step 2.10**：本阶段**禁止**：修改任何 `backend/domains/**` 文件、修改 `BaseViewContractBinder.gd`、修改 `ContractParser.gd`、修改 `ValueDomainValidator.gd`；
- [ ] **Step 2.11**：本阶段新增文件**不超过 3 个**（2 个视图 + 1 个事务协调器）；修改既有文件**不超过 1 个**（`notification_bulletin.gd`）；
- [ ] **Step 2.12**：本阶段新增断言数**控制在 12~16 条**，命名前缀统一 `TC-OP-S2-NN`；
- [ ] **Step 2.13**：所有新视图的 `get_auth_scope()` 静态方法返回值**必须**与 S1 声明的 `AUTH_SCOPE_REQUIRED` 常量一致（`admin_console_view.gd: "GM_L1"`、`narrative_orchestrator_view.gd: "OPS"`）；
- [ ] **Step 2.14**：所有契约命令派发必须通过 `ContractTransactionCoordinator.begin() → ContractParser.dispatch_ui_command() → Commit()` 三段式流水线，禁止直接调用 `ContractParser`；
- [ ] **Step 2.15**：错误处理路径必须完整覆盖五态错误工厂（`ContractPermissionError` / `ContractReadOnlyError` / `ContractValidationError` / `ContractTimeoutError` / `ContractUnknownError`）。

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :---: | :--- | :--- | :---: |
| `TC-OP-S2-01` | AdminConsoleView 骨架加载 | `preload("res://frontend/views/admin_console_view.gd")` | 类存在且 `instance_of(BaseViewContractBinder)` |
| `TC-OP-S2-02` | NarrativeOrchestratorView 骨架加载 | `preload("res://frontend/views/narrative_orchestrator_view.gd")` | 类存在且 `instance_of(BaseViewContractBinder)` |
| `TC-OP-S2-03` | ContractTransactionCoordinator 骨架加载 | `preload("res://frontend/views/_contract_transaction_coordinator.gd")` | 类存在且可实例化 `ContractTransactionCoordinator.begin(...)` |
| `TC-OP-S2-04` | 权限闸门拦截非 GM 会话 | 以 `gm_level: "NONE"` 的会话调用 `_assert_gm_auth_scope("GM_L1")` | 抛出 `ContractPermissionError` |
| `TC-OP-S2-05` | 权限闸门拦截低权限 GM | 以 `gm_level: "L0"` 的会话调用 `_assert_gm_auth_scope("GM_L1")` | 抛出 `ContractPermissionError`（required L1, actual L0） |
| `TC-OP-S2-06` | 权限闸门放行 GM_L2 | 以 `gm_level: "L2"` 的会话调用 `_assert_gm_auth_scope("GM_L1")` | 不抛异常，返回 void |
| `TC-OP-S2-07` | 审计原因过短拒绝 | 派发 `CT-AS-AC-03` 时 `audit_reason: "DUMMY"` | 抛出 `ContractValidationError`（占位符） |
| `TC-OP-S2-08` | 审计原因过短拒绝 | 派发 `CT-BB-NB-03` 时 `audit_reason: "短"` | 抛出 `ContractValidationError`（长度 < 8） |
| `TC-OP-S2-09` | 审计原因合法放行 | 派发 `CT-AS-AC-03` 时 `audit_reason: "补偿 GM 误操作"` | 派发成功，返回 `GmCommandResultDTO` |
| `TC-OP-S2-10` | INFRA 只读契约派发拒绝 | 派发 `CT-WS-AC-01` | 抛出 `ContractReadOnlyError`（Inv-OP2-5） |
| `TC-OP-S2-11` | INFRA 只读契约派发拒绝（canary） | 派发 `CT-FT-AC-01` | 抛出 `ContractReadOnlyError` |
| `TC-OP-S2-12` | INFRA 只读契约派发拒绝（telemetry） | 派发 `CT-TL-AC-01` | 抛出 `ContractReadOnlyError` |
| `TC-OP-S2-13` | Bulletin Tab 挂载条件 | `AdminConsoleView._parse_gm_level(SessionContext.current().gm_level) < 3` | `ops_announcement` Tab **未**挂载 |
| `TC-OP-S2-14` | Bulletin Tab 挂载条件 | `AdminConsoleView._parse_gm_level(SessionContext.current().gm_level) >= 3` | `ops_announcement` Tab 已挂载（子节点数增加 1） |
| `TC-OP-S2-15` | 事务化派发流水线完整 | 派发 `CT-AS-AC-03` 合法命令 | 观察到 `EventBus.contract.transaction_committed` 事件（含 `contract_id` / `initiated_by` / `timestamp`） |
| `TC-OP-S2-16` | 基类零修改（Inv-OP2-6） | `git diff BaseViewContractBinder.gd ContractParser.gd` | 空 diff（本阶段两文件未被触碰） |

---

## 附：第 2 轮实施收敛登记

> 【待第 2 轮细则收敛时填写】
> - 实际新增文件清单与行数：
> - `notification_bulletin.gd` 修改点确认（仅限 `_ready` 内追加 Tab 挂载）：
> - 5 个错误工厂错误类型全覆盖确认：
> - GM 权限闸门 3 秒超时快速失败落地验证：
> - 事务化派发 EventBus 广播落地验证：
> - 断言落地数 vs 计划数（12~16）的偏差：
> - 未闭环事项登记（如有）：
