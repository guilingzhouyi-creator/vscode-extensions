# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/physical_verb_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 八大物理动词侵彻常数、四大魔法形态枚举与动作卡牌实体。 动词常数与卡牌默认值由 config/domains/combat.json 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name PhysicalVerbRegistry extends RefCounted

static var verbs: Dictionary:
	get:
		return GameConfig.get_dict("domains.combat", "verbs", {})

## 动词常数表读取（config/domains/combat.json verbs 段）
static func _verbs() -> Dictionary:
	return verbs

## 按动词 ID 取常数（未登记回退 _fallback 默认）
static func get_verb(verb_id: String) -> Dictionary:
	var verbs := _verbs()
	if verbs.has(verb_id):
		return verbs[verb_id]
	return verbs.get("_fallback", {})

## 卡牌默认值静态缓存（Phase 64 P2 模式：配置热重载版本推进自动失效重建）。
## CombatActionCardEntity 每张构造原本触发 10 次 GameConfig 路径查找（其中多数字段
## 被调用方立即覆写）——热路径每回合 ~50~90 次查找，无头后端并发战斗线性放大；
## 缓存后构造仅一次版本比对 + 字段复制，配置变更经 config_reload_version 自动重建。
static var _card_defaults: Dictionary = {}
static var _card_defaults_ready: bool = false
static var _card_defaults_config_version: int = -1

## 卡牌默认值缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_card_defaults() -> void:
	if _card_defaults_ready and _card_defaults_config_version == GameConfig.config_reload_version():
		return
	_card_defaults = {
		"verb_type": GameConfig.get_string("domains.combat", "card_defaults/verb_type", "SLASH"),
		"magic_form": GameConfig.get_int("domains.combat", "card_defaults/magic_form", 1),
		"ap_cost": GameConfig.get_int("domains.combat", "card_defaults/ap_cost", -2),
		"base_potency": GameConfig.get_float("domains.combat", "card_defaults/base_potency", 20.0),
		"required_weapon_category": GameConfig.get_string("domains.combat", "card_defaults/required_weapon_category", "WEAPON_BLADE"),
		"card_category": GameConfig.get_string("domains.combat", "card_pool_defaults/card_category", "ATTACK"),
		"magic_ref": GameConfig.get_string("domains.combat", "card_pool_defaults/magic_ref", ""),
		"effects": GameConfig.get_array("domains.combat", "card_pool_defaults/effects", []),
		"card_pool": GameConfig.get_string("domains.combat", "card_pool_defaults/card_pool", "random"),
	}
	_card_defaults_config_version = GameConfig.config_reload_version()
	_card_defaults_ready = true

## 卡牌默认值缓存访问（供测试断言与外部读取；构造路径走 _init 复制）
static func card_defaults() -> Dictionary:
	_ensure_card_defaults()
	return _card_defaults

enum MagicForm {
	PRIMORDIAL,  # 始源魔法 (无咏唱神代，直接驱动)
	INCANTATION, # 咒术魔法 (后时代咏唱共振)
	INTEGRATED,  # 集成法式 (复杂拓扑复合回路)
	SUPERTIER    # 超位禁咒 (天灾级战略法术)
}

class CombatActionCardEntity extends RefCounted:
	var card_id: String = ""
	var card_name: String = ""
	# 默认值经静态缓存注入（_init 一次性复制；热重载版本推进自动重建缓存）
	var verb_type: String = "SLASH"
	var magic_form: int = 1
	var ap_cost: int = -2
	var base_potency: float = 20.0
	var required_weapon_category: String = "WEAPON_BLADE"
	# ---- Phase 42 收编扩展（可选字段，非魔法卡保持默认，配置段兜底） ----
	var card_category: String = "ATTACK"
	var magic_ref: String = ""
	var effects: Array = []
	var card_pool: String = "random"

	func _init() -> void:
		var d: Dictionary = PhysicalVerbRegistry.card_defaults()
		verb_type = d.get("verb_type", verb_type)
		magic_form = int(d.get("magic_form", magic_form))
		ap_cost = int(d.get("ap_cost", ap_cost))
		base_potency = float(d.get("base_potency", base_potency))
		required_weapon_category = d.get("required_weapon_category", required_weapon_category)
		card_category = d.get("card_category", card_category)
		magic_ref = d.get("magic_ref", magic_ref)
		effects = (d.get("effects", []) as Array).duplicate()
		card_pool = d.get("card_pool", card_pool)

	## 序列化行动卡牌为字典（effects 深拷贝）
	func to_dto() -> Dictionary:
		return {
			"card_id": card_id,
			"card_name": card_name,
			"verb_type": verb_type,
			"magic_form": int(magic_form),
			"ap_cost": int(ap_cost),
			"base_potency": float(base_potency),
			"required_weapon_category": required_weapon_category,
			"card_category": card_category,
			"magic_ref": magic_ref,
			"effects": effects.duplicate(true),
			"card_pool": card_pool,
		}

class CombatNarrativeEventPacket extends RefCounted:
	var actor_id: String = ""
	var target_id: String = ""
	var verb_name: String = ""
	var raw_damage: float = 0.0
	var absorbed_damage: float = 0.0
	var final_damage: float = 0.0
	var is_interrupted: bool = false
	var narrative_text: String = ""
	var timestamp_tick: int = 0
