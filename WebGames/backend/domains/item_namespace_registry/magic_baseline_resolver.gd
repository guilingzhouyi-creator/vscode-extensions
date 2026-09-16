# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/magic_baseline_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 将法术/施法者声明（形态 + 位阶 + 资质 + 实力称号）确定性解析为统一 魔法基线快照；强制规范化约束——真神从属超位形态、未登记拒绝、 魔术师档（非魔法范畴）不进入魔法位阶体系、禁绕过注册表
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicBaselineResolver
extends RefCounted

# ==============================================================================
# 一、解析器状态
# ==============================================================================

var _registry: MagicTierRegistry

## 构造：注入魔法登记表（单数据源，禁绕过注册系统直读配置）
func _init(registry: MagicTierRegistry) -> void:
	_registry = registry

# ==============================================================================
# 二、确定性解析入口
# ==============================================================================

## 确定性解析入口（四独立维度）：
## - 注册表未就绪 → REGISTRY_NOT_READY；
## - 真神位阶（GOD_1/GOD_2）未配对超位形态 → SUPERTIER_FORM_MISMATCH（从属不变量）；
## - 未登记位阶/形态/资质/实力称号 → 对应 UNREGISTERED_*（不产生基线消费）；
## - 成功 → 位阶强度权重 + 形态相变能损区间 + 资质反噬阈值 + 实力称号归属。
func resolve(magic_form: int, magic_rank: int, mana_aptitude: int, profession_rank: int) -> Dictionary:
	if not _registry.is_ready():
		return {"success": false, "code": "REGISTRY_NOT_READY"}
	if not MagicTierSnapshot.is_god_form_pair_valid(magic_rank, magic_form):
		return {"success": false, "code": "SUPERTIER_FORM_MISMATCH"}
	var rank_bl: Dictionary = _registry.get_rank_baseline(magic_rank)
	if rank_bl.is_empty():
		return {"success": false, "code": "UNREGISTERED_RANK"}
	var form_bl: Dictionary = _registry.get_form_baseline(magic_form)
	if form_bl.is_empty():
		return {"success": false, "code": "UNREGISTERED_FORM"}
	var aptitude_bl: Dictionary = _registry.get_aptitude_baseline(mana_aptitude)
	if aptitude_bl.is_empty():
		return {"success": false, "code": "UNREGISTERED_APTITUDE"}
	var profession_bl: Dictionary = _registry.get_profession_rank_baseline(profession_rank)
	if profession_bl.is_empty():
		return {"success": false, "code": "UNREGISTERED_PROFESSION"}
	return {
		"success": true,
		"magic_form": magic_form,
		"magic_rank": magic_rank,
		"ability_tier": MagicAbilityTierResolver.infer_tier_candidates(magic_rank, _registry),
		"rank_band": MagicRankBandResolver.rank_to_band(magic_rank, _registry),
		"mana_aptitude": mana_aptitude,
		"profession_rank": profession_rank,
		"strength_weight": rank_bl.get("strength_weight", 1.0),
		"phase_loss_min": form_bl.get("phase_loss_min", 0.0),
		"phase_loss_max": form_bl.get("phase_loss_max", 0.0),
		"backfire_threshold": aptitude_bl.get("backfire_threshold", 1),
		"magic_domain": profession_bl.get("magic_domain", false),
	}

# ==============================================================================
# 三、便捷查询
# ==============================================================================

## 便捷查询：直接取位阶强度权重（未登记/未就绪安全兜底 1.0，不抛 Fatal）
func get_strength_weight(magic_rank: int) -> float:
	var result := resolve(
		MagicTierSnapshot.MagicForm.INCANTATION,
		magic_rank,
		MagicTierSnapshot.ManaAptitude.MANA_ADAPTOR,
		MagicTierSnapshot.ProfessionRank.NOVICE_MAGE)
	return float(result.get("strength_weight", 1.0))
