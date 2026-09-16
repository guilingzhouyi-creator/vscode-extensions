# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/character_profile.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 玩家角色本体数据（与账号/世界严格分离）：属性、成长、背包装备、 个人资源、个人任务、关系状态、专属进度。角色死亡时按白名单精确清理， 新角色零继承；默认值由 config/domains/account.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterProfile extends RefCounted

# ==============================================================================
# 一、本体数据字段（与账号/世界严格分离）
# ==============================================================================

var character_id: String = ""
var character_name: String = ""
var attributes: Dictionary = {}
var growth_state: Dictionary = {}
var inventory: Dictionary = {}
var equipment: Dictionary = {}
var personal_resources: Dictionary = {}
var personal_quest_progress: Dictionary = {}
var relationship_state: Dictionary = {}
var character_exclusive_progress: Dictionary = {}

# ==============================================================================
# 二、白名单与本体子集操作
# ==============================================================================

## 角色本体数据归属白名单（死亡精确清理范围，禁止粗粒度删全档）
const CHARACTER_OWNED_KEYS: Array[String] = [
	"attributes", "growth_state", "inventory", "equipment",
	"personal_resources", "personal_quest_progress",
	"relationship_state", "character_exclusive_progress"
]

## 白名单键是否持有非空本体数据
func has_payload(key: String) -> bool:
	return CHARACTER_OWNED_KEYS.has(key) and not _payload(key).is_empty()

## 精确清理单个角色本体子集（重置为空，保留骨架）
func clear_payload(key: String) -> void:
	match key:
		"attributes": attributes = {}
		"growth_state": growth_state = {}
		"inventory": inventory = {}
		"equipment": equipment = {}
		"personal_resources": personal_resources = {}
		"personal_quest_progress": personal_quest_progress = {}
		"relationship_state": relationship_state = {}
		"character_exclusive_progress": character_exclusive_progress = {}

## 新角色判定：白名单内全部本体子集均为空
func is_fresh() -> bool:
	for k in CHARACTER_OWNED_KEYS:
		if not _payload(k).is_empty():
			return false
	return true

## 按白名单键取本体子集引用（未匹配返回空字典）
func _payload(key: String) -> Dictionary:
	match key:
		"attributes": return attributes
		"growth_state": return growth_state
		"inventory": return inventory
		"equipment": return equipment
		"personal_resources": return personal_resources
		"personal_quest_progress": return personal_quest_progress
		"relationship_state": return relationship_state
		"character_exclusive_progress": return character_exclusive_progress
	return {}

## 序列化角色档案为字典（全本体子集平铺输出）
func serialize() -> Dictionary:
	return {
		"character_id": character_id, "character_name": character_name,
		"attributes": attributes, "growth_state": growth_state,
		"inventory": inventory, "equipment": equipment,
		"personal_resources": personal_resources, "personal_quest_progress": personal_quest_progress,
		"relationship_state": relationship_state, "character_exclusive_progress": character_exclusive_progress
	}

## 从字典反序列化角色档案（缺省字段回退空字典）
static func deserialize(d: Dictionary) -> CharacterProfile:
	var profile := CharacterProfile.new()
	profile.character_id = d.get("character_id", "")
	profile.character_name = d.get("character_name", "")
	profile.attributes = d.get("attributes", {})
	profile.growth_state = d.get("growth_state", {})
	profile.inventory = d.get("inventory", {})
	profile.equipment = d.get("equipment", {})
	profile.personal_resources = d.get("personal_resources", {})
	profile.personal_quest_progress = d.get("personal_quest_progress", {})
	profile.relationship_state = d.get("relationship_state", {})
	profile.character_exclusive_progress = d.get("character_exclusive_progress", {})
	return profile