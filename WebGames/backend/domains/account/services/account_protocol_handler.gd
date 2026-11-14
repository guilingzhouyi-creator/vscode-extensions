# ==============================================================================
# 模块归属: 业务领域层 (Domains · 账号与凭据集群 (Account Domain))
# 文件路径: res://backend/domains/account/services/account_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: AuthService, WorldSessionRuntimeService
# 配置与信号: 契约 config/infrastructure/contracts.json
# 职责说明: 承接并解算账号领域客户端协议动作，分发注册、登录、注销与首页视图模型指令。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-SESSION-VAULT-3)
# ==============================================================================

## AccountProtocolHandler：账号领域客户端协议动作分发处理器
class_name AccountProtocolHandler
extends RefCounted

const AuthService = preload("res://backend/domains/account/auth_service.gd")
const AccountHomeViewModelBuilder = preload("res://backend/domains/account/services/account_home_view_model_builder.gd")
const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")
const AccountRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const AccountCompositeAuthDTO = preload("res://backend/domains/account/dto/account_composite_auth_dto.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

static func _activate_gateway_session(account_id: String, session_token: String) -> WorldGatewayFSM:
	var gateway_instance := WorldGatewayFSM.new(account_id)
	WorldSessionRuntimeService.activate_authenticated_session(account_id, session_token, gateway_instance)
	return gateway_instance

static func _load_account_or_null(account_id: String) -> AccountProfile:
	var repository := AccountRepository.get_instance()
	if repository == null:
		return null
	if not repository.is_loaded():
		repository.load_all()
	return repository.find_by_id(account_id)

## 分发处理账号领域客户端协议请求（注册、登录、游客登录、角色槽位查询/清理、注销与首页视图模型）
static func dispatch(request: ClientRequestEnvelopeDTO, _gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.action_type:
		"REGISTER_ACCOUNT":
			var register_request := AccountRegistrationDTO.Request.new()
			register_request.username = str(payload_dict.get("username", ""))
			register_request.password_plain = str(payload_dict.get("password_plain", ""))
			register_request.device_fingerprint = str(payload_dict.get("device_fingerprint", ""))
			var auto_login := bool(payload_dict.get("auto_login", false))
			if auto_login:
				var auth_result := AuthService.register_and_login(register_request, true)
				if bool(auth_result.get("success", false)):
					_activate_gateway_session(String(auth_result.get("account_id", "")), String(auth_result.get("session_token", "")))
				return UnifiedProtocolFactory.create_response(
					request.request_id, bool(auth_result.get("success", false)), auth_result,
					"" if bool(auth_result.get("success", false)) else String(auth_result.get("error_code", "ERR_REGISTER_FAILED")),
					"Account registration succeeded" if bool(auth_result.get("success", false)) else "Account registration failed"
				)
			var register_response := AuthService.register_account(register_request)
			return UnifiedProtocolFactory.create_response(
				request.request_id, register_response.success, register_response.to_dto(),
				"" if register_response.success else register_response.error_code,
				"Account registration completed" if register_response.success else "Account registration failed"
			)

		"LOGIN_LOCAL", "LOGIN_COMPOSITE":
			var composite_request := AccountCompositeAuthDTO.Request.new()
			composite_request.username = str(payload_dict.get("username", ""))
			composite_request.password_plain = str(payload_dict.get("password_plain", ""))
			composite_request.device_fingerprint = str(payload_dict.get("device_fingerprint", ""))
			var default_mode := AccountCompositeAuthDTO.MODE_LOGIN_ONLY if request.action_type == "LOGIN_LOCAL" else AccountCompositeAuthDTO.MODE_AUTO
			composite_request.action_mode = str(payload_dict.get("action_mode", default_mode))
			var auth_response := AuthService.composite_authenticate(composite_request)
			if auth_response.success:
				_activate_gateway_session(auth_response.account_id, auth_response.session_token)
			var response_payload := auth_response.to_dto()
			var session_metadata := AuthService.get_session_masked_metadata(auth_response.session_token)
			response_payload["masked_token_prefix"] = String(session_metadata.get("token_prefix", ""))
			response_payload["has_masked_token"] = bool(session_metadata.get("has_masked_token", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, auth_response.success, response_payload,
				"" if auth_response.success else auth_response.error_code,
				"Login succeeded" if auth_response.success else "Login failed"
			)

		"LOGIN_GUEST":
			var device_fingerprint := str(payload_dict.get("device_fingerprint", ""))
			var guest_account := AuthService.create_guest_account(device_fingerprint)
			var guest_repository := AccountRepository.get_instance()
			if guest_repository != null:
				if not guest_repository.is_loaded():
					guest_repository.load_all()
				guest_repository.save_account(guest_account)
			var guest_password := GameConfig.get_string(AuthService.DOMAIN_ACCOUNT_CONFIG, "auth/guest_password", "GUEST_NO_PASS")
			var auth_result := AuthService.authenticate_local(guest_account.username, guest_password, guest_account, device_fingerprint)
			if bool(auth_result.get("success", false)):
				_activate_gateway_session(guest_account.account_id, String(auth_result.get("token", "")))
			var guest_payload := {
				"success": bool(auth_result.get("success", false)),
				"account_id": guest_account.account_id,
				"username": guest_account.username,
				"is_guest_mode": true,
				"session_token": String(auth_result.get("token", "")),
				"world_state_ref": guest_account.world_state_ref,
				"save_slot_summaries": {}
			}
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(guest_payload["success"]), guest_payload,
				"" if bool(guest_payload["success"]) else String(auth_result.get("code", "ERR_GUEST_LOGIN_FAILED")),
				"Guest account logged in successfully" if bool(guest_payload["success"]) else "Guest login failed"
			)

		"LIST_CHARACTERS":
			var target_account_id := str(payload_dict.get("account_id", request.account_id))
			var listed_account := _load_account_or_null(target_account_id)
			var slots := AccountSlotBindingSolver.to_frontend_character_slots(listed_account) if listed_account != null else []
			return UnifiedProtocolFactory.create_response(
				request.request_id, listed_account != null, {"account_id": target_account_id, "characters": slots},
				"" if listed_account != null else "ERR_ACCOUNT_NOT_FOUND",
				"Character slot list retrieved successfully" if listed_account != null else "Account not found"
			)

		"CLEAR_SLOT":
			var clear_account_id := str(payload_dict.get("account_id", request.account_id))
			var clear_slot_id := str(payload_dict.get("slot_id", ""))
			var clear_account := _load_account_or_null(clear_account_id)
			if clear_account == null:
				return UnifiedProtocolFactory.create_response(
					request.request_id, false, {}, "ERR_ACCOUNT_NOT_FOUND", "Target account not found"
				)
			var clear_result := AccountSlotBindingSolver.clear_slot(clear_account, clear_slot_id)
			var clear_succeeded := bool(clear_result.get("success", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, clear_succeeded, clear_result,
				"" if clear_succeeded else String(clear_result.get("error_code", "ERR_CLEAR_SLOT_FAILED")),
				"Slot cleared successfully" if clear_succeeded else "Failed to clear character slot"
			)

		"LOGOUT_ACCOUNT":
			var active_gateway := WorldSessionRuntimeService.get_gateway() as WorldGatewayFSM
			if active_gateway != null:
				active_gateway.logout()
			var logout_result := AuthService.logout_session(request.session_token, request.account_id)
			var logout_succeeded := bool(logout_result.get("success", false))
			WorldSessionRuntimeService.revoke_account_session()
			HumanControlLeaseManager.release_lease()
			var home_view_model := AccountHomeViewModelBuilder.build_account_home_view_model("", str(payload_dict.get("locale", "")))
			logout_result["account_home_vm"] = home_view_model
			return UnifiedProtocolFactory.create_response(
				request.request_id, logout_succeeded, logout_result,
				"" if logout_succeeded else String(logout_result.get("error_code", "ERR_LOGOUT_FAILED")),
				"Account logged out and runtime credentials revoked" if logout_succeeded else "Logout failed"
			)

		"GET_ACCOUNT_HOME_VIEW_MODEL":
			var home_view_model := AccountHomeViewModelBuilder.build_account_home_view_model(request.session_token, str(payload_dict.get("locale", "")))
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, home_view_model, "", "Account home view model retrieved successfully"
			)

	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)
