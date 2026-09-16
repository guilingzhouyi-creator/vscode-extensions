# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 角色 HUD 快照契约
# 文件路径: res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd
# 职责: 承载主 HUD 与角色养成视图的权威快照字段（对齐 P71 HudStatusSnapshotDTO）
# 边界: 纯数据契约；百分比与格式化属展示派生，不参与业务规则判定
# ==============================================================================
class_name FrontendHudSnapshot
extends "res://frontend/domain_boundary/contracts/frontend_snapshot.gd"

const SCHEMA_VERSION: int = 1

var character_id: String = ""
var nickname: String = ""
var race_name: String = ""
var location_name: String = ""
var level: int = 1

var hp_current: float = 0.0
var hp_max: float = 1.0
var mp_current: float = 0.0
var mp_max: float = 1.0
var ap_current: float = 0.0
var ap_max: float = 1.0

var gold: int = 0
var silver: int = 0
var copper: int = 0
var monocrystals: int = 0

func to_dictionary() -> Dictionary:
	return {
		"schema_version": SCHEMA_VERSION,
		"character_id": character_id,
		"nickname": nickname,
		"race_name": race_name,
		"location_name": location_name,
		"level": level,
		"hp_current": hp_current,
		"hp_max": hp_max,
		"mp_current": mp_current,
		"mp_max": mp_max,
		"ap_current": ap_current,
		"ap_max": ap_max,
		"gold": gold,
		"silver": silver,
		"copper": copper,
		"monocrystals": monocrystals,
	}

static func from_dictionary(data: Dictionary) -> FrontendHudSnapshot:
	var dto: FrontendHudSnapshot = load("res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd").new()
	dto.character_id = read_string(data, "character_id")
	dto.nickname = read_string(data, "nickname")
	dto.race_name = read_string(data, "race_name")
	dto.location_name = read_string(data, "location_name")
	dto.level = maxi(1, read_int(data, "level", 1))
	dto.hp_max = maxf(1.0, read_float(data, "hp_max", 1.0))
	dto.hp_current = clampf(read_float(data, "hp_current", 0.0), 0.0, dto.hp_max)
	dto.mp_max = maxf(1.0, read_float(data, "mp_max", 1.0))
	dto.mp_current = clampf(read_float(data, "mp_current", 0.0), 0.0, dto.mp_max)
	dto.ap_max = maxf(1.0, read_float(data, "ap_max", 1.0))
	dto.ap_current = clampf(read_float(data, "ap_current", 0.0), 0.0, dto.ap_max)
	dto.gold = maxi(0, read_int(data, "gold", 0))
	dto.silver = maxi(0, read_int(data, "silver", 0))
	dto.copper = maxi(0, read_int(data, "copper", 0))
	dto.monocrystals = maxi(0, read_int(data, "monocrystals", 0))
	return dto

## 展示派生：生命值百分比（只读格式化，不参与任何业务规则）
func get_health_ratio() -> float:
	return clampf(hp_current / maxf(hp_max, 1.0), 0.0, 1.0)

## 展示派生：魔力值百分比（只读格式化，不参与任何业务规则）
func get_mana_ratio() -> float:
	return clampf(mp_current / maxf(mp_max, 1.0), 0.0, 1.0)
