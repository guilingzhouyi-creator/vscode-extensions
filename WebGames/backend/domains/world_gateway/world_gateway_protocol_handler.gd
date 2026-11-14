# ==============================================================================
# 模块归属: 业务领域层 (Domains · 世界网关集群 (World Gateway Domain))
# 文件路径: res://backend/domains/world_gateway/world_gateway_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: WorldGatewayFSM, ModeReadinessProbe
# 配置与信号: 契约 config/infrastructure/contracts.json
# 职责说明: 承接并解算世界网关领域客户端协议动作，分发网关进入、模式探测、档案选择与模式切换。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-GATEWAY-AUTH-2)
# ==============================================================================

## WorldGatewayProtocolHandler：世界网关领域客户端协议动作分发处理器
class_name WorldGatewayProtocolHandler
extends RefCounted

const ModeReadinessProbe = preload("res://backend/domains/world_gateway/mode_readiness_probe.gd")
const RemoteRealmDirectoryProvider = preload("res://backend/domains/world_gateway/remote_realm_directory_provider.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const WorldGatewaySessionActionHelper = preload("res://backend/domains/world_gateway/world_gateway_session_action_helper.gd")

## 分发客户端世界网关协议请求至状态机并返回统一响应包
static func dispatch(request: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	if request.action_type.begins_with("ESC_"):
		return EscMenuBackendService.handle_esc_action(request, gateway)

	var active_gateway := gateway
	if active_gateway == null and not request.account_id.is_empty():
		active_gateway = WorldGatewayFSM.new(request.account_id)
		WorldSessionRuntimeService.bind_gateway(active_gateway)
	if active_gateway == null:
		return UnifiedProtocolFactory.create_response(
			request.request_id, false, {}, "ERR_GATEWAY_NOT_BOUND", "Valid world gateway session instance not bound"
		)

	var request_payload: Dictionary = request.payload if request.payload is Dictionary else {}
	var world_response := _dispatch_world_and_session_action(request, request_payload, active_gateway)
	if world_response != null:
		return world_response
	var mod_response := _dispatch_mod_and_realm_action(request, request_payload, active_gateway)
	if mod_response != null:
		return mod_response
	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)


## 分发世界档案查询、选档、入界、离界与模式切换动作
static func _dispatch_world_and_session_action(
	request: ClientRequestEnvelopeDTO,
	request_payload: Dictionary,
	active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
	match request.action_type:
		"ENTER_GATEWAY":
			return WorldGatewaySessionActionHelper.handle_enter_gateway(request, active_gateway)
		"PROBE_MODES":
			var reports := ModeReadinessProbe.probe_all_modes(active_gateway.context.account_id)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"probe_reports": reports}, "", "Mode readiness probes refreshed successfully"
			)
		"LIST_WORLDS":
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"worlds": active_gateway.list_world_archives()}, "", "World archive list queried successfully"
			)
		"SELECT_MODE", "SELECT_OR_CREATE_WORLD":
			return WorldGatewaySessionActionHelper.handle_select_or_create_world(request, request_payload, active_gateway)
		"ATTACH_READY_CHARACTER":
			var target_character_id := str(request_payload.get("character_id", request.character_id))
			if target_character_id.is_empty():
				target_character_id = active_gateway.context.active_character_id
			var attach_result := active_gateway.attach_ready_character(target_character_id)
			var is_attach_succeeded := bool(attach_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_attach_succeeded, attach_result,
				"" if is_attach_succeeded else String(attach_result.get("error_code", "ERR_ATTACH_CHARACTER")),
				String(attach_result.get("message", "Ready character attached to gateway"))
			)
		"ENTER_WORLD":
			return WorldGatewaySessionActionHelper.handle_enter_world(request, request_payload, active_gateway)
		"DELETE_WORLD":
			return WorldGatewaySessionActionHelper.handle_delete_world(request, request_payload, active_gateway)
		"EXIT_WORLD_TO_GATEWAY":
			return WorldGatewaySessionActionHelper.handle_exit_world_to_gateway(request, request_payload, active_gateway)
		"SWITCH_GATEWAY_MODE":
			return WorldGatewaySessionActionHelper.handle_switch_gateway_mode(request, request_payload, active_gateway)
	return null


## 分发 MOD 发现预检、勾选切换、锁诊断与联机界域清单校验动作
static func _dispatch_mod_and_realm_action(
	request: ClientRequestEnvelopeDTO,
	request_payload: Dictionary,
	active_gateway: WorldGatewayFSM
) -> UnifiedResponseEnvelopeDTO:
	match request.action_type:
		"DISCOVER_MODS":
			var roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
			var enabled_ids: Array = request_payload.get("enabled_pack_ids", ["*"]) if request_payload.get("enabled_pack_ids") is Array else ["*"]
			var discover_result := active_gateway.discover_and_configure_single_player_mods(roots, enabled_ids)
			var is_discover_succeeded := bool(discover_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_discover_succeeded, discover_result,
				"" if is_discover_succeeded else String(discover_result.get("error_code", "ERR_DISCOVER_MODS")),
				String(discover_result.get("message", "Single-player mods discovered and prechecked"))
			)
		"PRECHECK_MODS":
			var enabled_pack_ids_override: Array = request_payload.get("enabled_pack_ids", ["*"]) if request_payload.get("enabled_pack_ids") is Array else ["*"]
			var precheck_result: Dictionary = {}
			if request_payload.has("candidate_packs") and request_payload.get("candidate_packs") is Array:
				precheck_result = active_gateway.precheck_and_configure_single_player_mods(request_payload.get("candidate_packs") as Array, enabled_pack_ids_override)
			else:
				var precheck_roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
				precheck_result = active_gateway.discover_and_configure_single_player_mods(precheck_roots, enabled_pack_ids_override)
			var is_precheck_succeeded := bool(precheck_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_precheck_succeeded, precheck_result,
				"" if is_precheck_succeeded else String(precheck_result.get("error_code", "ERR_PRECHECK_MODS")),
				String(precheck_result.get("message", "Single-player mods prechecked"))
			)
		"LIST_INSTALLED_MODS":
			var list_roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
			var list_result := active_gateway.list_installed_mods(list_roots)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, list_result, "", "Installed MOD catalog retrieved successfully"
			)
		"SET_MOD_SELECTION":
			var selection_ids: Array = request_payload.get("selected_pack_ids", request_payload.get("enabled_pack_ids", [])) if request_payload.get("selected_pack_ids", request_payload.get("enabled_pack_ids", [])) is Array else []
			var selection_roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
			var selection_update_result := active_gateway.set_mod_selection(selection_ids, selection_roots)
			var is_selection_succeeded := bool(selection_update_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_selection_succeeded, selection_update_result,
				"" if is_selection_succeeded else String(selection_update_result.get("error_code", "ERR_SET_MOD_SELECTION")),
				"MOD selection updated successfully" if is_selection_succeeded else String(selection_update_result.get("message", "Failed to apply MOD selection"))
			)
		"GET_WORLD_MOD_DIAGNOSTICS":
			var diag_world_id := str(request_payload.get("world_id", active_gateway.context.selected_world_id))
			var diag_roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
			var diag_result := active_gateway.get_world_mod_diagnostics(diag_world_id, diag_roots)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, diag_result, "", "World MOD diagnostics retrieved successfully"
			)
		"VERIFY_REALM_MANIFEST":
			var realm_manifest: Array = request_payload.get("realm_mod_manifest", []) if request_payload.get("realm_mod_manifest") is Array else []
			var realm_roots: Array = request_payload.get("custom_roots", []) if request_payload.get("custom_roots") is Array else []
			var verify_realm_result := active_gateway.verify_and_reconcile_realm_manifest(realm_manifest, realm_roots)
			var is_realm_verified := bool(verify_realm_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, is_realm_verified, verify_realm_result,
				"" if is_realm_verified else String(verify_realm_result.get("error_code", "MOD_ERR_REALM_DIGEST_MISMATCH")),
				"Realm MOD manifest verified successfully" if is_realm_verified else String(verify_realm_result.get("message", "Realm MOD digest mismatch"))
			)
		"LIST_REMOTE_REALMS":
			var realms := RemoteRealmDirectoryProvider.list_realms(active_gateway.context.account_id)
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, {"realms": realms}, "", "Remote realm directory retrieved successfully"
			)
	return null
