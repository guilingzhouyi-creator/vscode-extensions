# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 物品品质等级统一度量标准单元测试
# 文件路径: res://tests/unit/infrastructure/test_item_quality.gd
# 覆盖: Phase 17 施工细则 阶段1~4（TC-ITEM-QT-01~06）
#       —— 六档单调序列 / 神话区间端点语义 / 唯一映射 / 禁跨级倒置 /
#          配置完整与安全兜底 / 扩展受限（未登记与跨级区间拒绝）
# ==============================================================================
class_name TestItemQualityDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Phase 17: 物品品质等级统一度量标准"

	results.append(_test_tier_monotonic_sequence())
	results.append(_test_mythic_interval_semantics())
	results.append(_test_unique_mapping())
	results.append(_test_no_tier_inversion())
	results.append(_test_config_completeness_and_fallback())
	results.append(_test_extension_constraint())
	# Phase 44 P1 新增：装配期单例复用（TC-P44-P1-01/02）
	results.append(_test_singleton_registry_reuse())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-ITEM-QT-01: 六档主品质单调序列（普通→精品→史诗→传奇→神话→古代，等级值严格单调 1~6）
static func _test_tier_monotonic_sequence() -> Dictionary:
	var levels := [
		ItemQualitySnapshot.tier_to_level(ItemQualitySnapshot.QualityTier.COMMON),
		ItemQualitySnapshot.tier_to_level(ItemQualitySnapshot.QualityTier.FINE),
		ItemQualitySnapshot.tier_to_level(ItemQualitySnapshot.QualityTier.EPIC),
		ItemQualitySnapshot.tier_to_level(ItemQualitySnapshot.QualityTier.LEGENDARY),
		ItemQualitySnapshot.tier_to_level(ItemQualitySnapshot.QualityTier.MYTHIC),
		ItemQualitySnapshot.tier_to_level(ItemQualitySnapshot.QualityTier.ANCIENT),
	]
	var strict_monotonic := levels == [1, 2, 3, 4, 5, 6]
	var registry := QualityTierRegistry.new()
	registry.reload_configuration()
	var passed = strict_monotonic and registry.is_ready() and (registry.get_tier_baseline(ItemQualitySnapshot.QualityTier.MYTHIC).size() > 0)
	return {
		"test": "TC-ITEM-QT-01: 六档主品质单调序列（普通→古代等级值严格递增 1~6）",
		"passed": passed
	}

## TC-ITEM-QT-02: 神话级内部区间端点语义（准神器=低端边界、真神器=高端边界，二者仅存在于神话级内）
static func _test_mythic_interval_semantics() -> Dictionary:
	var registry := QualityTierRegistry.new()
	registry.reload_configuration()
	var resolver := ItemQualityResolver.new(registry)
	var quasi := resolver.resolve("KALAR:EQUIP:WEAPON:QUASI_BLADE",
		ItemQualitySnapshot.QualityTier.MYTHIC, ItemQualitySnapshot.MythicInterval.QUASI_ARTIFACT)
	var true_res := resolver.resolve("KALAR:EQUIP:WEAPON:TRUE_BLADE",
		ItemQualitySnapshot.QualityTier.MYTHIC, ItemQualitySnapshot.MythicInterval.TRUE_ARTIFACT)
	var quasi_ok: bool = quasi.get("success", false) and int(quasi.get("tier", -1)) == ItemQualitySnapshot.QualityTier.MYTHIC
	var true_ok: bool = true_res.get("success", false) and int(true_res.get("mythic_interval", -1)) == ItemQualitySnapshot.MythicInterval.TRUE_ARTIFACT
	var endpoint_order_ok: bool = float(true_res.get("strength_weight", 0.0)) > float(quasi.get("strength_weight", 0.0))
	var passed = quasi_ok and true_ok and endpoint_order_ok
	return {
		"test": "TC-ITEM-QT-02: 神话区间端点语义（准神器低端/真神器高端，真神器权重 > 准神器）",
		"passed": passed
	}

## TC-ITEM-QT-03: 唯一映射（每物品恰好一个主品质 + 至多一个区间端点；六档配置唯一无重复）
static func _test_unique_mapping() -> Dictionary:
	var registry := QualityTierRegistry.new()
	registry.reload_configuration()
	var tiers_cfg: Dictionary = GameConfig.get_dict("domains.quality_tiers", "tiers", {})
	var tier_keys_unique: bool = tiers_cfg.size() == 6
	var resolver := ItemQualityResolver.new(registry)
	var first := resolver.resolve("KALAR:EQUIP:WEAPON:UNIQUE_SWORD",
		ItemQualitySnapshot.QualityTier.EPIC, ItemQualitySnapshot.MythicInterval.NONE)
	var second := resolver.resolve("KALAR:EQUIP:WEAPON:UNIQUE_SWORD",
		ItemQualitySnapshot.QualityTier.EPIC, ItemQualitySnapshot.MythicInterval.NONE)
	var snap: Dictionary = first.get("snapshot", {})
	var one_primary_tier: bool = str(first.get("canonical_id", "")) == "KALAR:EQUIP:WEAPON:UNIQUE_SWORD" \
		and int(snap.get("tier", -1)) == ItemQualitySnapshot.QualityTier.EPIC \
		and int(snap.get("mythic_interval", -1)) == ItemQualitySnapshot.MythicInterval.NONE
	var passed = tier_keys_unique and first.get("success", false) and second.get("success", false) and one_primary_tier
	return {
		"test": "TC-ITEM-QT-03: 唯一映射（六档配置唯一，物品恰好一个主品质 + 至多一个区间端点）",
		"passed": passed
	}

## TC-ITEM-QT-04: 禁跨级倒置（真实配置等级值严格连续递增 1~6，断裂/倒置即红）
static func _test_no_tier_inversion() -> Dictionary:
	var tiers_cfg: Dictionary = GameConfig.get_dict("domains.quality_tiers", "tiers", {})
	var levels: Array[int] = []
	for tier_key in tiers_cfg:
		levels.append(int(tiers_cfg[tier_key].get("level", 0)))
	levels.sort()
	var consecutive := true
	for i in range(levels.size()):
		if levels[i] != i + 1:
			consecutive = false
			break
	var registry := QualityTierRegistry.new()
	registry.reload_configuration()
	var passed = consecutive and registry.is_ready()
	return {
		"test": "TC-ITEM-QT-04: 禁跨级倒置（六档等级值严格连续递增 1~6，倒置/断裂即校验失败）",
		"passed": passed
	}

## TC-ITEM-QT-05: 配置完整与安全兜底（必需表可加载；未登记品质不产生基线消费，强度兜底 1.0）
static func _test_config_completeness_and_fallback() -> Dictionary:
	var registry := QualityTierRegistry.new()
	registry.reload_configuration()
	var resolver := ItemQualityResolver.new(registry)
	var rejected := resolver.resolve("KALAR:EQUIP:WEAPON:GHOST_TIER",
		99, ItemQualitySnapshot.MythicInterval.NONE)
	var rejected_ok: bool = not rejected.get("success", true) and str(rejected.get("code", "")) == "UNREGISTERED_TIER"
	var fallback: float = resolver.get_strength_weight("KALAR:EQUIP:WEAPON:GHOST_TIER",
		99, ItemQualitySnapshot.MythicInterval.NONE)
	var fallback_ok: bool = is_equal_approx(fallback, 1.0)
	var passed = registry.is_ready() and rejected_ok and fallback_ok
	return {
		"test": "TC-ITEM-QT-05: 配置完整与安全兜底（未登记品质拒绝 + 强度基线兜底 1.0 不抛 Fatal）",
		"passed": passed
	}

## TC-ITEM-QT-06: 扩展受限（非神话级携带区间端点被拒；新物品必须映射主品质，禁绕过/重定义）
static func _test_extension_constraint() -> Dictionary:
	var registry := QualityTierRegistry.new()
	registry.reload_configuration()
	var resolver := ItemQualityResolver.new(registry)
	var cross_tier := resolver.resolve("KALAR:EQUIP:WEAPON:CROSS_INTERVAL",
		ItemQualitySnapshot.QualityTier.LEGENDARY, ItemQualitySnapshot.MythicInterval.TRUE_ARTIFACT)
	var cross_ok: bool = not cross_tier.get("success", true) and str(cross_tier.get("code", "")) == "INTERVAL_OUTSIDE_MYTHIC"
	var no_declaration := resolver.resolve("KALAR:EQUIP:WEAPON:NO_DECLARATION",
		0, ItemQualitySnapshot.MythicInterval.NONE)
	var no_decl_ok: bool = not no_declaration.get("success", true) and str(no_declaration.get("code", "")) == "UNREGISTERED_TIER"
	var passed = cross_ok and no_decl_ok
	return {
		"test": "TC-ITEM-QT-06: 扩展受限（跨级区间端点/未登记品质拒绝，特殊物品仅既有标准内扩展）",
		"passed": passed
	}

## Phase 44 P1（TC-P44-P1-01/02）：QualityTierRegistry 装配期单例复用——
## GameBootstrap.quality_tier_registry() 多次调用返回同一就绪实例；ItemInstanceFactory
## build_instance 不传 registry（兜底单例）时品质快照与显式注入单例产出一致。
static func _test_singleton_registry_reuse() -> Dictionary:
	var reg_a: QualityTierRegistry = GameBootstrap.quality_tier_registry()
	var reg_b: QualityTierRegistry = GameBootstrap.quality_tier_registry()
	var reuse_ok: bool = reg_a != null and reg_a == reg_b and reg_a.is_ready()

	# 工厂发放：同一 proto 经「显式单例注入」与「缺省单例兜底」产出等价品质快照
	var catalog := GameBootstrap.catalog()
	var proto: ItemRegistryCatalog.ItemPrototypeTemplate = catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var snapshot_ok := true
	if proto != null and proto.quality_tier > 0:
		var item_explicit := ItemInstanceFactory.build_instance(proto, "显式单例", "P44A_", "", reg_a)
		var item_default := ItemInstanceFactory.build_instance(proto, "缺省单例", "P44B_")
		var sa: Dictionary = item_explicit.quality_snapshot
		var sb: Dictionary = item_default.quality_snapshot
		snapshot_ok = (not sa.is_empty()) and sa.get("tier", -1) == sb.get("tier", -2) \
			and sa.get("strength_weight", -1.0) == sb.get("strength_weight", -2.0)

	var passed = reuse_ok and snapshot_ok
	return {
		"test": "TC-P44-P1-01/02: 品质注册表单例复用 + 工厂发放快照等价（显式/兜底一致）",
		"passed": passed
	}
