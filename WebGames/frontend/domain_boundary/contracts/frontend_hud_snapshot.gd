# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Contracts)
# 文件路径: res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd
# 架构定位: HUD & Character Status Snapshot Contract
# 依赖与触发: 上游: HudEventBridge, RealWorldService, MockWorldService | 下游: HUD 与角色养成视图
# 职责说明: 承载主 HUD 与角色养成视图的权威快照字段（对齐 HudStatusSnapshotDTO），提供双向可逆序列化。
# 退出语义与设计依据: 快照序列化对等契约与百分比只读派生契约
# ==============================================================================

## FrontendHudSnapshot：主 HUD 与角色状态栏权威快照 DTO
class_name FrontendHudSnapshot
extends "res://frontend/domain_boundary/contracts/frontend_snapshot.gd"

const SCHEMA_VERSION: int = 2

var character_id: String = ""
var character_name: String = ""
var nickname: String:
	get: return character_name
	set(value): character_name = value
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
var mana_monocrystals: int = 0
var monocrystals: int:
	get: return mana_monocrystals
	set(value): mana_monocrystals = value

## 将当前 HUD 快照实体序列化为与 from_dictionary 对等的字典结构
func to_dictionary() -> Dictionary:
	return {
		"schema_version": SCHEMA_VERSION,
		"character_id": character_id,
		"character_name": character_name,
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
		"mana_monocrystals": mana_monocrystals,
	}

## 从权威快照字典反序列化为强类型 FrontendHudSnapshot，并对缺省/越界字段执行安全钳制
static func from_dictionary(snapshot_payload: Dictionary) -> FrontendHudSnapshot:
	var snapshot := FrontendHudSnapshot.new()
	snapshot.character_id = read_string(snapshot_payload, "character_id")
	var resolved_name := read_string(snapshot_payload, "character_name", "")
	if resolved_name.is_empty():
		resolved_name = read_string(snapshot_payload, "nickname", "")
	snapshot.character_name = resolved_name
	snapshot.race_name = read_string(snapshot_payload, "race_name")
	snapshot.location_name = read_string(snapshot_payload, "location_name")
	snapshot.level = maxi(1, read_int(snapshot_payload, "level", 1))
	snapshot.hp_max = maxf(1.0, read_float(snapshot_payload, "hp_max", 1.0))
	snapshot.hp_current = clampf(read_float(snapshot_payload, "hp_current", 0.0), 0.0, snapshot.hp_max)
	snapshot.mp_max = maxf(1.0, read_float(snapshot_payload, "mp_max", 1.0))
	snapshot.mp_current = clampf(read_float(snapshot_payload, "mp_current", 0.0), 0.0, snapshot.mp_max)
	snapshot.ap_max = maxf(1.0, read_float(snapshot_payload, "ap_max", 1.0))
	snapshot.ap_current = clampf(read_float(snapshot_payload, "ap_current", 0.0), 0.0, snapshot.ap_max)
	snapshot.gold = maxi(0, read_int(snapshot_payload, "gold", 0))
	snapshot.silver = maxi(0, read_int(snapshot_payload, "silver", 0))
	snapshot.copper = maxi(0, read_int(snapshot_payload, "copper", 0))
	var crystals := maxi(0, read_int(snapshot_payload, "mana_monocrystals", -1))
	if crystals < 0:
		crystals = maxi(0, read_int(snapshot_payload, "monocrystals", 0))
	snapshot.mana_monocrystals = crystals
	return snapshot

## 展示派生：生命值百分比（只读格式化，不参与任何业务规则）
func get_health_ratio() -> float:
	return clampf(hp_current / maxf(hp_max, 1.0), 0.0, 1.0)

## 展示派生：魔力值百分比（只读格式化，不参与任何业务规则）
func get_mana_ratio() -> float:
	return clampf(mp_current / maxf(mp_max, 1.0), 0.0, 1.0)
