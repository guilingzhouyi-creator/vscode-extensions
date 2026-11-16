# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_world_service.gd
# 架构定位: Domain Boundary Adapter / Real World & Gateway Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游:
#           UnifiedProtocolDispatcher, WorldSessionRuntimeService
# 职责说明: 实现 IWorldService 接口，封装真实世界网关与大地图探索协议动作，
#           通过统一信封向 UnifiedProtocolDispatcher 分发进入、探测、选档与退出指令。
# 退出语义与设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 统一协议信封解耦
# ==============================================================================

## RealWorldService：直连后端世界网关与主页 HUD 状态协议的真实边界服务实现
class_name RealWorldService
extends "res://frontend/domain_boundary/interfaces/i_world_service.gd"

## 获取 HUD 权威状态快照
func get_hud_snapshot_async(character_id: String, result_callback: Callable) -> void:
	var hud_context := WorldSessionRuntimeService.build_live_hud_context() if WorldSessionRuntimeService.has_active_world() else {}
	if not character_id.is_empty():
		hud_context["character_id"] = character_id
	var authoritative_snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(hud_context)
	if result_callback.is_valid():
		result_callback.call({
			"success": true,
			"snapshot": authoritative_snapshot.to_dto()
		})

## 获取小地图地标与 MOD 拓扑网络节点
func get_map_landmarks_async(result_callback: Callable) -> void:
	var landmarks: Array = GameConfig.get_array("domains.world", "landmarks", []).duplicate(true)
	var topology: Dictionary = GameConfig.get_dict("domains.world", "mod_world_topology", {})
	var seen_ids: Dictionary = {}
	for entry in landmarks:
		if entry is Dictionary:
			var identifier := str((entry as Dictionary).get("id", (entry as Dictionary).get("node_id", ""))).strip_edges()
			if not identifier.is_empty():
				seen_ids[identifier] = true
	var raw_nodes: Variant = topology.get("nodes", [])
	if raw_nodes is Array:
		for raw_node in raw_nodes:
			if raw_node is Dictionary:
				var node_map := raw_node as Dictionary
				var node_id := str(node_map.get("node_id", node_map.get("id", ""))).strip_edges()
				if not node_id.is_empty() and not seen_ids.has(node_id):
					seen_ids[node_id] = true
					landmarks.append({
						"id": node_id,
						"name": str(node_map.get("name", node_map.get("node_name", node_id))),
						"x": float(node_map.get("x", 0.0)),
						"y": float(node_map.get("y", 0.0)),
						"terrain_type": str(node_map.get("terrain_type", "PLAINS")),
					})
	if result_callback.is_valid():
		result_callback.call({
			"success": true,
			"landmarks": landmarks,
			"topology_edges": topology.get("edges", []) if topology.get("edges") is Array else [],
		})

## 基于真实后端 MapAndEcologySolver 与 MOD 拓扑求解候选行军路线
func plan_routes(from_index: int, to_index: int) -> Array:
	if from_index < 0 or to_index < 0 or from_index == to_index:
		return []
	var all_nodes: Dictionary = MapAndEcologySolver.build_topology_nodes_from_config()
	var node_keys: Array = all_nodes.keys()
	node_keys.sort()
	if from_index < node_keys.size() and to_index < node_keys.size():
		var start_id := str(node_keys[from_index])
		var goal_id := str(node_keys[to_index])
		var path_outcome := MapAndEcologySolver.solve_shortest_impedance_path(start_id, goal_id, all_nodes)
		if bool(path_outcome.get("success", false)):
			var base_cost := maxf(1.0, float(path_outcome.get("total_cost", 10.0)))
			var standard_hours := maxi(1, int(ceil(base_cost / 10.0)))
			return [
				{"label": "CARAVAN", "hours": standard_hours + 2, "danger_key": "ui.fe10.pf.danger_low", "cost": int(round(base_cost * 3.0)), "path": path_outcome.get("path", [])},
				{"label": "STANDARD", "hours": standard_hours, "danger_key": "ui.fe10.pf.danger_mid", "cost": int(round(base_cost * 5.0)), "path": path_outcome.get("path", [])},
				{"label": "FORCED_MARCH", "hours": maxi(1, int(ceil(float(standard_hours) * 0.65))), "danger_key": "ui.fe10.pf.danger_high", "cost": int(round(base_cost * 8.0)), "path": path_outcome.get("path", [])},
			]
	var distance_hops := absi(to_index - from_index)
	var default_impedance := MapAndEcologySolver.get_terrain_impedance("PLAINS")
	var base_hours := maxi(1, int(ceil(float(distance_hops) * 2.0 * default_impedance)))
	return [
		{"label": "CARAVAN", "hours": base_hours + 2, "danger_key": "ui.fe10.pf.danger_low", "cost": distance_hops * 40},
		{"label": "STANDARD", "hours": base_hours, "danger_key": "ui.fe10.pf.danger_mid", "cost": distance_hops * 65},
		{"label": "FORCED_MARCH", "hours": maxi(1, base_hours - 1), "danger_key": "ui.fe10.pf.danger_high", "cost": distance_hops * 100},
	]

## 领地建设升级：按配置增量提升驻军容量与完工进度，并在活跃世界同步国库扣除
func upgrade_territory(territory: Dictionary) -> Dictionary:
	var town_defaults: Dictionary = GameConfig.get_dict("domains.world", "town_defaults", {})
	var upgrade_cost_gold := maxi(0, int(town_defaults.get("upgrade_cost_gold", 200)))
	var garrison_step := maxi(1, int(town_defaults.get("upgrade_garrison_step", 15)))
	if WorldSessionRuntimeService.has_active_world() and upgrade_cost_gold > 0:
		var live_context := WorldSessionRuntimeService.build_live_hud_context()
		var current_gold := int(live_context.get("wallet_gold", 0))
		if current_gold < upgrade_cost_gold:
			return {"success": false, "error_code": "ERR_INSUFFICIENT_GOLD", "territory": territory.duplicate(true)}
		WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": -upgrade_cost_gold}, -1, false)
	var updated_territory: Dictionary = territory.duplicate(true)
	updated_territory["construction"] = 1.0
	updated_territory["level"] = int(updated_territory.get("level", 1)) + 1
	updated_territory["garrison"] = int(updated_territory.get("garrison", 0)) + garrison_step
	if WorldSessionRuntimeService.has_active_world():
		RealProtocolBridge.dispatch_flat("world_navigation", "UPGRADE_TERRITORY", {"territory": territory})
	return {"success": true, "territory": updated_territory, "cost_gold": upgrade_cost_gold}

## 分发世界导航或怪物生态域统一协议指令
func dispatch_world_directive(domain_name: String, action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return RealProtocolBridge.dispatch_flat(domain_name, action_type, payload_data)

func _dispatch_gateway_action(
	action_type: String,
	account_id: String,
	token: String,
	extra_payload: Dictionary,
	result_callback: Callable,
	result_key: String = "data",
	fallback_value: Variant = {}
) -> void:
	var gateway_payload := {"account_id": account_id}
	if not extra_payload.is_empty():
		gateway_payload.merge(extra_payload, true)
	RealProtocolBridge.dispatch_and_reply("world_gateway", action_type, gateway_payload, account_id, token, result_callback, result_key, fallback_value)

## 异步进入网关契约实现
func enter_gateway_async(account_id: String, token: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("ENTER_GATEWAY", account_id, token, {}, result_callback)

## 异步探针就绪度探测契约实现
func probe_modes_async(account_id: String, token: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("PROBE_MODES", account_id, token, {}, result_callback, "probe_reports", {})

## 异步世界档案列表查询契约实现
func list_worlds_async(account_id: String, token: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("LIST_WORLDS", account_id, token, {}, result_callback, "worlds", [])

## 异步模式与槽位选择契约实现
func select_mode_async(account_id: String, token: String, mode_id: int, account_slots: Array, result_callback: Callable, options: Dictionary = {}) -> void:
	var gateway_payload := {"target_mode": mode_id, "account_slots": account_slots}
	if not options.is_empty():
		gateway_payload.merge(options, true)
	_dispatch_gateway_action("SELECT_MODE", account_id, token, gateway_payload, result_callback)

## 异步选档/建档进入世界契约实现
func select_or_create_world_async(account_id: String, token: String, world_id: String, mode_id: int, result_callback: Callable, options: Dictionary = {}) -> void:
	var gateway_payload := {
		"world_id": world_id,
		"target_mode": mode_id,
		"create_if_missing": bool(options.get("create_if_missing", true))
	}
	if not options.is_empty():
		gateway_payload.merge(options, true)
	_dispatch_gateway_action("SELECT_OR_CREATE_WORLD", account_id, token, gateway_payload, result_callback)

## 异步关联就绪角色至网关契约实现
func attach_ready_character_async(account_id: String, token: String, character_id: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("ATTACH_READY_CHARACTER", account_id, token, {"character_id": character_id}, result_callback)

## 异步正式进入指定世界档案契约实现
func enter_world_async(account_id: String, token: String, world_id: String, allow_safe_degrade: bool, result_callback: Callable) -> void:
	_dispatch_gateway_action("ENTER_WORLD", account_id, token, {"world_id": world_id, "allow_safe_degrade": allow_safe_degrade}, result_callback)

## 异步发现并预检单机显性命途 MOD 契约实现
func discover_mods_async(account_id: String, token: String, enabled_pack_ids: Array, result_callback: Callable) -> void:
	_dispatch_gateway_action("DISCOVER_MODS", account_id, token, {"enabled_pack_ids": enabled_pack_ids}, result_callback)

## 异步查询联机界域只读卡片列表契约实现
func list_remote_realms_async(account_id: String, token: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("LIST_REMOTE_REALMS", account_id, token, {}, result_callback, "realms", [])

## 异步删除指定世界档案契约实现
func delete_world_async(account_id: String, token: String, world_id: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("DELETE_WORLD", account_id, token, {"world_id": world_id}, result_callback)

## 异步切换网关模式契约实现
func switch_gateway_mode_async(account_id: String, token: String, target_mode: int, result_callback: Callable, options: Dictionary = {}) -> void:
	var gateway_payload := {"target_mode": target_mode}
	if not options.is_empty():
		gateway_payload.merge(options, true)
	_dispatch_gateway_action("SWITCH_GATEWAY_MODE", account_id, token, gateway_payload, result_callback)

## 异步退出世界退回网关契约实现
func exit_world_to_gateway_async(account_id: String, token: String, result_callback: Callable, options: Dictionary = {}) -> void:
	_dispatch_gateway_action("EXIT_WORLD_TO_GATEWAY", account_id, token, options, result_callback)

## 异步发现已安装官方与三方 MOD 包列表契约实现
func list_installed_mods_async(account_id: String, token: String, custom_roots: Array, result_callback: Callable) -> void:
	_dispatch_gateway_action("LIST_INSTALLED_MODS", account_id, token, {"custom_roots": custom_roots}, result_callback)

## 异步更新当前会话选定的 MOD 包列表契约实现
func set_mod_selection_async(account_id: String, token: String, selected_pack_ids: Array, result_callback: Callable, custom_roots: Array = []) -> void:
	var payload_data := {"selected_pack_ids": selected_pack_ids}
	if not custom_roots.is_empty():
		payload_data["custom_roots"] = custom_roots
	_dispatch_gateway_action("SET_MOD_SELECTION", account_id, token, payload_data, result_callback)

## 异步执行多 MOD 栈静态预检契约实现
func precheck_mod_stack_async(account_id: String, token: String, enabled_pack_ids: Array, result_callback: Callable, custom_roots: Array = []) -> void:
	var payload_data := {"enabled_pack_ids": enabled_pack_ids}
	if not custom_roots.is_empty():
		payload_data["custom_roots"] = custom_roots
	_dispatch_gateway_action("PRECHECK_MODS", account_id, token, payload_data, result_callback)

## 异步创建合规 MOD 目录骨架契约实现
func create_mod_pack_async(account_id: String, token: String, pack_spec: Dictionary, result_callback: Callable) -> void:
	_dispatch_gateway_action("CREATE_MOD_PACK", account_id, token, pack_spec, result_callback)

## 异步打包 .kmod 归档包契约实现
func pack_mod_kmod_async(account_id: String, token: String, source_directory: String, output_path: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("PACK_MOD_KMOD", account_id, token, {"source_dir": source_directory, "output_path": output_path}, result_callback)

## 异步安装 .kmod 或 MOD 目录至本地模组目录契约实现
func install_mod_pack_async(account_id: String, token: String, source_path: String, target_root: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("INSTALL_MOD_PACK", account_id, token, {"source_path": source_path, "target_root": target_root}, result_callback)

## 异步删除本地非内置 MOD 包或归档契约实现
func delete_mod_pack_async(account_id: String, token: String, delete_spec: Dictionary, result_callback: Callable) -> void:
	_dispatch_gateway_action("DELETE_MOD_PACK", account_id, token, delete_spec, result_callback)

## 异步更新本地 MOD 清单与 DAG 数据契约实现
func update_mod_manifest_async(account_id: String, token: String, update_spec: Dictionary, result_callback: Callable) -> void:
	_dispatch_gateway_action("UPDATE_MOD_MANIFEST", account_id, token, update_spec, result_callback)

## 异步查询指定世界存档只读 MOD 锁定诊断契约实现
func get_world_mod_diagnostics_async(account_id: String, token: String, world_id: String, result_callback: Callable) -> void:
	_dispatch_gateway_action("GET_WORLD_MOD_DIAGNOSTICS", account_id, token, {"world_id": world_id}, result_callback)

## 异步校验联机界域权威清单 SHA-256 摘要契约实现
func verify_realm_manifest_async(account_id: String, token: String, realm_mod_manifest: Array, result_callback: Callable) -> void:
	_dispatch_gateway_action("VERIFY_REALM_MANIFEST", account_id, token, {"realm_mod_manifest": realm_mod_manifest}, result_callback)
