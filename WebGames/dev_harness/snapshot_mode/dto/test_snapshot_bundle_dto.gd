# ==============================================================================
# 模块归属: 测试与工程化工具层 (Dev Harness · 快照测试工程模式)
# 文件路径: res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd
# 架构定位: Value Object / Data Transfer Object
# 跨域依赖: 纯数据载体，零强依赖
# 职责说明: 定义全域测试快照数据传输模型，支持全要素状态打包、往返序列化与对象池重置
# 设计依据: 业务域第一性原理 / 快照测试工程化规范
# ==============================================================================
class_name TestSnapshotBundleDTO
extends RefCounted

# ---- 元数据与调度 ----
var snapshot_id: String = ""
var description: String = ""
var target_stage_key: String = "STAGE_06_HUD_SYNC"
var timestamp_utc: int = 0

# ---- 账号与世界槽位 ----
var account_id: String = ""
var session_token: String = ""
var username: String = ""
var world_id: String = "WORLD_DEFAULT_SP_01"
var slot_id: String = "SLOT_01"

# ---- 角色元数据与六维属性 ----
var character_id: String = ""
var character_name: String = ""
var race_id: String = "HUMAN"
var gender: String = "MALE"
var level: int = 1
var attributes: Dictionary = {
	"strength": 3,
	"agility": 3,
	"physique": 3,
	"intelligence": 3,
	"willpower": 3,
	"perception": 3
}

# ---- 生理状态指标 ----
var physiology_data: Dictionary = {
	"current_hp": 100,
	"max_hp": 100,
	"current_mp": 50,
	"max_mp": 50,
	"stamina": 100,
	"max_stamina": 100,
	"hunger": 0,
	"thirst": 0,
	"sanity": 100,
	"status_effects": []
}

# ---- 经济资产指标 ----
var wallet_data: Dictionary = {
	"copper": 0,
	"silver": 0,
	"gold": 1000,
	"mana_monocrystals": 10
}

# ---- 背包容器与物品清单 ----
var inventory_items: Array = []

# ---- 地缘空间与导航坐标 ----
var location_name: String = "CENTRAL_CITY_PLAZA"
var coordinates_x: float = 0.0
var coordinates_y: float = 0.0

# ---- 任务与因果 DAG 状态 ----
var quest_dag_state: Dictionary = {
	"active_quests": [],
	"completed_quests": [],
	"activated_nodes": []
}

# ---- 自由领域扩展切片 ----
var domain_extensions: Dictionary = {}

## 对象池复位生命周期
func reset_state() -> void:
	snapshot_id = ""
	description = ""
	target_stage_key = "STAGE_06_HUD_SYNC"
	timestamp_utc = 0
	account_id = ""
	session_token = ""
	username = ""
	world_id = "WORLD_DEFAULT_SP_01"
	slot_id = "SLOT_01"
	character_id = ""
	character_name = ""
	race_id = "HUMAN"
	gender = "MALE"
	level = 1
	attributes = {
		"strength": 3, "agility": 3, "physique": 3,
		"intelligence": 3, "willpower": 3, "perception": 3
	}
	physiology_data = {
		"current_hp": 100, "max_hp": 100, "current_mp": 50, "max_mp": 50,
		"stamina": 100, "max_stamina": 100, "hunger": 0, "thirst": 0,
		"sanity": 100, "status_effects": []
	}
	wallet_data = {
		"copper": 0, "silver": 0, "gold": 1000, "mana_monocrystals": 10
	}
	inventory_items.clear()
	location_name = "CENTRAL_CITY_PLAZA"
	coordinates_x = 0.0
	coordinates_y = 0.0
	quest_dag_state = {
		"active_quests": [], "completed_quests": [], "activated_nodes": []
	}
	domain_extensions.clear()

## 序列化输出为纯字典
func to_dict() -> Dictionary:
	return {
		"snapshot_id": snapshot_id,
		"description": description,
		"target_stage_key": target_stage_key,
		"timestamp_utc": timestamp_utc,
		"account_id": account_id,
		"session_token": session_token,
		"username": username,
		"world_id": world_id,
		"slot_id": slot_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"gender": gender,
		"level": level,
		"attributes": attributes.duplicate(true),
		"physiology_data": physiology_data.duplicate(true),
		"wallet_data": wallet_data.duplicate(true),
		"inventory_items": inventory_items.duplicate(true),
		"location_name": location_name,
		"coordinates_x": coordinates_x,
		"coordinates_y": coordinates_y,
		"quest_dag_state": quest_dag_state.duplicate(true),
		"domain_extensions": domain_extensions.duplicate(true)
	}

## 从字典还原快照对象
static func from_dict(d: Dictionary) -> RefCounted:
	var bundle := new()
	bundle.snapshot_id = String(d.get("snapshot_id", ""))
	bundle.description = String(d.get("description", ""))
	bundle.target_stage_key = String(d.get("target_stage_key", "STAGE_06_HUD_SYNC"))
	bundle.timestamp_utc = int(d.get("timestamp_utc", 0))
	bundle.account_id = String(d.get("account_id", ""))
	bundle.session_token = String(d.get("session_token", ""))
	bundle.username = String(d.get("username", ""))
	bundle.world_id = String(d.get("world_id", "WORLD_DEFAULT_SP_01"))
	bundle.slot_id = String(d.get("slot_id", "SLOT_01"))
	bundle.character_id = String(d.get("character_id", ""))
	bundle.character_name = String(d.get("character_name", ""))
	bundle.race_id = String(d.get("race_id", "HUMAN"))
	bundle.gender = String(d.get("gender", "MALE"))
	bundle.level = int(d.get("level", 1))

	var raw_attr = d.get("attributes", null)
	if raw_attr is Dictionary:
		bundle.attributes = (raw_attr as Dictionary).duplicate(true)

	var raw_phys = d.get("physiology_data", null)
	if raw_phys is Dictionary:
		bundle.physiology_data = (raw_phys as Dictionary).duplicate(true)

	var raw_wallet = d.get("wallet_data", null)
	if raw_wallet is Dictionary:
		bundle.wallet_data = (raw_wallet as Dictionary).duplicate(true)

	var raw_inv = d.get("inventory_items", null)
	if raw_inv is Array:
		bundle.inventory_items = (raw_inv as Array).duplicate(true)

	bundle.location_name = String(d.get("location_name", "CENTRAL_CITY_PLAZA"))
	bundle.coordinates_x = float(d.get("coordinates_x", 0.0))
	bundle.coordinates_y = float(d.get("coordinates_y", 0.0))

	var raw_quest = d.get("quest_dag_state", null)
	if raw_quest is Dictionary:
		bundle.quest_dag_state = (raw_quest as Dictionary).duplicate(true)

	var raw_ext = d.get("domain_extensions", null)
	if raw_ext is Dictionary:
		bundle.domain_extensions = (raw_ext as Dictionary).duplicate(true)

	return bundle
