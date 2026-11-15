# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_grimoire_service.gd
# 架构定位: Domain Boundary Adapter / Real Grimoire Authoring Service Bridge
# 依赖与触发: 上游: GrimoireAuthoringView, ServiceContainer, ServiceLocator | 下游: GrimoireAuthoringPipeline, GameConfig
# 职责说明: 实现 IGrimoireService 接口，依据典籍手稿默认定价与版税配置估算著书收益及汇总分润。
# 退出语义与设计依据: 表现层零收益公式计算与配置驱动出版核算契约
# ==============================================================================

## RealGrimoireService：直连手稿出版配置与版税核算逻辑的真实魔典服务
class_name RealGrimoireService
extends "res://frontend/domain_boundary/interfaces/i_grimoire_service.gd"

## 依据版税档位索引估算单部典籍稿酬预期区间
func estimate_authoring_income(royalty_mode_index: int) -> Dictionary:
	var base_price: float = float(maxi(10, GameConfig.get_int("domains.lattice", "manuscript_defaults/default_price", 100)))
	var base_royalty: float = clampf(GameConfig.get_float("domains.lattice", "manuscript_defaults/default_royalty_rate", 0.20), 0.05, 0.90)
	var mode_multipliers: Array[float] = [0.85, 1.0, 1.35, 1.75]
	var bounded_index: int = clampi(royalty_mode_index, 0, mode_multipliers.size() - 1)
	var tier_multiplier: float = mode_multipliers[bounded_index]
	var baseline_payout: float = base_price * base_royalty * tier_multiplier
	var minimum_income: int = maxi(10, int(round(baseline_payout * 8.0)))
	var maximum_income: int = maxi(minimum_income + 50, int(round(baseline_payout * 42.0)))
	return {
		"success": true,
		"min": minimum_income,
		"max": maximum_income,
	}

## 汇总多部已出版典籍的版税收益总额
func sum_royalties(books: Array) -> Dictionary:
	var default_price: float = float(GameConfig.get_int("domains.lattice", "manuscript_defaults/default_price", 100))
	var default_rate: float = GameConfig.get_float("domains.lattice", "manuscript_defaults/default_royalty_rate", 0.20)
	var accumulated_gold: int = 0
	for book_entry in books:
		if not (book_entry is Dictionary):
			continue
		var unit_price: float = float(book_entry.get("price", default_price))
		var royalty_rate: float = float(book_entry.get("royalty_rate", default_rate))
		var sold_copies: float = float(maxi(0, int(book_entry.get("sales", 0))))
		accumulated_gold += int(floor(unit_price * royalty_rate * sold_copies))
	return {
		"success": true,
		"total": accumulated_gold,
	}
