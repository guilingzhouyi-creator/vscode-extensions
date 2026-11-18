# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/innate_trait_registry.gd
# 架构定位: Domain Registry / Specification Catalog
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 正面特质与负面缺陷因果点数守恒天平、属性与抗性修正 全量词条由 config/domains/character_creation.json 的 traits 段驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## InnateTraitRegistry：Domain Registry / Specification Catalog
class_name InnateTraitRegistry extends RefCounted

# ==============================================================================
# 一、词条表读取（config/domains/character_creation.json traits 段）
# ==============================================================================

## 读取全量特质词条表（优先使用已适配 MOD 清单，其次读取运行期覆写后的 domains.character_creation traits 段）
static func _traits(adapted_mod_manifest: Dictionary = {}) -> Dictionary:
	var manifest: Dictionary = DestinyModManifestDTO.unwrap_adapted_manifest(adapted_mod_manifest)
	var mod_traits: Variant = manifest.get("traits", {})
	if mod_traits is Dictionary and not (mod_traits as Dictionary).is_empty():
		return mod_traits as Dictionary
	return GameConfig.get_dict("domains.character_creation", "traits", {})

## 按特质 ID 取词条（未登记返回空字典，调用方防御性判空）
static func get_trait(trait_id: String, adapted_mod_manifest: Dictionary = {}) -> Dictionary:
	return _traits(adapted_mod_manifest).get(trait_id, {})

## 特质 ID 是否已登记
static func has_trait(trait_id: String, adapted_mod_manifest: Dictionary = {}) -> bool:
	return _traits(adapted_mod_manifest).has(trait_id)

# ==============================================================================
# 二、因果点守恒与选择校验
# ==============================================================================

## 因果点守恒结算：所选特质的 cost 净和（正面特质正价 / 缺陷负价对冲）。
## 契约：未登记特质 ID 安全跳过（不计入净和）；净和可为负（多选缺陷）。
static func calculate_trait_karma_balance(selected_trait_ids: Array, adapted_mod_manifest: Dictionary = {}) -> int:
	var net_karma := 0
	var traits_catalog := _traits(adapted_mod_manifest)
	for trait_id in selected_trait_ids:
		if traits_catalog.has(trait_id):
			net_karma += int(traits_catalog[trait_id].get("cost", 0))
	return net_karma

## 特质选择校验：因果净和不得超过 max_allowed_karma 上限。
## 契约：超限返回 { valid:false, balance, reason }（文案来自 narratives 配置键
##       karma_exceed）；通过返回 { valid:true, balance }，无副作用。
static func validate_traits_selection(
	selected_trait_ids: Array,
	max_allowed_karma: int = 0,
	adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
	var balance := calculate_trait_karma_balance(selected_trait_ids, adapted_mod_manifest)
	if balance > max_allowed_karma:
		var reason_text := GameConfig.get_string("narratives.character_creation", "karma_exceed", "Karma cost %d exceeds allowance %d") % [balance, max_allowed_karma]
		return { "valid": false, "balance": balance, "reason": reason_text }
	return { "valid": true, "balance": balance }
