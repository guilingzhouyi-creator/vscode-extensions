# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_quality_promotion_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 根据鉴定激活的高阶 C 类词缀综合评分，动态推导物品展示品质（品阶）升格。 评分阈值/词缀上限由 config/domains/item_attributes.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemQualityPromotionSolver
extends RefCounted

# ==============================================================================
# 一、升格结果实体
# ==============================================================================

## 品质升格结算结果：原始/生效品阶、升格标记、总词缀评分与激活词缀数
class QualityPromotionResult extends RefCounted:
	var original_tier_rank: int = 1
	var effective_tier_rank: int = 1
	var is_promoted: bool = false
	var total_affix_score: float = 0.0
	var affix_count: int = 0

# ==============================================================================
# 二、升格评估算法
# ==============================================================================

## 根据挂载的已鉴定特殊词缀评估是否触发品质晋级
static func evaluate_quality_promotion(
	original_tier: int,
	mounts: Array,
	definitions_by_uid: Dictionary
) -> QualityPromotionResult:
	var res := QualityPromotionResult.new()
	res.original_tier_rank = original_tier
	res.effective_tier_rank = original_tier

	var total_score: float = 0.0
	var active_affix_count: int = 0
	var max_affixes: int = GameConfig.get_int("domains.item_attributes", "global_limits/max_special_affixes_per_item", 3)

	for m in mounts:
		if not (m is ItemAttributeMountInstance):
			continue
		var mount: ItemAttributeMountInstance = m

		if mount.category != ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
			continue

		# 仅限经合法鉴定激活的词缀参与评分
		if mount.visibility != ItemAttributeMountInstance.VisibilityState.APPRAISED or not mount.is_active:
			continue

		var def: ItemAttributeDefinition = definitions_by_uid.get(mount.attribute_uid, null)
		if def == null:
			continue

		total_score += def.affix_score
		active_affix_count += 1
		if active_affix_count >= max_affixes:
			break

	res.total_affix_score = total_score
	res.affix_count = active_affix_count

	# 阶梯阈值比对
	var t6: float = GameConfig.get_float("domains.item_attributes", "quality_upgrade_thresholds/tier_6", 1000.0)
	var t5: float = GameConfig.get_float("domains.item_attributes", "quality_upgrade_thresholds/tier_5", 500.0)
	var t4: float = GameConfig.get_float("domains.item_attributes", "quality_upgrade_thresholds/tier_4", 260.0)
	var t3: float = GameConfig.get_float("domains.item_attributes", "quality_upgrade_thresholds/tier_3", 120.0)
	var t2: float = GameConfig.get_float("domains.item_attributes", "quality_upgrade_thresholds/tier_2", 50.0)

	var calculated_tier: int = original_tier
	if total_score >= t6:
		calculated_tier = maxi(calculated_tier, 6) # 传说
	elif total_score >= t5:
		calculated_tier = maxi(calculated_tier, 5) # 远古
	elif total_score >= t4:
		calculated_tier = maxi(calculated_tier, 4) # 史诗
	elif total_score >= t3:
		calculated_tier = maxi(calculated_tier, 3) # 稀有
	elif total_score >= t2:
		calculated_tier = maxi(calculated_tier, 2) # 精良

	res.effective_tier_rank = calculated_tier
	res.is_promoted = (calculated_tier > original_tier)

	return res
