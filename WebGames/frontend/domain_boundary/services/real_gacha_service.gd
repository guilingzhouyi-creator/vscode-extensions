# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_gacha_service.gd
# 架构定位: Domain Boundary Adapter / Real Gacha Wish Service Bridge
# 依赖与触发: 上游: GachaWishView, ServiceContainer, ServiceLocator | 下游: GachaProbabilitySolver, DeterministicRNG, GameConfig
# 职责说明: 实现 IGachaService 接口，基于抽卡概率配置、软硬保底求解器与确定性随机器结算祈愿请求。
# 退出语义与设计依据: 表现层零概率计算与配置驱动祈愿结算契约
# ==============================================================================

## RealGachaService：直连后端祈愿概率求解器与卡池配置的真实祈愿服务
class_name RealGachaService
extends "res://frontend/domain_boundary/interfaces/i_gacha_service.gd"

const GachaProbabilitySolver = preload("res://backend/domains/gacha_wish/gacha_probability_solver.gd")

func _build_drop_entry(rarity: int, serial_number: int) -> Dictionary:
	return {
		"item_id": "WISH_DROP_R%d_%02d" % [rarity, serial_number],
		"rarity": rarity,
		"name": "%d★ 祈愿奖励 #%d" % [rarity, serial_number],
	}

## 获取配置驱动的祈愿基础概率、保底阈值与单抽消耗规则
func get_rules() -> Dictionary:
	return {
		"base_5star_rate": GameConfig.get_float("domains.gacha", "rates/base_5star", 0.006),
		"base_4star_rate": GameConfig.get_float("domains.gacha", "rates/base_4star", 0.051),
		"up_rate": GameConfig.get_float("domains.gacha", "rates/up_rate", 0.5),
		"soft_pity": GameConfig.get_int("domains.gacha", "pity/soft_threshold", 70),
		"hard_pity": GameConfig.get_int("domains.gacha", "pity/hard_threshold", 90),
		"four_star_pity": GameConfig.get_int("domains.gacha", "pity/four_star_threshold", 10),
		"cost_per_pull": maxi(1, GameConfig.get_int("domains.gacha", "banner_defaults/cost_per_pull_gold", 160)),
	}

## 按软硬保底曲线与确定性随机序列生成掉落数组
func generate_drops(pull_count: int, pity_5star: int, pity_4star: int) -> Array:
	var gacha_rules: Dictionary = get_rules()
	var four_star_limit: int = maxi(1, int(gacha_rules.get("four_star_pity", 10)))
	var rng := DeterministicRNG.global()
	var local_5star: int = maxi(0, pity_5star)
	var local_4star: int = maxi(0, pity_4star)
	var drops: Array = []
	for draw_index in range(maxi(0, pull_count)):
		local_5star += 1
		local_4star += 1
		var rate_5star: float = GachaProbabilitySolver.calculate_current_5star_rate(local_5star)
		var roll_value: float = rng.randf()
		if roll_value < rate_5star:
			local_5star = 0
			local_4star = 0
			drops.append(_build_drop_entry(5, draw_index + 1))
		elif local_4star >= four_star_limit or roll_value < rate_5star + float(gacha_rules.get("base_4star_rate", 0.051)):
			local_4star = 0
			drops.append(_build_drop_entry(4, draw_index + 1))
		else:
			drops.append(_build_drop_entry(3, draw_index + 1))
	return drops

## 结算一次或十连祈愿并更新保底、总抽数与历史记录状态
func resolve_pull(gacha_state: Dictionary, pull_count: int, injected_drops: Array = []) -> Dictionary:
	var sanitized_count: int = maxi(0, pull_count)
	var pity_counter: int = maxi(0, int(gacha_state.get("pity_counter", 0))) + sanitized_count
	var current_5star: int = maxi(0, int(gacha_state.get("pity_5star", 0)))
	var current_4star: int = maxi(0, int(gacha_state.get("pity_4star", 0)))
	var existing_counts: Dictionary = gacha_state.get("rarity_counts", {"5": 0, "4": 0, "3": 0}) as Dictionary
	var updated_counts: Dictionary = {
		"5": int(existing_counts.get("5", 0)),
		"4": int(existing_counts.get("4", 0)),
		"3": int(existing_counts.get("3", 0)),
	}
	var drop_results: Array = injected_drops.duplicate(true)
	if not injected_drops.is_empty():
		for drop_entry in drop_results:
			var drop_rarity: int = int(drop_entry.get("rarity", 3))
			if drop_rarity >= 5:
				current_5star = 0
				updated_counts["5"] = int(updated_counts["5"]) + 1
			elif drop_rarity == 4:
				current_5star += 1
				current_4star = 0
				updated_counts["4"] = int(updated_counts["4"]) + 1
			else:
				current_5star += 1
				current_4star += 1
				updated_counts["3"] = int(updated_counts["3"]) + 1
	else:
		current_5star += sanitized_count
		current_4star += sanitized_count
	return {
		"success": true,
		"results": drop_results,
		"pity_counter": pity_counter,
		"pity_5star": current_5star,
		"pity_4star": current_4star,
		"total_pull_count": int(gacha_state.get("total_pull_count", 0)) + sanitized_count,
		"rarity_counts": updated_counts,
	}

## 校验原石余额并扣减对应抽数消耗
func purchase(currency_balance: int, pull_count: int) -> Dictionary:
	var cost_per_pull: int = int(get_rules().get("cost_per_pull", 160))
	var required_currency: int = maxi(0, pull_count) * cost_per_pull
	if currency_balance < required_currency:
		return {"success": false, "error_code": "INSUFFICIENT_CURRENCY", "balance": currency_balance}
	return {"success": true, "balance": currency_balance - required_currency, "spent": required_currency}
