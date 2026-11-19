# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_snapshot_data_service.gd
# 架构定位: Domain Boundary Adapter / Real Runtime Snapshot Reader
# 依赖与触发: 上游: ServiceContainer, 视图快照加载入口 | 下游: WorldSessionRuntimeService, AccountRepository, GameConfig
# 职责说明: 实现 ISnapshotDataService 接口，从后端实时会话扁平/嵌套上下文、账号仓储与领域配置装配全域权威快照。
# 退出语义与设计依据: 表现层零模拟目录直读与后端运行时单一真源契约
# ==============================================================================

## RealSnapshotDataService：从实时后端会话、账号仓与领域配置装配只读域级快照
class_name RealSnapshotDataService
extends "res://frontend/domain_boundary/interfaces/i_snapshot_data_service.gd"

func _build_account_snapshot() -> Dictionary:
	var repository := AccountRepository.get_instance()
	var active_account_id: String = WorldSessionRuntimeService.get_active_account_id()
	if not repository.is_loaded() or active_account_id.is_empty():
		return {}
	var profile: AccountProfile = repository.find_by_id(active_account_id)
	if profile == null:
		return {}
	return {
		"account_id": profile.account_id,
		"username": profile.username,
		"character_slots": AccountSlotBindingSolver.to_frontend_character_slots(profile),
	}

func _build_character_snapshot() -> Dictionary:
	if not WorldSessionRuntimeService.has_active_world():
		return {}
	var live_context: Dictionary = WorldSessionRuntimeService.build_live_hud_context()
	if live_context.has("character") and live_context.get("character") is Dictionary:
		return (live_context.get("character") as Dictionary).duplicate(true)
	var live_attributes: Variant = live_context.get("attribute_values", {})
	var resolved_attributes := (live_attributes as Dictionary).duplicate(true) if live_attributes is Dictionary else {}
	return {
		"character_id": str(live_context.get("character_id", "")),
		"name": str(live_context.get("character_name", "")),
		"title": str(live_context.get("title_rank_key", "")),
		"level": int(live_context.get("level", 1)),
		"age_years": int(live_context.get("calendar_years", 18)),
		"age_months": int(live_context.get("calendar_months", 1)),
		"attributes": resolved_attributes,
		"potential_points": int(live_context.get("unallocated_potential_points", 0)),
		"vitality": {
			"sf": 1.0,
			"msf": 1.0,
			"hunger": 100.0,
			"energy": 100.0,
		},
		"equipped_slots": {
			"MAIN_HAND": null, "OFF_HAND": null, "HEAD": null, "CHEST": null,
			"LEGS": null, "FEET": null, "NECK": null, "RING_L": null, "RING_R": null
		},
		"inventory_count": 0,
		"inventory_max": maxi(10, int(GameConfig.get_dict("domains.inventory", "transaction", {}).get("default_slots", 40))),
	}

func _build_economy_snapshot() -> Dictionary:
	var live_context: Dictionary = WorldSessionRuntimeService.build_live_hud_context() if WorldSessionRuntimeService.has_active_world() else {}
	var wallet_payload := {
		"gold": int(live_context.get("wallet_gold", 0)),
		"silver": 0,
		"copper": 0,
		"mana_monocrystals": int(live_context.get("wallet_mana_monocrystals", 0)),
	}
	if live_context.has("wallet") and live_context.get("wallet") is Dictionary:
		wallet_payload = (live_context.get("wallet") as Dictionary).duplicate(true)
	var shop_table: Dictionary = GameConfig.get_dict("domains.economy", "shop", {})
	var raw_catalog: Variant = shop_table.get("catalog", [])
	var configured_items: Array = (raw_catalog as Array).duplicate(true) if raw_catalog is Array else []
	return {
		"wallet": wallet_payload,
		"shop_items": configured_items,
		"price_trend": [],
	}

func _build_world_map_snapshot() -> Dictionary:
	var configured_landmarks: Array = GameConfig.get_array("domains.world", "landmarks", []).duplicate(true)
	var topology: Dictionary = GameConfig.get_dict("domains.world", "mod_world_topology", {})
	var seen_ids: Dictionary = {}
	for existing_landmark in configured_landmarks:
		if existing_landmark is Dictionary:
			var existing_id := str((existing_landmark as Dictionary).get("id", "")).strip_edges()
			if not existing_id.is_empty():
				seen_ids[existing_id] = true
	var topology_nodes: Variant = topology.get("nodes", [])
	if topology_nodes is Array:
		for raw_node in topology_nodes:
			if raw_node is Dictionary:
				var node_map := raw_node as Dictionary
				var node_id := str(node_map.get("node_id", "")).strip_edges()
				if not node_id.is_empty() and not seen_ids.has(node_id):
					seen_ids[node_id] = true
					configured_landmarks.append({
						"id": node_id,
						"name": str(node_map.get("name", node_id)),
						"x": float(node_map.get("x", 0.0)),
						"y": float(node_map.get("y", 0.0)),
						"terrain_type": str(node_map.get("terrain_type", "PLAINS")),
					})
	var marching_config: Dictionary = GameConfig.get_dict("domains.world", "marching", {})
	var raw_routes: Variant = marching_config.get("routes", [])
	var raw_territories: Variant = topology.get("territories", [])
	return {
		"landmarks": configured_landmarks,
		"topology_edges": topology.get("edges", []) if topology.get("edges") is Array else [],
		"marching_routes": (raw_routes as Array).duplicate(true) if raw_routes is Array else [],
		"territories": (raw_territories as Array).duplicate(true) if raw_territories is Array else [],
	}

## 构建抽卡祈愿域实时状态快照
func _build_gacha_snapshot() -> Dictionary:
	var banner_defaults: Dictionary = GameConfig.get_dict("domains.gacha", "banner_defaults", {})
	var default_id := str(banner_defaults.get("banner_id", "BANNER_STANDARD_DEFAULT"))
	var live_context: Dictionary = WorldSessionRuntimeService.build_live_hud_context() if WorldSessionRuntimeService.has_active_world() else {}
	return {
		"default_banner_id": default_id,
		"pity_5star": 0,
		"pity_4star": 0,
		"currency_primogems": int(live_context.get("wallet_mana_monocrystals", 0)),
		"banners": [ {
			"banner_id": default_id,
			"title": str(banner_defaults.get("banner_title", default_id)),
			"subtitle": str(banner_defaults.get("fallback_title", "")),
			"remaining_time": "-",
			"up_items": [],
		}],
	}

## 按域标识读取实时状态快照（未激活会话时安全返回配置驱动空壳或空字典）
func load_snapshot(domain_id: String) -> Dictionary:
	match domain_id.strip_edges():
		"account":
			return _build_account_snapshot()
		"character":
			return _build_character_snapshot()
		"economy":
			return _build_economy_snapshot()
		"world_map":
			return _build_world_map_snapshot()
		"gacha":
			return _build_gacha_snapshot()
		_:
			return {}
