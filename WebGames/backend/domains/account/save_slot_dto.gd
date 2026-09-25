# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/save_slot_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 毫秒级轻量存档封面元数据契约，支持死斗模式与生平传记查看。 默认值由 config/domains/account.json 的 save_slot/defaults 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name SaveSlotSummaryDTO extends RefCounted

# ==============================================================================
# 一、插槽封面元数据（默认值均来自 save_slot/defaults 配置）
# ==============================================================================

var slot_id: String = GameConfig.get_string("domains.account", "save_slot/defaults/slot_id", "SLOT_01")
var character_name: String = GameConfig.get_string("domains.account", "save_slot/defaults/character_name", "Nameless Wanderer")
var title_prefix: String = GameConfig.get_string("domains.account", "save_slot/defaults/title_prefix", "Apprentice Adventurer")
var profession_tier_name: String = GameConfig.get_string("domains.account", "save_slot/defaults/profession_tier_name", "Novice Walker Tier 1")
var apparent_age: int = GameConfig.get_int("domains.account", "save_slot/defaults/apparent_age", 20)
var current_location_name: String = GameConfig.get_string("domains.account", "save_slot/defaults/current_location_name", "中洲·卡拉尔圣城")
var play_time_seconds: int = GameConfig.get_int("domains.account", "save_slot/defaults/play_time_seconds", 0)
var is_permadeath_mode: bool = GameConfig.get_bool("domains.account", "save_slot/defaults/is_permadeath_mode", false)
var is_fallen: bool = GameConfig.get_bool("domains.account", "save_slot/defaults/is_fallen", false)
var last_saved_time_utc: int = GameConfig.get_int("domains.account", "save_slot/defaults/last_saved_time_utc", 0)
var save_file_sha256: String = GameConfig.get_string("domains.account", "save_slot/defaults/save_file_sha256", "")

# 角色本体档案（角色生命周期隔离域：与账号/世界数据严格分离，死亡按白名单精确清理）
var character_profile: CharacterProfile = null

## 角色本体数据归属判定（白名单，禁删全档）
func has_character_payload(key: String) -> bool:
	return character_profile != null and character_profile.has_payload(key)

## 精确清理角色本体子集（死亡处理唯一路径）
func clear_character_payload(key: String) -> void:
	if character_profile != null:
		character_profile.clear_payload(key)

## 挂载角色本体档案（创建角色第一步落盘）
func attach_character_profile(profile: CharacterProfile) -> void:
	character_profile = profile

# ==============================================================================
# 二、序列化与反序列化
# ==============================================================================

## 序列化为字典（含角色本体档案序列化；空档案落空字典）
func serialize() -> Dictionary:
	return {
		"slot_id": slot_id,
		"character_name": character_name,
		"title_prefix": title_prefix,
		"profession_tier_name": profession_tier_name,
		"apparent_age": apparent_age,
		"current_location_name": current_location_name,
		"play_time_seconds": play_time_seconds,
		"is_permadeath_mode": is_permadeath_mode,
		"is_fallen": is_fallen,
		"last_saved_time_utc": last_saved_time_utc,
		"save_file_sha256": save_file_sha256,
		"character_profile": character_profile.serialize() if character_profile != null else {}
	}

## 反序列化：缺键一律沿用字段初值（即 save_slot/defaults 配置缺省），默认值单点化于此
static func deserialize(d: Dictionary) -> SaveSlotSummaryDTO:
	var dto := SaveSlotSummaryDTO.new()
	dto.slot_id = d.get("slot_id", dto.slot_id)
	dto.character_name = d.get("character_name", dto.character_name)
	dto.title_prefix = d.get("title_prefix", dto.title_prefix)
	dto.profession_tier_name = d.get("profession_tier_name", dto.profession_tier_name)
	dto.apparent_age = d.get("apparent_age", dto.apparent_age)
	dto.current_location_name = d.get("current_location_name", dto.current_location_name)
	dto.play_time_seconds = d.get("play_time_seconds", dto.play_time_seconds)
	dto.is_permadeath_mode = d.get("is_permadeath_mode", dto.is_permadeath_mode)
	dto.is_fallen = d.get("is_fallen", dto.is_fallen)
	dto.last_saved_time_utc = d.get("last_saved_time_utc", dto.last_saved_time_utc)
	dto.save_file_sha256 = d.get("save_file_sha256", dto.save_file_sha256)
	var raw_profile: Variant = d.get("character_profile", {})
	if raw_profile is Dictionary and not (raw_profile as Dictionary).is_empty():
		dto.character_profile = CharacterProfile.deserialize(raw_profile as Dictionary)
	return dto
