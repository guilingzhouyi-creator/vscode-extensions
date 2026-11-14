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

const WorldGatewayRenderHelper = preload("res://frontend/views/world_gateway/world_gateway_render_helper.gd")

var _view: BaseScreen = null
var _gateway_entered_dispatched: bool = false
var _prepared_world_id: String = ""

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
	var merged_snapshot: Dictionary = {}
	if not _gateway_entered_dispatched:
		_gateway_entered_dispatched = true
		world_service.enter_gateway_async(
			_view.current_account_id,
			_view.current_session_token,
			func(response_payload: Dictionary) -> void:
				WorldGatewayRenderHelper.collect_probe_snapshot(response_payload, merged_snapshot)
		)
	world_service.probe_modes_async(
		_view.current_account_id,
		_view.current_session_token,
		func(response_payload: Dictionary) -> void:
			WorldGatewayRenderHelper.collect_probe_snapshot(response_payload, merged_snapshot)
	)
	world_service.list_installed_mods_async(
		_view.current_account_id,
		_view.current_session_token,
		[],
		func(response_payload: Dictionary) -> void:
			WorldGatewayRenderHelper.collect_installed_mods_snapshot(response_payload, merged_snapshot)
	)
	world_service.list_worlds_async(
		_view.current_account_id,
		_view.current_session_token,
		func(response_payload: Dictionary) -> void:
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			merged_snapshot["worlds"] = data_map.get("worlds", [])
	)
	world_service.list_remote_realms_async(
		_view.current_account_id,
		_view.current_session_token,
		func(response_payload: Dictionary) -> void:
			var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
			merged_snapshot["realms"] = data_map.get("realms", response_payload.get("realms", []))
	)
	_view.apply_snapshot(merged_snapshot)

## 按列表索引选中单机世界档案并拉取其只读 MOD 诊断
func select_world_by_index(item_index: int) -> void:
	if _view == null or item_index < 0 or item_index >= _view.saved_worlds.size():
		return
	var entry: Variant = _view.saved_worlds[item_index]
	if entry is Dictionary:
		_view.selected_world_id = str((entry as Dictionary).get("world_id", ""))
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service != null and not _view.selected_world_id.is_empty():
		world_service.get_world_mod_diagnostics_async(
			_view.current_account_id,
			_view.current_session_token,
			_view.selected_world_id,
			func(response_payload: Dictionary) -> void:
				var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
				_view.last_world_diagnostics = data_map
				WorldGatewayRenderHelper.render_world_diagnostics(_view)
		)
	else:
		WorldGatewayRenderHelper.render_world_diagnostics(_view)

## 重置预选世界状态（切换模式后强制重新对齐选档上下文）
func reset_prepared_world_id() -> void:
	_prepared_world_id = ""

## 注销返回账号页时重置网关入站状态标记
func reset_session_flags() -> void:
	_gateway_entered_dispatched = false
	_prepared_world_id = ""

## 创建或选定单机世界档案
func create_and_select_world(target_world_id: String) -> Dictionary:
	var resolved_world_id := target_world_id if not target_world_id.is_empty() else "world_sp_%d" % Time.get_ticks_msec()
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
	var action_reply: Dictionary = {}
	world_service.select_or_create_world_async(
		_view.current_account_id,
		_view.current_session_token,
		resolved_world_id,
		1,
		func(response_payload: Dictionary) -> void:
			action_reply.merge(response_payload, true)
	)
	if not bool(action_reply.get("success", false)):
		var error_code := str(action_reply.get("error_code", "ERR_NO_BASE_CONTENT_MOD"))
		_view.last_error_code = error_code
		NavManager.get_instance().show_toast(error_code, NavTypes.ToastLevel.ERROR)
		return action_reply
	_view.selected_world_id = resolved_world_id
	_prepared_world_id = resolved_world_id
	refresh_gateway_state()
	return action_reply

## 选定并在网关层正式进入当前世界档案，按序章完成状态分流到 prologue 或 main_hud
func enter_selected_world() -> Dictionary:
	if _view == null or _view.selected_world_id.is_empty():
		NavManager.get_instance().show_toast(UIIntermediary.text("ui.wg.sp.no_world_selected"), NavTypes.ToastLevel.WARNING)
		return {"success": false, "error_code": "ERR_NO_WORLD_SELECTED"}
	var world_service: IWorldService = ServiceLocator.get_instance().world()
	if world_service == null:
		return {"success": false, "error_code": "ERR_SERVICE_UNAVAILABLE"}
	if _prepared_world_id != _view.selected_world_id:
		var select_reply: Dictionary = {}
		world_service.select_or_create_world_async(
			_view.current_account_id,
			_view.current_session_token,
			_view.selected_world_id,
			_view.current_gateway_mode,
			func(response_payload: Dictionary) -> void:
				select_reply.merge(response_payload, true)
		)
		if not bool(select_reply.get("success", false)):
			var select_error := str(select_reply.get("error_code", "ERR_GATEWAY_REJECTED"))
			if select_error != "INVALID_TRANSITION":
				NavManager.get_instance().show_toast(select_error, NavTypes.ToastLevel.ERROR)
				return select_reply
		_prepared_world_id = _view.selected_world_id
	var enter_reply: Dictionary = {}
	world_service.enter_world_async(
		_view.current_account_id,
		_view.current_session_token,
		_view.selected_world_id,
		false,
		func(response_payload: Dictionary) -> void:
			enter_reply.merge(response_payload, true)
	)
	if not bool(enter_reply.get("success", false)):
		var enter_error := str(enter_reply.get("error_code", "ERR_ENTER_WORLD_FAILED"))
		NavManager.get_instance().show_toast(enter_error, NavTypes.ToastLevel.ERROR)
		return enter_reply
	var data_map: Dictionary = enter_reply.get("data", enter_reply) as Dictionary
	var next_screen := "prologue" if bool(data_map.get("prologue_required", false)) else "main_hud"
	if _view.is_inside_tree() or _view.get_parent() != null:
		NavManager.get_instance().push_screen(next_screen, {
			"account_id": _view.current_account_id,
			"token": _view.current_session_token,
			"world_id": _view.selected_world_id
		})
	return enter_reply

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
