# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_economy_service.gd
# 架构定位: Domain Boundary Mock / Simulated Economy Service
# 依赖与触发: 上游: MockServiceContainer, 经济与商店视图 | 下游: GameConfig
# 职责说明: 提供模拟经济交易服务，承担货币换算、回购折扣、兑换率与物价序列演算。
# 退出语义与设计依据: 表现层零金融规则计算与 GameConfig 单源配置读取契约
# ==============================================================================

## MockEconomyService：货币换算、交易结算与物价走势模拟服务
class_name MockEconomyService
extends IEconomyService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe05_economy_trade"
const CURRENCY_SECTION := "domains.currency"

## 从 GameConfig 读取货币铜值换算率与商店回购折扣规则
func get_rules() -> Dictionary:
	return {
		"copper_per_gold": GameConfig.get_int(CURRENCY_SECTION, "rates/gold", 10000),
		"copper_per_silver": GameConfig.get_int(CURRENCY_SECTION, "rates/silver", 100),
		"copper_per_crystal": GameConfig.get_int(CURRENCY_SECTION, "rates/mana_monocrystals", 12000),
		"sell_back_ratio": GameConfig.get_float(RULES_SECTION, RULES_KEY + "/sell_back_ratio", 0.7),
	}

## 将金/银/铜三元货币折算为铜币总值
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

func calculate_shop_total(base_price: int, quantity: int, is_sell: bool) -> int:
	var total := base_price * quantity
	if is_sell:
		return int(float(total) * float(get_rules().get("sell_back_ratio", 0.7)))
	return total

func calculate_exchange_rate(source_copper: int, target_copper: int) -> float:
	if target_copper <= 0:
		return 0.0
	return float(source_copper) / float(target_copper)

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
	for day_index in range(7):
		var sampled_price := base + int(sin(day_index * 1.2) * base * 0.1) + day_index * 2
		prices.append(max(1, sampled_price))
	return prices
