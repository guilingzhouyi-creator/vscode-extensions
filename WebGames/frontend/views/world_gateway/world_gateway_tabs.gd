# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 世界网关与档案子控制器)
# 文件路径: res://frontend/views/world_gateway/world_gateway_tabs.gd
# 架构定位: Presentation Sub-Controller / Gateway Service Adapter Delegate
# 依赖与触发: 上游: WorldGatewayView | 下游: ServiceLocator, UIIntermediary, NavManager
# 职责说明: 协调 IWorldService 与 ILifecycleService 调用，渲染单机存档列表、
#           MOD锁定诊断及联机界域签名校验状态。
# 退出语义与设计依据: 随 WorldGatewayView 生命周期自动释放
# ==============================================================================
## WorldGatewayTabs：世界网关视图子面板逻辑与服务调用委托控制器
class_name WorldGatewayTabs
extends BaseScreen

var _view: BaseScreen = null
var _gateway_entered_dispatched: bool = false
var _prepared_world_id: String = ""
var _prepared_slot_id: String = ""

## 绑定所属世界网关主视图实例
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 从边界服务同步网关就绪态、单机档案与联机界域列表
func refresh_gateway_state() -> void:
	if _view == null:
		return
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return
	if not _gateway_entered_dispatched:
		_gateway_entered_dispatched = true
		world_service.enter_gateway_async(
			_view.current_account_id,
			_view.current_session_token,
			func(response_payload: Dictionary) -> void:
				var probe_patch: Dictionary = {}
				WorldGatewayRenderHelper.collect_probe_snapshot(response_payload, probe_patch)
				if _view != null and is_instance_valid(_view) and not probe_patch.is_empty():
					_view.apply_snapshot(probe_patch)
		)
	world_service.probe_modes_async(
		_view.current_account_id,
		_view.current_session_token,
		func(response_payload: Dictionary) -> void:
			var probe_patch: Dictionary = {}
			WorldGatewayRenderHelper.collect_probe_snapshot(response_payload, probe_patch)
			if _view != null and is_instance_valid(_view) and not probe_patch.is_empty():
				_view.apply_snapshot(probe_patch)
	)
	world_service.list_installed_mods_async(
		_view.current_account_id,
		_view.current_session_token,
		[],
		func(response_payload: Dictionary) -> void:
			var mods_patch: Dictionary = {}
			WorldGatewayRenderHelper.collect_installed_mods_snapshot(response_payload, mods_patch)
			if _view != null and is_instance_valid(_view) and not mods_patch.is_empty():
				_view.apply_snapshot(mods_patch)
	)
	world_service.list_worlds_async(
		_view.current_account_id,
		_view.current_session_token,
		func(response_payload: Dictionary) -> void:
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			if _view != null and is_instance_valid(_view):
				_view.apply_snapshot({"worlds": data_map.get("worlds", [])})
				if not _view.selected_world_id.is_empty():
					refresh_selected_world_diagnostics(_view.selected_world_id)
	)
	world_service.list_remote_realms_async(
		_view.current_account_id,
		_view.current_session_token,
		func(response_payload: Dictionary) -> void:
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			if _view != null and is_instance_valid(_view):
				_view.apply_snapshot({"realms": data_map.get("realms", response_payload.get("realms", []))})
	)

## 按世界 ID 刷新只读 MOD 锁诊断快照
func refresh_selected_world_diagnostics(world_id: String) -> void:
	if _view == null or world_id.is_empty():
		return
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return
	world_service.get_world_mod_diagnostics_async(
		_view.current_account_id,
		_view.current_session_token,
		world_id,
		func(response_payload: Dictionary) -> void:
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			_view.last_world_diagnostics = data_map
			WorldGatewayRenderHelper.render_world_diagnostics(_view)
	)

## 按列表索引选中单机世界档案并拉取其只读 MOD 诊断
func select_world_by_index(item_index: int) -> void:
	if _view == null or item_index < 0 or item_index >= _view.saved_worlds.size():
		return
	var entry: Variant = _view.saved_worlds[item_index]
	if entry is Dictionary:
		_view.selected_world_id = str((entry as Dictionary).get("world_id", ""))
	if not _view.selected_world_id.is_empty():
		refresh_selected_world_diagnostics(_view.selected_world_id)
	else:
		WorldGatewayRenderHelper.render_world_diagnostics(_view)

## 重置预选世界状态（切换模式后强制重新对齐选档上下文）
func reset_prepared_world_id() -> void:
	_prepared_world_id = ""
	_prepared_slot_id = ""

## 注销返回账号页时重置网关入站状态标记
func reset_session_flags() -> void:
	_gateway_entered_dispatched = false
	_prepared_world_id = ""
	_prepared_slot_id = ""

## 创建或选定单机世界档案
func create_and_select_world(target_world_id: String, on_completed: Callable = Callable()) -> Dictionary:
	var resolved_world_id := target_world_id if not target_world_id.is_empty() else "world_sp_%d" % Time.get_ticks_msec()
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var action_reply: Dictionary = {}
	world_service.select_or_create_world_async(
		_view.current_account_id,
		_view.current_session_token,
		resolved_world_id,
		1,
		func(response_payload: Dictionary) -> void:
			action_reply.merge(response_payload, true)
			if not bool(response_payload.get("success", false)):
				var error_code := str(response_payload.get("error_code", "ERR_NO_BASE_CONTENT_MOD"))
				if _view != null and is_instance_valid(_view):
					_view.last_error_code = error_code
				NavManager.get_instance().show_toast(error_code, NavTypes.ToastLevel.ERROR)
				if on_completed.is_valid():
					on_completed.call(response_payload)
				return
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			var context_map: Variant = data_map.get("context", {})
			_prepared_slot_id = str((context_map as Dictionary).get("selected_slot_id", "SLOT_01")) if context_map is Dictionary else "SLOT_01"
			if _view != null and is_instance_valid(_view):
				_view.selected_world_id = resolved_world_id
			_prepared_world_id = resolved_world_id
			refresh_gateway_state()
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return action_reply

## 选定并在网关层正式进入当前世界档案，若待创角则分流至 character_creation，否则按序章完成状态分流到 prologue 或 main_hud
func enter_selected_world(on_completed: Callable = Callable()) -> Dictionary:
	if _view == null or _view.selected_world_id.is_empty():
		NavManager.get_instance().show_toast(UIIntermediary.text("ui.wg.sp.no_world_selected"), NavTypes.ToastLevel.WARNING)
		var empty_reply := {"success": false, "error_code": "ERR_NO_WORLD_SELECTED"}
		if on_completed.is_valid():
			on_completed.call(empty_reply)
		return empty_reply
	return enter_world_with_routing(_view.selected_world_id, _view.current_gateway_mode, false, true, _prepared_slot_id, on_completed)

## 通用网关入界编排：执行选档挂载、按需路由权威创角或进入世界并分流序章/主界面
func enter_world_with_routing(
	world_id: String,
	mode_id: int,
	force_select: bool = false,
	create_if_missing: bool = true,
	fallback_slot_id: String = "",
	on_completed: Callable = Callable()
) -> Dictionary:
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var resolved_slot_id := fallback_slot_id if not fallback_slot_id.is_empty() else (_prepared_slot_id if not _prepared_slot_id.is_empty() else "SLOT_01")
	var result_holder: Dictionary = {}
	if not (force_select or _prepared_world_id != world_id):
		return _dispatch_enter_world_async(world_service, world_id, resolved_slot_id, result_holder, on_completed)
	world_service.select_or_create_world_async(
		_view.current_account_id,
		_view.current_session_token,
		world_id,
		mode_id,
		func(select_reply: Dictionary) -> void:
			_handle_select_world_for_entry(
				world_service, select_reply, world_id, resolved_slot_id, result_holder, on_completed
			),
		{"create_if_missing": create_if_missing}
	)
	return result_holder

func _handle_select_world_for_entry(
	world_service: IWorldService,
	select_reply: Dictionary,
	world_id: String,
	resolved_slot_id: String,
	result_holder: Dictionary,
	on_completed: Callable
) -> void:
	if not bool(select_reply.get("success", false)):
		var select_error := str(select_reply.get("error_code", "ERR_GATEWAY_REJECTED"))
		if select_error != "INVALID_TRANSITION":
			NavManager.get_instance().show_toast(select_error, NavTypes.ToastLevel.ERROR)
			result_holder.merge(select_reply, true)
			if on_completed.is_valid():
				on_completed.call(select_reply)
			return
		_dispatch_enter_world_async(world_service, world_id, resolved_slot_id, result_holder, on_completed)
		return
	_prepared_world_id = world_id
	var select_data: Dictionary = select_reply.get("data", select_reply) as Dictionary
	var routing_result: Variant = select_data.get("route_result", null)
	var context_value: Variant = select_data.get("context", null)
	var has_route_info: bool = (context_value is Dictionary) or (routing_result is Object)
	var effective_slot := resolved_slot_id
	var active_character_id := ""
	var needs_creation := false
	if context_value is Dictionary:
		var context_map := context_value as Dictionary
		var context_slot_id := str(context_map.get("selected_slot_id", ""))
		if not context_slot_id.is_empty():
			effective_slot = context_slot_id
			_prepared_slot_id = context_slot_id
		active_character_id = str(context_map.get("active_character_id", ""))
		needs_creation = bool(context_map.get("is_first_time_creation", false)) or active_character_id.is_empty()
	if routing_result is Object and "requires_character_creation" in routing_result:
		needs_creation = needs_creation or bool(routing_result.get("requires_character_creation"))
	if has_route_info and needs_creation:
		var route_reply := _route_to_character_creation(world_id, effective_slot)
		result_holder.merge(route_reply, true)
		if on_completed.is_valid():
			on_completed.call(route_reply)
		return
	if not active_character_id.is_empty():
		world_service.attach_ready_character_async(
			_view.current_account_id,
			_view.current_session_token,
			active_character_id,
			func(_attach_reply: Dictionary) -> void:
				_dispatch_enter_world_async(world_service, world_id, effective_slot, result_holder, on_completed)
		)
		return
	_dispatch_enter_world_async(world_service, world_id, effective_slot, result_holder, on_completed)

func _dispatch_enter_world_async(
	world_service: IWorldService,
	world_id: String,
	resolved_slot_id: String,
	result_holder: Dictionary,
	on_completed: Callable
) -> Dictionary:
	world_service.enter_world_async(
		_view.current_account_id,
		_view.current_session_token,
		world_id,
		false,
		func(response_payload: Dictionary) -> void:
			if not bool(response_payload.get("success", false)):
				var enter_error := str(response_payload.get("error_code", "ERR_ENTER_WORLD_FAILED"))
				if enter_error == "DIRECT_WORLD_BYPASS_BLOCKED" or enter_error == "ERR_CHARACTER_PENDING":
					var route_reply := _route_to_character_creation(world_id, resolved_slot_id)
					result_holder.merge(route_reply, true)
					if on_completed.is_valid():
						on_completed.call(route_reply)
					return
				result_holder.merge(response_payload, true)
				NavManager.get_instance().show_toast(enter_error, NavTypes.ToastLevel.ERROR)
				if on_completed.is_valid():
					on_completed.call(response_payload)
				return
			result_holder.merge(response_payload, true)
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			var next_screen := "prologue" if bool(data_map.get("prologue_required", false)) else "main_hud"
			var navigation_parameters: Dictionary = {
				"account_id": _view.current_account_id,
				"token": _view.current_session_token,
				"world_id": world_id
			}
			if data_map.get("initial_hud_snapshot") is Dictionary and not (data_map.get("initial_hud_snapshot") as Dictionary).is_empty():
				navigation_parameters["initial_hud_snapshot"] = (data_map.get("initial_hud_snapshot") as Dictionary).duplicate(true)
			if _view != null and is_instance_valid(_view) and _view.is_mounted_in_tree():
				NavManager.get_instance().push_screen(next_screen, navigation_parameters)
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return result_holder

func _route_to_character_creation(world_id: String, slot_id: String) -> Dictionary:
	var resolved_slot := slot_id if not slot_id.is_empty() else "SLOT_01"
	if _view.is_mounted_in_tree():
		NavManager.get_instance().push_screen("character_creation", {
			"account_id": _view.current_account_id,
			"token": _view.current_session_token,
			"world_id": world_id,
			"slot_id": resolved_slot
		})
	return {
		"success": true,
		"routed_to": "character_creation",
		"world_id": world_id,
		"slot_id": resolved_slot
	}

## 删除当前选中单机世界档案并刷新列表
func delete_selected_world() -> void:
	if _view == null or _view.selected_world_id.is_empty():
		return
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return
	world_service.delete_world_async(
		_view.current_account_id,
		_view.current_session_token,
		_view.selected_world_id,
		func(_response_payload: Dictionary) -> void:
			_view.selected_world_id = ""
			_prepared_world_id = ""
			refresh_gateway_state()
	)
