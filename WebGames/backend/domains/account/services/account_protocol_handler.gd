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
const AccountRegistrationDTO = preload("res://backend/domains/account/dto/account_registration_dto.gd")
const AccountCompositeAuthDTO = preload("res://backend/domains/account/dto/account_composite_auth_dto.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const HumanControlLeaseManager = preload("res://backend/domains/world_state/services/human_control_lease_manager.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

static func dispatch(request: ClientRequestEnvelopeDTO, _gateway: WorldGatewayFSM) -> UnifiedResponseEnvelopeDTO:
	var payload_dict: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.action_type:
		"REGISTER_ACCOUNT":
			var reg_req := AccountRegistrationDTO.Request.new()
			reg_req.username = str(payload_dict.get("username", ""))
			reg_req.password_plain = str(payload_dict.get("password_plain", ""))
			reg_req.device_fingerprint = str(payload_dict.get("device_fingerprint", ""))
			var auto_login := bool(payload_dict.get("auto_login", false))
			if auto_login:
				var auth_result := AuthService.register_and_login(reg_req, true)
				if bool(auth_result.get("success", false)):
					var registered_account_id := String(auth_result.get("account_id", ""))
					var session_token := String(auth_result.get("session_token", ""))
					WorldSessionRuntimeService.activate_authenticated_session(registered_account_id, session_token, WorldGatewayFSM.new(registered_account_id))
				return UnifiedProtocolFactory.create_response(
					request.request_id, bool(auth_result.get("success", false)), auth_result,
					"" if bool(auth_result.get("success", false)) else String(auth_result.get("error_code", "ERR_REGISTER_FAILED")),
					"Account registration succeeded" if bool(auth_result.get("success", false)) else "Account registration failed"
				)
			var reg_resp := AuthService.register_account(reg_req)
			return UnifiedProtocolFactory.create_response(
				request.request_id, reg_resp.success, reg_resp.to_dto(),
				"" if reg_resp.success else reg_resp.error_code,
				"Account registration completed" if reg_resp.success else "Account registration failed"
			)

		"LOGIN_LOCAL", "LOGIN_COMPOSITE":
			var comp_req := AccountCompositeAuthDTO.Request.new()
			comp_req.username = str(payload_dict.get("username", ""))
			comp_req.password_plain = str(payload_dict.get("password_plain", ""))
			comp_req.device_fingerprint = str(payload_dict.get("device_fingerprint", ""))
			var default_mode := AccountCompositeAuthDTO.MODE_LOGIN_ONLY if request.action_type == "LOGIN_LOCAL" else AccountCompositeAuthDTO.MODE_AUTO
			comp_req.action_mode = str(payload_dict.get("action_mode", default_mode))
			var auth_resp := AuthService.composite_authenticate(comp_req)
			if auth_resp.success:
				var gateway_instance := WorldGatewayFSM.new(auth_resp.account_id)
				WorldSessionRuntimeService.activate_authenticated_session(auth_resp.account_id, auth_resp.session_token, gateway_instance)
			var out_data := auth_resp.to_dto()
			var meta := AuthService.get_session_masked_metadata(auth_resp.session_token)
			out_data["masked_token_prefix"] = String(meta.get("token_prefix", ""))
			out_data["has_masked_token"] = bool(meta.get("has_masked_token", false))
			return UnifiedProtocolFactory.create_response(
				request.request_id, auth_resp.success, out_data,
				"" if auth_resp.success else auth_resp.error_code,
				"Login succeeded" if auth_resp.success else "Login failed"
			)

		"LOGOUT_ACCOUNT":
			var active_gateway := WorldSessionRuntimeService.get_gateway() as WorldGatewayFSM
			if WorldSessionRuntimeService.has_active_world() and active_gateway != null:
				active_gateway.exit_to_gateway()
			var logout_res := AuthService.logout_session(request.session_token, request.account_id)
			WorldSessionRuntimeService.revoke_account_session()
			HumanControlLeaseManager.release_lease()
			var home_vm := AuthService.build_account_home_view_model("", str(payload_dict.get("locale", "")))
			logout_res["account_home_vm"] = home_vm
			return UnifiedProtocolFactory.create_response(
				request.request_id, bool(logout_res.get("success", false)), logout_res,
				"" if bool(logout_res.get("success", false)) else String(logout_res.get("error_code", "ERR_LOGOUT_FAILED")),
				"Account logged out and runtime credentials revoked"
			)

		"GET_ACCOUNT_HOME_VIEW_MODEL":
			var home_view_model := AuthService.build_account_home_view_model(request.session_token, str(payload_dict.get("locale", "")))
			return UnifiedProtocolFactory.create_response(
				request.request_id, true, home_view_model, "", "Account home view model retrieved successfully"
			)

	return UnifiedProtocolFactory.create_response(
		request.request_id, false, {}, "ERR_UNHANDLED_ACTION",
		TemplateFormatter.format("Unsupported action type: {action_type}", {"action_type": request.action_type})
	)
