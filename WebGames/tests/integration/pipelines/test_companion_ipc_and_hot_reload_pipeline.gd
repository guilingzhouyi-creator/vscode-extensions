# ==============================================================================
# 模块归属: 集成测试流水线 (Integration Pipelines · Companion IPC & Hot Reload)
# 文件路径: res://tests/integration/pipelines/test_companion_ipc_and_hot_reload_pipeline.gd
# 架构定位: 跨进程回环 IPC 协议、MOD 热重载回滚与工坊增删改全链路集成测试套件
# 依赖与触发: 上游: TestRegistry | 下游: CompanionIPCServer, ModHotReloadSolver, WorldModLifecycleHelper
# ==============================================================================

## 跨进程伴侣 IPC 回环、MOD 热重载原子回滚与生命周期增删改全链路测试套件
class_name TestCompanionIpcAndHotReloadPipeline
extends RefCounted


static func run_all_tests() -> Dictionary:
	var outcomes: Array[Dictionary] = [
		_test_loopback_ipc_handshake_and_session(),
		_test_hot_reload_watch_and_rollback(),
		_test_mod_lifecycle_update_and_delete(),
	]
	var passed_count: int = 0
	for entry in outcomes:
		if bool(entry.get("passed", false)):
			passed_count += 1
	return {
		"domain": "Domain Pipeline: 伴侣回环 IPC、热重载回滚与 MOD 工坊增删改链路",
		"passed_count": passed_count,
		"total_count": outcomes.size(),
		"all_passed": passed_count == outcomes.size(),
		"results": outcomes,
	}


static func _test_loopback_ipc_handshake_and_session() -> Dictionary:
	CompanionObserverBus.reset_for_tests()
	var session_instance := AgentPlaythroughSession.new()
	session_instance.start_session({
		"mod_dirs": ["res://mod_sdk/templates/starter_story"],
		"enabled_pack_ids": ["*"],
		"character_name": "测试旅人",
		"race_id": "HUMAN",
		"origin_id": "STARTER_ASTRAL_INITIATE",
		"seed": 42,
	})
	var server_instance := CompanionIPCServer.new()
	var bus_instance := CompanionObserverBus.get_instance()
	server_instance.bind_session(session_instance)
	server_instance.bind_event_source(Callable(bus_instance, "get_recent_events"))
	var start_outcome: Dictionary = server_instance.start(0, "loopback_secret_key")
	var bound_port: int = int(start_outcome.get("port", 0))

	var client_socket := StreamPeerTCP.new()
	var connect_status: int = client_socket.connect_to_host("127.0.0.1", bound_port)
	var connected: bool = connect_status == OK and _wait_tcp_connected(client_socket, server_instance)

	var unauth_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c1", "method": "ping"}) if connected else {}
	var auth_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c2", "method": "auth", "auth_token": "loopback_secret_key"}) if connected else {}
	var ping_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c3", "method": "ping"}) if connected else {}
	var observe_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c4", "method": "get_observation"}) if connected else {}
	var step_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c5", "method": "step", "params": {"choice_id": "NODE_STARTER_EXPLORE"}}) if connected else {}
	var rollback_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c6", "method": "rollback"}) if connected else {}
	var blackbox_reply: Dictionary = _roundtrip_ipc(client_socket, server_instance, {"id": "c7", "method": "inspect_blackbox"}) if connected else {}

	client_socket.disconnect_from_host()
	server_instance.teardown()
	CompanionObserverBus.reset_for_tests()

	var unauth_blocked: bool = not bool(unauth_reply.get("ok", true)) and str(unauth_reply.get("error_code", "")) == "ERR_IPC_UNAUTHORIZED"
	var auth_succeeded: bool = bool(auth_reply.get("ok", false)) and bool(ping_reply.get("ok", false))
	var step_payload: Dictionary = step_reply.get("payload", {}) as Dictionary
	var rollback_payload: Dictionary = rollback_reply.get("payload", {}) as Dictionary
	var observation_ready: bool = bool(observe_reply.get("ok", false)) and str(step_payload.get("current_node_id", "")) == "NODE_STARTER_EXPLORE" and int(rollback_payload.get("step_index", -1)) == 0
	var blackbox_ready: bool = bool(blackbox_reply.get("ok", false))
	var server_closed: bool = not server_instance.is_listening()
	var all_checks_passed: bool = bool(start_outcome.get("success", false)) and connected and unauth_blocked and auth_succeeded and observation_ready and blackbox_ready and server_closed
	return {"test": "TC-IPC-01: 127.0.0.1 回环口令鉴权、推演观察与黑匣子 IPC 链路", "passed": all_checks_passed}


static func _test_hot_reload_watch_and_rollback() -> Dictionary:
	var root_directory: String = ProjectSettings.globalize_path("user://tmp_companion_hot_reload_suite")
	_cleanup_directory(root_directory)
	WorldModPackageOpsHelper.ensure_directory_recursive(root_directory)
	var manifest_file: String = root_directory.path_join("pack.json")
	WorldModPackageOpsHelper.write_json_file(manifest_file, {"pack_id": "hot_pack", "version": "1.0.0"})

	var live_state: Dictionary = {"version": "1.0.0"}
	var reload_solver := ModHotReloadSolver.new()
	reload_solver.bind_reload_pipeline(
		Callable(),
		func(_changed: Array, _latest: Dictionary) -> void: live_state["version"] = "1.0.1",
		func() -> Dictionary: return live_state.duplicate(true)
	)
	var watch_report: Dictionary = reload_solver.watch_directory(root_directory)
	var idle_report: Dictionary = reload_solver.poll_and_apply_changes()

	WorldModPackageOpsHelper.write_json_file(manifest_file, {"pack_id": "hot_pack", "version": "1.0.1"})
	reload_solver.invalidate_file_baseline_for_test(manifest_file)
	var apply_report: Dictionary = reload_solver.poll_and_apply_changes()

	var corrupt_handle := FileAccess.open(manifest_file, FileAccess.WRITE)
	if corrupt_handle != null:
		corrupt_handle.store_string("{invalid json syntax")
		corrupt_handle.close()
	reload_solver.invalidate_file_baseline_for_test(manifest_file)
	var rollback_report: Dictionary = reload_solver.poll_and_apply_changes()
	var status_snapshot: Dictionary = reload_solver.get_status()

	reload_solver.clear_watches()
	_cleanup_directory(root_directory)

	var apply_ok: bool = bool(watch_report.get("success", false)) and not bool(idle_report.get("changed", true)) and bool(apply_report.get("success", false))
	var rollback_ok: bool = not bool(rollback_report.get("success", true)) and bool(rollback_report.get("rolled_back", false)) and int(status_snapshot.get("revision", 0)) == 1
	return {"test": "TC-HOTRELOAD-01: JSON 增量扫描生效与畸形文件原子回滚", "passed": apply_ok and rollback_ok}


static func _test_mod_lifecycle_update_and_delete() -> Dictionary:
	var protected_reply: Dictionary = WorldModLifecycleHelper.delete_mod_pack({"pack_id": "core_base_pack", "is_official": true})
	var protected_blocked: bool = not bool(protected_reply.get("success", true)) and str(protected_reply.get("error_code", "")) == "ERR_PROTECTED_BASE_MOD"

	var sandbox_root: String = ProjectSettings.globalize_path("user://tmp_mod_lifecycle_suite")
	_cleanup_directory(sandbox_root)
	var pack_directory: String = sandbox_root.path_join("studio_sample_pack")
	WorldModPackageOpsHelper.ensure_directory_recursive(pack_directory)
	WorldModPackageOpsHelper.write_json_file(pack_directory.path_join("pack.json"), {
		"pack_id": "studio_sample_pack",
		"pack_name": "工坊样板模组",
		"version": "1.0.0",
		"author": "KalarAuthor",
		"engine_api_version": "1.0.0",
		"priority": 120,
		"dependencies": [],
		"incompatible_packs": [],
		"semantic_tags": ["story"],
		"is_active": true,
	})

	var update_reply: Dictionary = WorldModLifecycleHelper.update_mod_manifest({
		"pack_id": "studio_sample_pack",
		"target_root": sandbox_root,
		"manifest_updates": {"display_name": "已编辑工坊模组", "version": "1.2.0", "priority": 150},
	})
	var updated_manifest: Dictionary = update_reply.get("manifest", {}) as Dictionary
	var delete_reply: Dictionary = WorldModLifecycleHelper.delete_mod_pack({
		"pack_id": "studio_sample_pack",
		"target_root": sandbox_root,
	})
	var still_exists: bool = DirAccess.dir_exists_absolute(pack_directory)
	_cleanup_directory(sandbox_root)

	var update_ok: bool = bool(update_reply.get("success", false)) and str(updated_manifest.get("version", "")) == "1.2.0" and bool(update_reply.get("precheck_valid", false))
	var delete_ok: bool = bool(delete_reply.get("success", false)) and not still_exists
	return {"test": "TC-LIFECYCLE-01: 核心包保护拦截、清单编辑校验重算与安全删除", "passed": protected_blocked and update_ok and delete_ok}


static func _wait_tcp_connected(client_socket: StreamPeerTCP, server_instance: CompanionIPCServer) -> bool:
	var wait_step: int = 0
	while wait_step < 40:
		client_socket.poll()
		server_instance.poll(4)
		if client_socket.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			return true
		OS.delay_msec(5)
		wait_step += 1
	return client_socket.get_status() == StreamPeerTCP.STATUS_CONNECTED


static func _roundtrip_ipc(client_socket: StreamPeerTCP, server_instance: CompanionIPCServer, frame_payload: Dictionary) -> Dictionary:
	var encoded_bytes: PackedByteArray = (JSON.stringify(frame_payload) + "\n").to_utf8_buffer()
	client_socket.put_data(encoded_bytes)
	var assembled_text: String = ""
	var poll_step: int = 0
	while poll_step < 40:
		server_instance.poll(8)
		client_socket.poll()
		var available_bytes: int = client_socket.get_available_bytes()
		if available_bytes > 0:
			var packet_chunk: Array = client_socket.get_partial_data(available_bytes)
			if int(packet_chunk[0]) == OK:
				assembled_text += (packet_chunk[1] as PackedByteArray).get_string_from_utf8()
				var line_break: int = assembled_text.find("\n")
				if line_break >= 0:
					var parsed_variant: Variant = JSON.parse_string(assembled_text.substr(0, line_break))
					return parsed_variant as Dictionary if parsed_variant is Dictionary else {}
		OS.delay_msec(5)
		poll_step += 1
	return {}


static func _cleanup_directory(directory_path: String) -> void:
	if not DirAccess.dir_exists_absolute(directory_path):
		return
	var folder_handle: DirAccess = DirAccess.open(directory_path)
	if folder_handle == null:
		return
	folder_handle.list_dir_begin()
	var child_name: String = folder_handle.get_next()
	while child_name != "":
		if child_name != "." and child_name != "..":
			var child_path: String = directory_path.path_join(child_name)
			if folder_handle.current_is_dir():
				_cleanup_directory(child_path)
			else:
				folder_handle.remove(child_name)
		child_name = folder_handle.get_next()
	folder_handle.list_dir_end()
	DirAccess.remove_absolute(directory_path)
