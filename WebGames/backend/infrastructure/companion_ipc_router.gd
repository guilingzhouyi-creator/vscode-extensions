# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 伴侣跨进程 IPC 路由)
# 文件路径: res://backend/infrastructure/companion_ipc_router.gd
# 架构定位: JSON-RPC Frame Authentication & Session/HotReload Method Router
# 依赖与触发: 上游: CompanionIPCServer | 下游: CryptoIntegrityLib | 协议: kalar.companion.ipc.v1
# 职责说明: 解析跨进程伴侣 JSON 帧、实施常量时间口令鉴权、路由观察/单步/回滚/黑匣子/热重载指令并构造标准化回执信封。
# 退出语义与设计依据: 纯路由与信封构造器，零套接字状态持有，便于无网络单元测试与解耦演化
# ==============================================================================

## CompanionIPCRouter：伴侣 JSON-RPC 帧鉴权与领域方法路由器
class_name CompanionIPCRouter
extends RefCounted

const PROTOCOL_VERSION: String = "kalar.companion.ipc.v1"

var _bound_session: RefCounted = null
var _hot_reload_solver: RefCounted = null
var _event_source_callback: Callable = Callable()


## 绑定长程推演会话实例（鸭子类型解耦）
func bind_session(session_instance: RefCounted) -> void:
	_bound_session = session_instance


## 绑定 MOD 现场热重载求解器实例
func bind_hot_reload_solver(reload_solver: RefCounted) -> void:
	_hot_reload_solver = reload_solver


## 绑定伴侣观测事件只读拉取回调
func bind_event_source(event_source_callback: Callable) -> void:
	_event_source_callback = event_source_callback


## 清空全部外部回调与会话弱引用
func reset_bindings() -> void:
	_bound_session = null
	_hot_reload_solver = null
	_event_source_callback = Callable()


## 解析单行 JSON 请求并执行鉴权与方法路由，返回标准响应信封
func dispatch_frame(
	frame_line: String,
	peer_slot: Dictionary,
	session_passphrase: String,
	loopback_host: String,
	bound_port: int
) -> Dictionary:
	var parsed_variant: Variant = JSON.parse_string(frame_line)
	if not (parsed_variant is Dictionary):
		return build_error_response("", "ERR_IPC_INVALID_JSON", "Malformed JSON frame")

	var frame_payload: Dictionary = parsed_variant as Dictionary
	var request_token: String = str(frame_payload.get("id", ""))
	var method_name: String = str(frame_payload.get("method", "")).strip_edges().to_lower()

	if not _authorize_peer_frame(frame_payload, peer_slot, session_passphrase):
		return build_error_response(request_token, "ERR_IPC_UNAUTHORIZED", "Valid session passphrase required")

	if method_name == "auth":
		return build_ok_response(request_token, {"authenticated": true, "protocol": PROTOCOL_VERSION})
	if method_name == "ping":
		return build_ok_response(request_token, {
			"status": "alive",
			"host": loopback_host,
			"port": bound_port,
			"protocol": PROTOCOL_VERSION,
		})

	return _route_domain_method(request_token, method_name, frame_payload)


## 构造成功响应信封
func build_ok_response(request_token: String, payload_body: Variant) -> Dictionary:
	return {
		"id": request_token,
		"ok": true,
		"protocol": PROTOCOL_VERSION,
		"payload": payload_body,
	}


## 构造失败响应信封
func build_error_response(request_token: String, error_code: String, error_text: String) -> Dictionary:
	return {
		"id": request_token,
		"ok": false,
		"protocol": PROTOCOL_VERSION,
		"error_code": error_code,
		"message": error_text,
	}


func _authorize_peer_frame(frame_payload: Dictionary, peer_slot: Dictionary, session_passphrase: String) -> bool:
	if bool(peer_slot.get("authenticated", false)):
		return true
	var candidate_secret: String = str(frame_payload.get("auth_token", ""))
	var parameters_block: Variant = frame_payload.get("params", {})
	if candidate_secret.is_empty() and parameters_block is Dictionary:
		candidate_secret = str((parameters_block as Dictionary).get("auth_token", ""))
	if not candidate_secret.is_empty() and CryptoIntegrityLib.constant_time_equals(candidate_secret, session_passphrase):
		peer_slot["authenticated"] = true
		return true
	return false


func _route_domain_method(request_token: String, method_name: String, frame_payload: Dictionary) -> Dictionary:
	var action_parameters: Dictionary = frame_payload.get("params", {}) if frame_payload.get("params") is Dictionary else {}
	match method_name:
		"get_observation":
			return _invoke_session_method(request_token, "get_current_observation", false, action_parameters)
		"step":
			return _invoke_session_method(request_token, "step", true, action_parameters)
		"rollback":
			return _invoke_session_method(request_token, "rollback", false, action_parameters)
		"inspect_blackbox":
			return build_ok_response(request_token, _collect_blackbox_state())
		"hot_reload_poll":
			return _invoke_reload_method(request_token, "poll_and_apply_changes")
		"hot_reload_status":
			return _invoke_reload_method(request_token, "get_status")
		_:
			return build_error_response(request_token, "ERR_IPC_UNKNOWN_METHOD", "Unsupported IPC method")


func _invoke_session_method(
	request_token: String,
	method_name: String,
	pass_parameters: bool,
	action_parameters: Dictionary
) -> Dictionary:
	if _bound_session == null or not _bound_session.has_method(method_name):
		return build_error_response(request_token, "ERR_SESSION_NOT_BOUND", "No playthrough session bound")
	if pass_parameters:
		return build_ok_response(request_token, _bound_session.call(method_name, action_parameters))
	return build_ok_response(request_token, _bound_session.call(method_name))


func _invoke_reload_method(request_token: String, method_name: String) -> Dictionary:
	if _hot_reload_solver == null or not _hot_reload_solver.has_method(method_name):
		return build_error_response(request_token, "ERR_HOT_RELOAD_NOT_BOUND", "No hot reload solver bound")
	return build_ok_response(request_token, _hot_reload_solver.call(method_name))


func _collect_blackbox_state() -> Dictionary:
	var diagnostic_dump: Dictionary = {}
	if _bound_session != null:
		var dump_variant: Variant = _bound_session.get("last_diagnostic_dump")
		if dump_variant is Dictionary:
			diagnostic_dump = (dump_variant as Dictionary).duplicate(true)
	var event_tail: Array = []
	if _event_source_callback.is_valid():
		var raw_events: Variant = _event_source_callback.call()
		if raw_events is Array:
			event_tail = (raw_events as Array).duplicate(true)
	return {
		"diagnostic_dump": diagnostic_dump,
		"recent_events": event_tail,
	}
