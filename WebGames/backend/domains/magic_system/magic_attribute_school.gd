# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_attribute_school.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 描述魔法属性大类（光系 金木水火土 / 暗系 风雷，成员配置化）与 派生变体（神圣/暗黑——融会贯通后的进一步变体，属既有位阶魔法大类→ 法式魔法→变体体系，非与光/暗平行的新顶层）。变体判定依据 magic_rules.json 的 fusion_conditions 可配置条件（引擎不写死组合）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicAttributeSchool
extends RefCounted

class MagicVariant:
	var variant_id: String = ""
	var source_schools: Array = []
	var fusion_mode: String = "ANY"
	var fusion_conditions: Dictionary = {}
	var variant_of_form: int = 2
	var name_key: String = ""

	func to_dto() -> Dictionary:
		return {
			"variant_id": variant_id,
			"source_schools": source_schools.duplicate(),
			"fusion_mode": fusion_mode,
			"fusion_conditions": fusion_conditions.duplicate(true),
			"variant_of_form": int(variant_of_form),
			"name_key": name_key,
		}

var school_id: String = ""
var name_key: String = ""
var members: Array = []          # 属性键数组（顺序由配置决定）

## 由注册表配置条目构造属性大类（未登记键受控拒绝）
static func from_registry_entry(school_id_in: String, entry: Dictionary) -> MagicAttributeSchool:
	var school := MagicAttributeSchool.new()
	school.school_id = school_id_in
	school.name_key = str(entry.get("name_key", ""))
	school.members = entry.get("members", []).duplicate()
	return school

## 由注册表配置条目构造派生变体
static func variant_from_registry_entry(variant_id_in: String, entry: Dictionary) -> MagicVariant:
	var v := MagicVariant.new()
	v.variant_id = variant_id_in
	v.source_schools = entry.get("source_schools", []).duplicate()
	v.fusion_mode = str(entry.get("fusion_mode", "ANY"))
	v.fusion_conditions = entry.get("fusion_conditions", {}).duplicate(true)
	v.variant_of_form = int(entry.get("variant_of_form", 2))
	v.name_key = str(entry.get("name_key", ""))
	return v

func has_attribute(attribute_id: String) -> bool:
	return members.has(attribute_id)
