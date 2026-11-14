# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_world_service.gd
# 架构定位: Domain Boundary Interface / World Gateway & HUD Service Contract
# 依赖与触发: 上游: 世界网关与主页视图, ServiceContainer | 下游: RealWorldService, MockWorldService
# 职责说明: 规范主页 HUD 状态快照、世界网关模式选择、世界档案管理与地图路线规划边界接口。
# 退出语义与设计依据: 表现层零世界状态机逻辑与领域边界解耦契约
# ==============================================================================

## IWorldService：世界网关、世界档案与主页 HUD 数据服务抽象接口
class_name IWorldService
extends RefCounted

## 获取 HUD 权威状态快照 (对齐 HudStatusSnapshotDTO)
func get_hud_snapshot_async(character_id: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.get_hud_snapshot_async: pure virtual method must be implemented by subclass")

## 获取小地图地标与行军路线
func get_map_landmarks_async(result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.get_map_landmarks_async: pure virtual method must be implemented by subclass")

## 寻路规划：起终点索引 → 候选路线数组（视图只渲染）
func plan_routes(from_index: int, to_index: int) -> Array:
	if from_index < 0 or to_index < 0 or from_index == to_index:
		return []
	return [
		{"label": "A", "hours": 6, "danger_key": "ui.fe10.pf.danger_low", "cost": 50},
		{"label": "B", "hours": 4, "danger_key": "ui.fe10.pf.danger_mid", "cost": 80},
		{"label": "C", "hours": 3, "danger_key": "ui.fe10.pf.danger_high", "cost": 120},
	]

## 领地升级：建设完成与驻军提升规则（返回新领地副本）
func upgrade_territory(territory: Dictionary) -> Dictionary:
	var updated_territory: Dictionary = territory.duplicate(true)
	updated_territory["construction"] = 1.0
	updated_territory["garrison"] = int(updated_territory.get("garrison", 0)) + 10
	return {"success": true, "territory": updated_territory}

## 异步进入网关契约 (对齐 ENTER_GATEWAY)
func enter_gateway_async(account_id: String, token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.enter_gateway_async: pure virtual method must be implemented by subclass")

## 异步探针就绪度探测契约 (对齐 PROBE_MODES)
func probe_modes_async(account_id: String, token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.probe_modes_async: pure virtual method must be implemented by subclass")

## 异步世界档案列表查询契约 (对齐 LIST_WORLDS)
func list_worlds_async(account_id: String, token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.list_worlds_async: pure virtual method must be implemented by subclass")

## 异步模式与槽位选择契约 (对齐 SELECT_MODE)
func select_mode_async(account_id: String, token: String, mode_id: int, account_slots: Array, result_callback: Callable, _options: Dictionary = {}) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.select_mode_async: pure virtual method must be implemented by subclass")

## 异步选档/建档进入世界契约 (对齐 SELECT_OR_CREATE_WORLD)
func select_or_create_world_async(account_id: String, token: String, world_id: String, mode_id: int, result_callback: Callable, _options: Dictionary = {}) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.select_or_create_world_async: pure virtual method must be implemented by subclass")

## 异步关联就绪角色至网关契约 (对齐 ATTACH_READY_CHARACTER)
func attach_ready_character_async(_account_id: String, _token: String, _character_id: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.attach_ready_character_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步正式进入指定世界档案契约 (对齐 ENTER_WORLD，用于已存在角色直接入界)
func enter_world_async(_account_id: String, _token: String, _world_id: String, _allow_safe_degrade: bool, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.enter_world_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步发现并预检单机显性命途 MOD 契约 (对齐 DISCOVER_MODS)
func discover_mods_async(_account_id: String, _token: String, _enabled_pack_ids: Array, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.discover_mods_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步查询联机界域只读卡片列表契约 (对齐 LIST_REMOTE_REALMS)
func list_remote_realms_async(_account_id: String, _token: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.list_remote_realms_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步删除指定世界档案契约 (对齐 DELETE_WORLD)
func delete_world_async(_account_id: String, _token: String, _world_id: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.delete_world_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步切换网关模式契约 (对齐 SWITCH_GATEWAY_MODE)
func switch_gateway_mode_async(account_id: String, token: String, target_mode: int, result_callback: Callable, _options: Dictionary = {}) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.switch_gateway_mode_async: pure virtual method must be implemented by subclass")

## 异步退出世界退回网关契约 (对齐 EXIT_WORLD_TO_GATEWAY)
func exit_world_to_gateway_async(account_id: String, token: String, result_callback: Callable, _options: Dictionary = {}) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.exit_world_to_gateway_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步发现已安装官方与三方 MOD 包列表契约 (对齐 LIST_INSTALLED_MODS)
func list_installed_mods_async(_account_id: String, _token: String, _custom_roots: Array, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.list_installed_mods_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步更新当前会话选定的 MOD 包列表契约 (对齐 SET_MOD_SELECTION)
func set_mod_selection_async(_account_id: String, _token: String, _selected_pack_ids: Array, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.set_mod_selection_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步执行多 MOD 栈静态预检契约 (对齐 PRECHECK_MODS)
func precheck_mod_stack_async(_account_id: String, _token: String, _enabled_pack_ids: Array, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.precheck_mod_stack_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步查询指定世界存档的只读 MOD 锁定诊断契约 (对齐 GET_WORLD_MOD_DIAGNOSTICS)
func get_world_mod_diagnostics_async(_account_id: String, _token: String, _world_id: String, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.get_world_mod_diagnostics_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步校验联机界域权威清单 SHA-256 摘要契约 (对齐 VERIFY_REALM_MANIFEST)
func verify_realm_manifest_async(_account_id: String, _token: String, _realm_mod_manifest: Array, result_callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.verify_realm_manifest_async: pure virtual method must be implemented by subclass")
	if result_callback.is_valid():
		result_callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})
