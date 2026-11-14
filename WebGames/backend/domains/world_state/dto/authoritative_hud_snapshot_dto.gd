# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/authoritative_hud_snapshot_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 权威 HUD 聚合快照载荷传输对象，整合身份、生理、资产钱包、历法天候、任务追踪与模式特性等轻量核心数据。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AuthoritativeHudSnapshotDTO：Value Object DTO / Data Transport Model
class_name AuthoritativeHudSnapshotDTO
extends RefCounted

# 一、基础身份
var account_id: String = ""
var character_id: String = ""
var character_name: String = ""
var race_id: String = "HUMAN"
var current_location_id: String = ""
var level: int = 1

# 二、生理状态（下限守卫 maxf(1.0, ...) 防止除以零）
var hp_current: float = 0.0
var hp_max: float = 100.0
var mp_current: float = 0.0
var mp_max: float = 100.0
var ap_current: float = 0.0
var ap_max: float = 10.0

# 三、Asset域钱包与成长
var wallet_gold: int = 0
var wallet_mana_monocrystals: int = 0
var ledger_nonce: int = 0
var attribute_values: Dictionary = {}
var attribute_levels: Dictionary = {}
var unallocated_potential_points: int = 0
var title_rank_key: String = ""

# 四、Retention域与探针
var calendar_env: WorldCalendarEnvironmentDTO = null
var ops_bulletin_brief: Dictionary = {}
var unread_mail_count: int = 0
var gacha_pity_counter: int = 0

# 五、Action/Retention域社交与红点
var guild_faction_id: String = ""
var active_red_dot_paths: Array[String] = []
var quest_tracker: ActiveQuestTrackerDTO = null
var mode_features: ModeFeatureManifestDTO = null

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"current_location_id": current_location_id,
		"level": level,
		"hp_current": hp_current,
		"hp_max": hp_max,
		"mp_current": mp_current,
		"mp_max": mp_max,
		"ap_current": ap_current,
		"ap_max": ap_max,
		"wallet_gold": wallet_gold,
		"wallet_mana_monocrystals": wallet_mana_monocrystals,
		"ledger_nonce": ledger_nonce,
		"attribute_values": attribute_values.duplicate(),
		"attribute_levels": attribute_levels.duplicate(),
		"unallocated_potential_points": unallocated_potential_points,
		"title_rank_key": title_rank_key,
		"calendar_env": calendar_env.to_dto() if calendar_env != null else {},
		"ops_bulletin_brief": ops_bulletin_brief.duplicate(),
		"unread_mail_count": unread_mail_count,
		"gacha_pity_counter": gacha_pity_counter,
		"guild_faction_id": guild_faction_id,
		"active_red_dot_paths": active_red_dot_paths.duplicate(),
		"quest_tracker": quest_tracker.to_dto() if quest_tracker != null else {},
		"mode_features": mode_features.to_dto() if mode_features != null else {}
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> AuthoritativeHudSnapshotDTO:
	var snapshot := AuthoritativeHudSnapshotDTO.new()
	_populate_identity(data, snapshot)
	_populate_physiology_and_wallet(data, snapshot)
	_populate_calendar_and_ops(data, snapshot)
	_populate_social_and_features(data, snapshot)
	return snapshot

static func _populate_identity(data: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	snapshot.account_id = String(data.get("account_id", ""))
	snapshot.character_id = String(data.get("character_id", ""))
	snapshot.character_name = String(data.get("character_name", ""))
	snapshot.race_id = String(data.get("race_id", "HUMAN"))
	snapshot.current_location_id = String(data.get("current_location_id", data.get("current_location", "")))
	snapshot.level = maxi(1, int(data.get("level", 1)))

static func _populate_physiology_and_wallet(data: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	# 生理上限守卫强保证 >= 1.0
	snapshot.hp_current = maxf(0.0, float(data.get("hp_current", 0.0)))
	snapshot.hp_max = maxf(1.0, float(data.get("hp_max", 100.0)))
	snapshot.mp_current = maxf(0.0, float(data.get("mp_current", 0.0)))
	snapshot.mp_max = maxf(1.0, float(data.get("mp_max", 100.0)))
	snapshot.ap_current = maxf(0.0, float(data.get("ap_current", 0.0)))
	snapshot.ap_max = maxf(1.0, float(data.get("ap_max", 10.0)))

	snapshot.wallet_gold = int(data.get("wallet_gold", 0))
	snapshot.wallet_mana_monocrystals = int(data.get("wallet_mana_monocrystals", 0))
	snapshot.ledger_nonce = int(data.get("ledger_nonce", 0))

	var attribute_values_data: Variant = data.get("attribute_values", {})
	if attribute_values_data is Dictionary:
		snapshot.attribute_values = attribute_values_data.duplicate()
	var attribute_levels_data: Variant = data.get("attribute_levels", {})
	if attribute_levels_data is Dictionary:
		snapshot.attribute_levels = attribute_levels_data.duplicate()

	snapshot.unallocated_potential_points = maxi(0, int(data.get("unallocated_potential_points", 0)))
	snapshot.title_rank_key = String(data.get("title_rank_key", ""))

static func _populate_calendar_and_ops(data: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	var calendar_env_data: Variant = data.get("calendar_env", null)
	if calendar_env_data is Dictionary and not calendar_env_data.is_empty():
		snapshot.calendar_env = WorldCalendarEnvironmentDTO.from_dto(calendar_env_data)

	var ops_bulletin: Variant = data.get("ops_bulletin_brief", {})
	if ops_bulletin is Dictionary:
		snapshot.ops_bulletin_brief = ops_bulletin.duplicate()

	snapshot.unread_mail_count = maxi(0, int(data.get("unread_mail_count", 0)))
	snapshot.gacha_pity_counter = maxi(0, int(data.get("gacha_pity_counter", 0)))

static func _populate_social_and_features(data: Dictionary, snapshot: AuthoritativeHudSnapshotDTO) -> void:
	snapshot.guild_faction_id = String(data.get("guild_faction_id", ""))

	var raw_dots: Variant = data.get("active_red_dot_paths", [])
	if raw_dots is Array:
		for red_dot_path in raw_dots:
			snapshot.active_red_dot_paths.append(str(red_dot_path))

	var quest_tracker_data: Variant = data.get("quest_tracker", null)
	if quest_tracker_data is Dictionary and not quest_tracker_data.is_empty():
		snapshot.quest_tracker = ActiveQuestTrackerDTO.from_dto(quest_tracker_data)

	var mode_features_data: Variant = data.get("mode_features", null)
	if mode_features_data is Dictionary and not mode_features_data.is_empty():
		snapshot.mode_features = ModeFeatureManifestDTO.from_dto(mode_features_data)

## 兼容层：降级转换为精简版老快照 HudStatusSnapshotDTO（零字段断裂）
func to_legacy_snapshot() -> HudStatusSnapshotDTO:
	var legacy := HudStatusSnapshotDTO.new()
	legacy.account_id = account_id
	legacy.character_id = character_id
	legacy.character_name = character_name
	legacy.race_id = race_id
	legacy.current_location_id = current_location_id
	legacy.attribute_values = attribute_values.duplicate()
	legacy.attribute_levels = attribute_levels.duplicate()
	legacy.hp_current = hp_current
	legacy.hp_max = hp_max
	legacy.ap_current = ap_current
	legacy.ap_max = ap_max
	legacy.wallet_gold = wallet_gold
	legacy.wallet_mana_monocrystals = wallet_mana_monocrystals
	legacy.timestamp_utc = int(Time.get_unix_time_from_system())
	return legacy
