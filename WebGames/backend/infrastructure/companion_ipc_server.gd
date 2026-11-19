# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 伴侣跨进程 IPC 服务)
# 文件路径: res://backend/infrastructure/companion_ipc_server.gd
# 架构定位: Local Loopback Companion JSON-RPC TCP Server (127.0.0.1)
# 依赖与触发: 上游: ModWorkbench / Headless Harness | 下游: CompanionIPCRouter | 外部客户端: Python/Node Companion SDK
# 职责说明: 管理 127.0.0.1 回环端口监听套接字与有界客户端连接池，按行切片转发 UTF-8 JSON 帧至 CompanionIPCRouter 并对称清理全部句柄。
# 退出语义与设计依据: 仅限本地回环绑定，支持端口自动分配与对称 teardown() 资源释放契约
# ==============================================================================

## CompanionIPCServer：本地回环 JSON-RPC TCP 伴侣服务与连接生命周期托管器
class_name CompanionIPCServer
extends RefCounted

const PROTOCOL_VERSION: String = CompanionIPCRouter.PROTOCOL_VERSION
const LOOPBACK_HOST: String = "127.0.0.1"
const DEFAULT_PORT: int = 19420
const MAX_PEERS: int = 8
const MAX_LINE_BYTES: int = 65536

var _server: TCPServer = null
var _bound_port: int = 0
var _session_passphrase: String = ""
var _peers: Array[Dictionary] = []
var _router: CompanionIPCRouter = CompanionIPCRouter.new()
var _dispatched_count: int = 0


## 绑定长程推演会话实例（委托至路由器）
func bind_session(session_instance: RefCounted) -> void:
	_router.bind_session(session_instance)


## 绑定 MOD 现场热重载求解器实例（委托至路由器）
func bind_hot_reload_solver(reload_solver: RefCounted) -> void:
	_router.bind_hot_reload_solver(reload_solver)


## 绑定伴侣观测事件只读拉取回调（委托至路由器）
func bind_event_source(event_source_callback: Callable) -> void:
	_router.bind_event_source(event_source_callback)


## 在 127.0.0.1 回环地址启动局部 IPC 监听（端口为 0 时由系统分配空闲端口）
func start(listen_port: int = DEFAULT_PORT, session_passphrase: String = "") -> Dictionary:
	_stop_network_only()
	if listen_port < 0 or listen_port > 65535:
		return {"success": false, "error_code": "ERR_IPC_INVALID_PORT", "port": listen_port}
	var tcp_server := TCPServer.new()
	var listen_error: int = tcp_server.listen(listen_port, LOOPBACK_HOST)
	if listen_error != OK:
		return {"success": false, "error_code": "ERR_IPC_LISTEN_FAILED", "port": listen_port, "godot_error": listen_error}
	_server = tcp_server
	_bound_port = tcp_server.get_local_port()
	_session_passphrase = session_passphrase
	_dispatched_count = 0
	return {
		"success": true,
		"host": LOOPBACK_HOST,
		"port": _bound_port,
		"protocol": PROTOCOL_VERSION,
	}


## 查询回环监听套接字是否处于活跃监听状态
func is_listening() -> bool:
	return _server != null and _server.is_listening()


## 获取实际绑定的本地回环端口号
func get_bound_port() -> int:
	return _bound_port


## 获取当前服务监听状态、活跃客户端数与累计派发消息数
func get_server_metrics() -> Dictionary:
	return {
		"listening": is_listening(),
		"host": LOOPBACK_HOST,
		"port": _bound_port,
		"active_peers": _peers.size(),
		"dispatched_count": _dispatched_count,
		"protocol": PROTOCOL_VERSION,
	}


## 轮询接入回环连接并处理最多 max_messages 条换行分隔 JSON 指令，返回本次处理消息数
func poll(max_messages: int = 32) -> int:
	if not is_listening():
		return 0
	_accept_pending_connections()
	var processed_total: int = 0
	var index_cursor: int = _peers.size() - 1
	while index_cursor >= 0 and processed_total < max_messages:
		var peer_slot: Dictionary = _peers[index_cursor]
		var peer_socket: StreamPeerTCP = peer_slot.get("socket") as StreamPeerTCP
		if not _is_peer_alive(peer_socket):
			_close_peer_slot(peer_slot)
			_peers.remove_at(index_cursor)
			index_cursor -= 1
			continue
		processed_total += _drain_peer_lines(peer_slot, max_messages - processed_total)
		index_cursor -= 1
	return processed_total


## 对称关闭回环监听端口与全部活动客户端句柄，清空绑定引用防止退出泄漏
func teardown() -> void:
	_stop_network_only()
	_router.reset_bindings()


func _stop_network_only() -> void:
	for peer_slot in _peers:
		_close_peer_slot(peer_slot)
	_peers.clear()
	if _server != null:
		_server.stop()
		_server = null
	_bound_port = 0
	_session_passphrase = ""


func _accept_pending_connections() -> void:
	while _server != null and _server.is_connection_available():
		var incoming_peer: StreamPeerTCP = _server.take_connection()
		if incoming_peer == null:
			break
		if _peers.size() >= MAX_PEERS:
			incoming_peer.disconnect_from_host()
			continue
		incoming_peer.set_no_delay(true)
		_peers.append(_create_peer_slot(incoming_peer))


func _create_peer_slot(incoming_peer: StreamPeerTCP) -> Dictionary:
	return {
		"socket": incoming_peer,
		"pending_bytes": PackedByteArray(),
		"authenticated": _session_passphrase.is_empty(),
	}


func _is_peer_alive(peer_socket: StreamPeerTCP) -> bool:
	if peer_socket == null:
		return false
	peer_socket.poll()
	var socket_status: int = peer_socket.get_status()
	return socket_status == StreamPeerTCP.STATUS_CONNECTED or socket_status == StreamPeerTCP.STATUS_CONNECTING


func _close_peer_slot(peer_slot: Dictionary) -> void:
	var peer_socket: StreamPeerTCP = peer_slot.get("socket") as StreamPeerTCP
	if peer_socket != null:
		peer_socket.disconnect_from_host()


func _drain_peer_lines(peer_slot: Dictionary, remaining_budget: int) -> int:
	var peer_socket: StreamPeerTCP = peer_slot.get("socket") as StreamPeerTCP
	_append_available_socket_bytes(peer_slot, peer_socket)

	var pending_bytes: PackedByteArray = peer_slot.get("pending_bytes", PackedByteArray()) as PackedByteArray
	if pending_bytes.is_empty():
		return 0
	var handled_lines: int = 0
	var search_cursor: int = 0
	while handled_lines < remaining_budget:
		var newline_offset: int = pending_bytes.find(10, search_cursor)
		if newline_offset < 0:
			break
		var frame_line: String = pending_bytes.slice(search_cursor, newline_offset).get_string_from_utf8().strip_edges()
		search_cursor = newline_offset + 1
		if frame_line.is_empty():
			continue
		var response_packet: Dictionary = _router.dispatch_frame(
			frame_line, peer_slot, _session_passphrase, LOOPBACK_HOST, _bound_port
		)
		_write_peer_response(peer_socket, response_packet)
		handled_lines += 1
		_dispatched_count += 1
	if search_cursor > 0:
		peer_slot["pending_bytes"] = pending_bytes.slice(search_cursor) if search_cursor < pending_bytes.size() else PackedByteArray()
	return handled_lines


func _append_available_socket_bytes(peer_slot: Dictionary, peer_socket: StreamPeerTCP) -> void:
	var available_bytes: int = peer_socket.get_available_bytes()
	if available_bytes <= 0:
		return
	var clamped_bytes: int = mini(available_bytes, MAX_LINE_BYTES)
	var read_packet: Array = peer_socket.get_data(clamped_bytes)
	if read_packet.size() < 2 or int(read_packet[0]) != OK:
		return
	var raw_bytes: PackedByteArray = read_packet[1] as PackedByteArray
	var pending_bytes: PackedByteArray = peer_slot.get("pending_bytes", PackedByteArray()) as PackedByteArray
	pending_bytes.append_array(raw_bytes)
	if pending_bytes.size() > MAX_LINE_BYTES:
		pending_bytes.clear()
		_write_peer_response(peer_socket, _router.build_error_response("", "ERR_IPC_LINE_TOO_LONG", "Incoming JSON frame exceeds byte limit"))
	peer_slot["pending_bytes"] = pending_bytes


func _write_peer_response(peer_socket: StreamPeerTCP, response_packet: Dictionary) -> void:
	if peer_socket == null:
		return
	var line_bytes: PackedByteArray = (JSON.stringify(response_packet) + "\n").to_utf8_buffer()
	peer_socket.put_data(line_bytes)
