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
	var dto := AuthoritativeHudSnapshotDTO.new()
	_hydrate_identity(data, dto)
	_hydrate_physiology_and_wallet(data, dto)
	_hydrate_calendar_and_ops(data, dto)
	_hydrate_social_and_features(data, dto)
	return dto

static func _hydrate_identity(data: Dictionary, dto: AuthoritativeHudSnapshotDTO) -> void:
	dto.account_id = String(data.get("account_id", ""))
	dto.character_id = String(data.get("character_id", ""))
	dto.character_name = String(data.get("character_name", ""))
	dto.race_id = String(data.get("race_id", "HUMAN"))
	dto.level = maxi(1, int(data.get("level", 1)))

static func _hydrate_physiology_and_wallet(data: Dictionary, dto: AuthoritativeHudSnapshotDTO) -> void:
	# 生理上限守卫强保证 >= 1.0
	dto.hp_current = maxf(0.0, float(data.get("hp_current", 0.0)))
	dto.hp_max = maxf(1.0, float(data.get("hp_max", 100.0)))
	dto.mp_current = maxf(0.0, float(data.get("mp_current", 0.0)))
	dto.mp_max = maxf(1.0, float(data.get("mp_max", 100.0)))
	dto.ap_current = maxf(0.0, float(data.get("ap_current", 0.0)))
	dto.ap_max = maxf(1.0, float(data.get("ap_max", 10.0)))

	dto.wallet_gold = int(data.get("wallet_gold", 0))
	dto.wallet_mana_monocrystals = int(data.get("wallet_mana_monocrystals", 0))
	dto.ledger_nonce = int(data.get("ledger_nonce", 0))

	var av = data.get("attribute_values", {})
	if av is Dictionary:
		dto.attribute_values = av.duplicate()
	var al = data.get("attribute_levels", {})
	if al is Dictionary:
		dto.attribute_levels = al.duplicate()

	dto.unallocated_potential_points = maxi(0, int(data.get("unallocated_potential_points", 0)))
	dto.title_rank_key = String(data.get("title_rank_key", ""))

static func _hydrate_calendar_and_ops(data: Dictionary, dto: AuthoritativeHudSnapshotDTO) -> void:
	var c_env = data.get("calendar_env", null)
	if c_env is Dictionary and not c_env.is_empty():
		dto.calendar_env = WorldCalendarEnvironmentDTO.from_dto(c_env)

	var ops = data.get("ops_bulletin_brief", {})
	if ops is Dictionary:
		dto.ops_bulletin_brief = ops.duplicate()

	dto.unread_mail_count = maxi(0, int(data.get("unread_mail_count", 0)))
	dto.gacha_pity_counter = maxi(0, int(data.get("gacha_pity_counter", 0)))

static func _hydrate_social_and_features(data: Dictionary, dto: AuthoritativeHudSnapshotDTO) -> void:
	dto.guild_faction_id = String(data.get("guild_faction_id", ""))

	var raw_dots = data.get("active_red_dot_paths", [])
	if raw_dots is Array:
		for dot in raw_dots:
			dto.active_red_dot_paths.append(str(dot))

	var q_track = data.get("quest_tracker", null)
	if q_track is Dictionary and not q_track.is_empty():
		dto.quest_tracker = ActiveQuestTrackerDTO.from_dto(q_track)

	var m_feat = data.get("mode_features", null)
	if m_feat is Dictionary and not m_feat.is_empty():
		dto.mode_features = ModeFeatureManifestDTO.from_dto(m_feat)

## 兼容层：降级转换为精简版老快照 HudStatusSnapshotDTO（零字段断裂）
func to_legacy_snapshot() -> HudStatusSnapshotDTO:
	var legacy := HudStatusSnapshotDTO.new()
	legacy.account_id = account_id
	legacy.character_id = character_id
	legacy.character_name = character_name
	legacy.race_id = race_id
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
