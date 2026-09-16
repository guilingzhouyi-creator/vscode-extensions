# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟经济交易服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_economy_service.gd
# 职责: 货币换算、回购折扣、兑换率与物价序列等金融规则（配置读取收敛至边界层）
# ==============================================================================
class_name MockEconomyService
extends IEconomyService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe05_economy_trade"

func get_rules() -> Dictionary:
	return {
		"copper_per_gold": GameConfig.get_int(RULES_SECTION, RULES_KEY + "/gold_to_copper", 10000),
		"copper_per_silver": GameConfig.get_int(RULES_SECTION, RULES_KEY + "/silver_to_copper", 100),
		"copper_per_crystal": GameConfig.get_int(RULES_SECTION, RULES_KEY + "/crystal_to_copper", 12000),
		"sell_back_ratio": GameConfig.get_float(RULES_SECTION, RULES_KEY + "/sell_back_ratio", 0.7),
	}

func calculate_total_copper(gold: int, silver: int, copper: int) -> int:
	var per_gold := int(get_rules().get("copper_per_gold", 10000))
	var per_silver := int(get_rules().get("copper_per_silver", 100))
	return gold * per_gold + silver * per_silver + copper

func split_copper(total: int) -> Dictionary:
	var per_gold := int(get_rules().get("copper_per_gold", 10000))
	var per_silver := int(get_rules().get("copper_per_silver", 100))
	var gold := total / per_gold
	var remainder := total % per_gold
	return {
		"gold": gold,
		"silver": remainder / per_silver,
		"copper": remainder % per_silver,
	}

func get_currency_copper(index: int) -> int:
	match index:
		0:
			return int(get_rules().get("copper_per_gold", 10000))
		1:
			return int(get_rules().get("copper_per_silver", 100))
		3:
			return int(get_rules().get("copper_per_crystal", 12000))
		_:
			return 1

func calculate_shop_total(base_price: int, qty: int, is_sell: bool) -> int:
	var total := base_price * qty
	if is_sell:
		return int(float(total) * float(get_rules().get("sell_back_ratio", 0.7)))
	return total

func calculate_exchange_rate(src_copper: int, tgt_copper: int) -> float:
	if tgt_copper <= 0:
		return 0.0
	return float(src_copper) / float(tgt_copper)

func calculate_exchange_result(amount: int, rate: float) -> float:
	return float(amount) * rate

func generate_price_series(commodity_key: String) -> Array:
	var base := 50
	match commodity_key:
		"ui.fe05.commodity.wood":
			base = 30
		"ui.fe05.commodity.herbs":
			base = 45
		"ui.fe05.commodity.mana_crystal":
			base = 200
		"ui.fe05.commodity.copper_ore":
			base = 15
	var prices: Array = []
	for i in range(7):
		var seed_val := base + int(sin(i * 1.2) * base * 0.1) + i * 2
		prices.append(max(1, seed_val))
	return prices
