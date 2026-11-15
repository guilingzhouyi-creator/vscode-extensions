# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_snapshot_data_service.gd
# 架构定位: Domain Boundary Adapter / Real Runtime Snapshot Reader
# 依赖与触发: 上游: ServiceContainer, 视图快照加载入口 | 下游: WorldSessionRuntimeService, AccountRepository, GameConfig
# 职责说明: 实现 ISnapshotDataService 接口，优先从后端实时会话、账号仓储与世界配置中读取域级状态快照。
# 退出语义与设计依据: 表现层零模拟目录直读与后端运行时单一真源契约
# ==============================================================================

## RealSnapshotDataService：从实时后端会话、账号仓与领域配置装配只读域级快照
class_name RealSnapshotDataService
extends "res://frontend/domain_boundary/interfaces/i_snapshot_data_service.gd"

const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const AccountSlotBindingSolver = preload("res://backend/domains/account/account_slot_binding_solver.gd")

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
	var hud_context: Dictionary = WorldSessionRuntimeService.build_live_hud_context()
	return hud_context.get("character", {}) as Dictionary

func _build_economy_snapshot() -> Dictionary:
	if WorldSessionRuntimeService.has_active_world():
		var hud_context: Dictionary = WorldSessionRuntimeService.build_live_hud_context()
		if hud_context.has("wallet"):
			return {"wallet": (hud_context.get("wallet", {}) as Dictionary).duplicate(true)}
	return {
		"wallet": {"gold": 0, "silver": 0, "copper": 0, "mana_monocrystals": 0},
		"shop_items": [],
		"price_trend": [],
	}

func _build_world_map_snapshot() -> Dictionary:
	var configured_landmarks: Array = GameConfig.get_array("domains.world", "landmarks", [])
	return {
		"landmarks": configured_landmarks.duplicate(true),
		"marching_routes": [],
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
		_:
			return {}
