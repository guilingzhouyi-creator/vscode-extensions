# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_rule_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 加载 config/domains/magic_rules.json 唯一事实源，启动校验结构不变量 （属性大类成员闭合 / 变体源体系闭合 / 条件树结构 / 位阶形态合法 / 组合语义枚举 / 数值域），为魔法规则引擎提供统一配置查询。 位阶维度复用 MagicTierRegistry（不复制阶位表），禁止把示例数值或 固定属性组合固化为系统唯一规则。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicRuleRegistry
extends RefCounted

const CONFIG_TABLE: String = "domains.magic_rules"
const COMBO_DEFINED: String = "DEFINED"
const COMBO_PARTIAL: String = "PARTIAL"
const COMBO_UNDEFINED: String = "BND_NOT_DEFINED"

var _schools: Dictionary = {}     # school_id -> {name_key, members[]}
var _attributes: Dictionary = {}  # attribute_id -> {name_key, school}
var _variants: Dictionary = {}    # variant_id -> {source_schools, fusion_mode, fusion_conditions, variant_of_form, name_key}
var _multi_cast: Dictionary = {}
var _seal: Dictionary = {}
var _ascension: Dictionary = {}
var _delay: Dictionary = {}
var _combo_semantics: Dictionary = {}
var _ready: bool = false

## 重载全部段配置并执行结构不变量校验（全败置注册表未就绪）
func reload_configuration() -> void:
	_schools = _section("attribute_schools")
	_attributes = _section("attributes")
	_variants = _section("variants")
	_multi_cast = _section("multi_cast")
	_seal = _section("seal")
	_ascension = _section("ascension")
	_delay = _section("delay")
	_combo_semantics = _section("combo_semantics")
	_ready = _validate()

## 注册表是否就绪（结构不变量全通过）
func is_ready() -> bool:
	return _ready

# ==============================================================================
# 段读取（类型化，禁 Variant get_value）
# ==============================================================================

## 段读取：类型化 get_dict（禁 Variant get_value）
func _section(path: String) -> Dictionary:
	return GameConfig.get_dict(CONFIG_TABLE, path, {})

# ==============================================================================
# 结构不变量校验（全败即注册表不可用）
# ==============================================================================

## 结构不变量校验：段非空/大类成员闭合/变体源体系闭合/条件树/位阶形态/组合语义/数值域（全败即不可用）
func _validate() -> bool:
	if not _validate_sections_non_empty():
		return false
	if not _validate_school_attribute_closure():
		return false
	if not _validate_variants():
		return false
	if not _validate_combo_semantics():
		return false
	if not _validate_numerical_bounds():
		return false
	return true

## 校验关键配置段非空
func _validate_sections_non_empty() -> bool:
	if _schools.is_empty() or _attributes.is_empty() or _variants.is_empty():
		return false
	if _multi_cast.is_empty() or _seal.is_empty() or _ascension.is_empty() or _delay.is_empty():
		return false
	if _combo_semantics.is_empty():
		return false
	return true

## 校验属性与大类双向闭合
func _validate_school_attribute_closure() -> bool:
	for attr_id in _attributes:
		var entry: Dictionary = _attributes[attr_id]
		if not _schools.has(String(entry.get("school", ""))):
			return false
	for school_id in _schools:
		var school: Dictionary = _schools[school_id]
		for member in school.get("members", []):
			if not _attributes.has(String(member)):
				return false
	return true

## 校验变体结构合法性（源体系/条件树/位阶形态）
func _validate_variants() -> bool:
	for variant_id in _variants:
		var variant: Dictionary = _variants[variant_id]
		for src in variant.get("source_schools", []):
			if not _schools.has(String(src)):
				return false
		if not _valid_condition_tree(variant.get("fusion_conditions", {})):
			return false
		var vof := int(variant.get("variant_of_form", 0))
		if vof < 1 or vof > 4:
			return false
	return true

## 校验连携组合语义枚举合法性
func _validate_combo_semantics() -> bool:
	for combo_key in _combo_semantics:
		var val := String(_combo_semantics[combo_key])
		if val != COMBO_DEFINED and val != COMBO_PARTIAL and val != COMBO_UNDEFINED:
			return false
	return true

## 校验施法/进阶/延迟数值域约束
func _validate_numerical_bounds() -> bool:
	var max_casts := int(_multi_cast.get("max_casts", 0))
	if max_casts < 1 or max_casts > 10:
		return false
	var max_rank := int(_ascension.get("max_rank", 0))
	if max_rank < 1 or max_rank > 11:
		return false
	if not _valid_condition_tree(_ascension.get("conditions", {})):
		return false
	var dl_min := int(_delay.get("min_steps", 0))
	var dl_max := int(_delay.get("max_steps", 0))
	if dl_min < 0 or dl_max < dl_min:
		return false
	return true

## 条件树结构校验：LEAF 叶子或 AND/OR/NOT 递归（空树非法）
func _valid_condition_tree(node: Dictionary) -> bool:
	if node.is_empty():
		return false
	var op := String(node.get("op", ""))
	if op == "LEAF":
		return String(node.get("kind", "")).length() > 0 and (node.get("args", {}) is Dictionary)
	if op != "AND" and op != "OR" and op != "NOT":
		return false
	var terms = node.get("terms", [])
	if not terms is Array:
		return false
	for term in terms:
		if not term is Dictionary or not _valid_condition_tree(term):
			return false
	return true

# ==============================================================================
# 查询入口
# ==============================================================================

## 按大类 ID 查配置（未登记返回空字典）
func get_school(school_id: String) -> Dictionary:
	return _schools.get(school_id, {})

## 按属性 ID 查配置（未登记返回空字典）
func get_attribute(attribute_id: String) -> Dictionary:
	return _attributes.get(attribute_id, {})

## 按变体 ID 查配置（未登记返回空字典）
func get_variant(variant_id: String) -> Dictionary:
	return _variants.get(variant_id, {})

## 属性 ID 是否已登记
func has_attribute(attribute_id: String) -> bool:
	return _attributes.has(attribute_id)

## 大类 ID 是否已登记
func has_school(school_id: String) -> bool:
	return _schools.has(school_id)

## 变体 ID 是否已登记
func has_variant(variant_id: String) -> bool:
	return _variants.has(variant_id)

## 大类成员清单（未登记返回空数组）
func school_members(school_id: String) -> Array:
	return get_school(school_id).get("members", [])

## 属性 → 归属大类（未登记返回空串）
func attribute_school(attribute_id: String) -> String:
	return String(get_attribute(attribute_id).get("school", ""))

## 全部大类 ID（keys 引用）
func school_ids() -> Array:
	return _schools.keys()

## 全部属性 ID（keys 引用）
func attribute_ids() -> Array:
	return _attributes.keys()

## 全部变体 ID（keys 引用）
func variant_ids() -> Array:
	return _variants.keys()

## 段配置查询（P7：零拷贝只读共享——内部段引用直出，消费方不得就地修改；
## reload_configuration 整体替换段引用，写时复制语义保证旧引用不受热重载污染）
func multi_cast_config() -> Dictionary:
	return _multi_cast

## 封印段配置查询（零拷贝只读共享）
func seal_config() -> Dictionary:
	return _seal

## 位阶升格段配置查询（零拷贝只读共享）
func ascension_config() -> Dictionary:
	return _ascension

## 延迟段配置查询（零拷贝只读共享）
func delay_config() -> Dictionary:
	return _delay

## 组合语义查询：DEFINED / PARTIAL / BND_NOT_DEFINED（未登记亦返回待定义，禁静默猜测）
func combo_semantic(combo_key: String) -> String:
	var val := String(_combo_semantics.get(combo_key, COMBO_UNDEFINED))
	if val != COMBO_DEFINED and val != COMBO_PARTIAL:
		return COMBO_UNDEFINED
	return val

## 全量配置导出（遥测/统计/审计只读引用）
func export_config() -> Dictionary:
	return {
		"attribute_schools": _schools.duplicate(true),
		"attributes": _attributes.duplicate(true),
		"variants": _variants.duplicate(true),
		"multi_cast": _multi_cast.duplicate(true),
		"seal": _seal.duplicate(true),
		"ascension": _ascension.duplicate(true),
		"delay": _delay.duplicate(true),
		"combo_semantics": _combo_semantics.duplicate(true),
		"ready": _ready,
	}
