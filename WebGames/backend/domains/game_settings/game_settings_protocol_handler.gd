# ==============================================================================
# 模块归属: 业务领域层 (Domains · 系统设置集群 (Game Settings Domain))
# 文件路径: res://backend/domains/game_settings/game_settings_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler
# 依赖与触发: 上游: UnifiedProtocolDispatcher, EscMenuBackendService | 下游: GameSettingsAggregate, SettingsApplyDriver, SettingsPersistenceService
# 职责说明: 承接游戏设置域统一协议动作（拉取、热应用与防黑屏回滚、分辨率确认、重置与持久化落盘）
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Zero-View-Math & Atomic Settings Persistence)
# ==============================================================================

## GameSettingsProtocolHandler：游戏设置域客户端协议动作分发处理器
class_name GameSettingsProtocolHandler
extends RefCounted

static var _active_settings: GameSettingsAggregate = null
static var _apply_driver: SettingsApplyDriver = null

static func _ensure_runtime() -> void:
	if _active_settings == null:
		_active_settings = GameSettingsAggregate.new()
	if _apply_driver == null:
		_apply_driver = SettingsApplyDriver.new()

## 重置游戏设置协议处理器静态运行时状态（供测试隔离调用）
static func reset_for_tests() -> void:
	_active_settings = null
	_apply_driver = null

## 分发游戏设置域客户端协议动作（GET/APPLY/CONFIRM/RESET）
static func dispatch(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	_ensure_runtime()
	var payload: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.action_type:
		"GET_GAME_SETTINGS":
			return _handle_get_settings(request)
		"APPLY_GAME_SETTINGS", "ESC_APPLY_SETTINGS":
			return _handle_apply_settings(request, payload)
		"CONFIRM_GAME_SETTINGS":
			_apply_driver.confirm_settings_applied()
			return UnifiedProtocolFactory.create_response(
				request.request_id,
				true,
				{"settings": _active_settings.serialize(), "is_pending_confirm": false},
				"",
				"Pending resolution settings confirmed successfully"
			)
		"RESET_GAME_SETTINGS":
			_active_settings = GameSettingsAggregate.new()
			_apply_driver.confirm_settings_applied()
			var save_result: Dictionary = {}
			if bool(payload.get("persist", false)):
				save_result = SettingsPersistenceService.save_to_file(_active_settings)
			EventBusCore.get_instance().emit_domain_event("game_settings.updated", _active_settings.serialize())
			return UnifiedProtocolFactory.create_response(
				request.request_id,
				true,
				{"settings": _active_settings.serialize(), "persisted": bool(save_result.get("success", false))},
				"",
				"Game settings reset to defaults successfully"
			)

	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

static func _handle_get_settings(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	var is_loaded_from_disk := false
	if FileAccess.file_exists(SettingsPersistenceService.DEFAULT_SETTINGS_PATH):
		var load_result := SettingsPersistenceService.load_from_file(_active_settings)
		is_loaded_from_disk = bool(load_result.get("success", false))
	return UnifiedProtocolFactory.create_response(
		request.request_id,
		true,
		{
			"settings": _active_settings.serialize(),
			"is_pending_confirm": _apply_driver.is_pending_confirm,
			"loaded_from_disk": is_loaded_from_disk
		},
		"",
		"Game settings retrieved successfully"
	)

static func _handle_apply_settings(request: ClientRequestEnvelopeDTO, payload: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var patch: Dictionary = payload.get("settings", payload) if payload.get("settings") is Dictionary else payload
	if not patch.is_empty():
		var render_raw: Variant = patch.get("render", null)
		if render_raw is Dictionary and ((render_raw as Dictionary).has("resolution_width") or (render_raw as Dictionary).has("resolution_height")):
			var render_settings_dictionary := render_raw as Dictionary
			var current_width := int(render_settings_dictionary.get("resolution_width", _active_settings.render_settings.get("resolution_width", 1920)))
			var current_height := int(render_settings_dictionary.get("resolution_height", _active_settings.render_settings.get("resolution_height", 1080)))
			var window_mode := str(render_settings_dictionary.get("window_mode", _active_settings.render_settings.get("window_mode", "EXCLUSIVE_FULLSCREEN")))
			_apply_driver.apply_resolution_with_revert_guard(_active_settings, current_width, current_height, window_mode)
		_active_settings.deserialize(patch)
		_apply_driver.validate_and_sanitize(_active_settings)

	var save_result: Dictionary = {}
	if bool(payload.get("persist", false)):
		save_result = SettingsPersistenceService.save_to_file(_active_settings)

	var serialized := _active_settings.serialize()
	EventBusCore.get_instance().emit_domain_event("game_settings.updated", serialized)
	return UnifiedProtocolFactory.create_response(
		request.request_id,
		true,
		{
			"applied_settings": serialized,
			"settings": serialized,
			"is_pending_confirm": _apply_driver.is_pending_confirm,
			"persisted": bool(save_result.get("success", false))
		},
		"",
		"Settings applied successfully"
	)
