# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/runtime_session_state.gd
# 架构定位: Domain Runtime State Container
# 依赖与触发: 上游: WorldSessionRuntimeService | 下游: WorldGatewayModel
# 配置与信号: 无直接信号，由 WorldSessionRuntimeService 编排
# 职责说明: 集中承载当前活跃世界会话的状态数据容器与快照序列化能力。
# 退出语义与设计依据: 卡拉尔领域第一性原理 (Inv-SESSION-VAULT-3)
# ==============================================================================

## RuntimeSessionState：后端常驻会话运行时快照容器
class_name RuntimeSessionState
extends RefCounted

const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")

var account_id: String = ""
var is_authenticated: bool = false
var session_token_hash: String = ""
var gateway_fsm: Variant = null
var active_mods: Array = []
var adapted_mod_manifest: Dictionary = {}
var narrative_dag_session: RefCounted = null
var world_id: String = ""
var slot_id: String = ""
var character_id: String = ""
var character_name: String = ""
var race_id: String = ""
var current_location_id: String = ""
var game_mode: int = WorldGatewayModel.GameMode.SINGLE_PLAYER
var level: int = 1
var hp_current: float = 100.0
var hp_max: float = 100.0
var mp_current: float = 50.0
var mp_max: float = 50.0
var ap_current: float = 10.0
var ap_max: float = 10.0
var wallet_gold: int = 0
var wallet_mana_monocrystals: int = 0
var ledger_nonce: int = 0
var attribute_values: Dictionary = {}
var attribute_levels: Dictionary = {}
var unallocated_potential_points: int = 0
var title_rank_key: String = ""
var calendar_years: int = 1
var calendar_months: int = 1
var calendar_days: int = 1
var travel_hours: int = 0
var mana_density_tier: int = 1
var unread_mail_count: int = 0
var gacha_pity_counter: int = 0
var guild_faction_id: String = ""
var ops_bulletin_brief: Dictionary = {}
var active_red_dot_paths: Array[String] = []
var quest_tracker: Variant = null
var world_instance: Variant = null
var character_profile: Variant = null
var prologue_context: Variant = null
var extra_providers: Dictionary = {}
var registered_provider_keys: Array[String] = []
var world_active: bool = false
var in_combat: bool = false
var in_cutscene: bool = false
var is_dead: bool = false
var is_paused: bool = false
var hud_dirty: bool = false
var world_dirty: bool = false
var last_hud_sync_ms: int = 0

## 重置当前世界实例与运行时 HUD 关联字段
func reset_world_fields() -> void:
	world_id = ""
	slot_id = ""
	character_id = ""
	character_name = ""
	race_id = ""
	current_location_id = ""
	game_mode = WorldGatewayModel.GameMode.UNSELECTED
	active_mods.clear()
	adapted_mod_manifest.clear()
	narrative_dag_session = null
	level = 1
	hp_current = 100.0
	hp_max = 100.0
	mp_current = 50.0
	mp_max = 50.0
	ap_current = 10.0
	ap_max = 10.0
	wallet_gold = 0
	wallet_mana_monocrystals = 0
	ledger_nonce = 0
	attribute_values.clear()
	attribute_levels.clear()
	unallocated_potential_points = 0
	title_rank_key = ""
	calendar_years = 1
	calendar_months = 1
	calendar_days = 1
	travel_hours = 0
	mana_density_tier = 1
	unread_mail_count = 0
	gacha_pity_counter = 0
	guild_faction_id = ""
	ops_bulletin_brief.clear()
	active_red_dot_paths.clear()
	quest_tracker = null
	world_instance = null
	character_profile = null
	prologue_context = null
	extra_providers.clear()
	registered_provider_keys.clear()
	world_active = false
	in_combat = false
	in_cutscene = false
	is_dead = false
	is_paused = false
	hud_dirty = false
	world_dirty = false
	last_hud_sync_ms = 0

## 重置账号会话与当前世界运行时状态
func reset_all() -> void:
	account_id = ""
	is_authenticated = false
	session_token_hash = ""
	gateway_fsm = null
	reset_world_fields()

## 导出用于多域存盘的会话状态快照
func to_save_snapshot() -> Dictionary:
	return {
		"account_id": account_id,
		"world_id": world_id,
		"slot_id": slot_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"current_location_id": current_location_id,
		"game_mode": game_mode,
		"level": level,
		"hp_current": hp_current,
		"hp_max": hp_max,
		"ap_current": ap_current,
		"ap_max": ap_max,
		"wallet_gold": wallet_gold,
		"wallet_mana_monocrystals": wallet_mana_monocrystals,
		"attribute_values": attribute_values.duplicate(),
		"attribute_levels": attribute_levels.duplicate(),
		"calendar": {
			"years": calendar_years,
			"months": calendar_months,
			"days": calendar_days,
			"travel_hours": travel_hours
		}
	}
