# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_economy_service.gd
# 架构定位: Domain Boundary Adapter / Real Economy Service Bridge
# 依赖与触发: 上游: EconomyTradeView, ServiceContainer, ServiceLocator | 下游: CurrencyAndManaStandardSolver, GameConfig
# 职责说明: 实现 IEconomyService 接口，依据货币本位配置与动态市场参数求解汇率、交易总额与价格序列。
# 退出语义与设计依据: 表现层零金融汇率运算与配置唯一真源契约
# ==============================================================================

## RealEconomyService：基于货币与市场配置求解金融换算与价格序列的真实经济服务
class_name RealEconomyService
extends "res://frontend/domain_boundary/interfaces/i_economy_service.gd"

const DEFAULT_SELL_RATIO: float = 0.70

func _read_currency_rates() -> Dictionary:
	return {
		"copper_to_copper": maxi(1, GameConfig.get_int("domains.currency", "rates/copper", 1)),
		"silver_to_copper": maxi(1, GameConfig.get_int("domains.currency", "rates/silver", 100)),
		"gold_to_copper": maxi(1, GameConfig.get_int("domains.currency", "rates/gold", 10000)),
		"crystal_to_copper": maxi(1, GameConfig.get_int("domains.currency", "rates/mana_monocrystals", 12000)),
	}

## 获取配置驱动的经济与汇率规则快照
func get_rules() -> Dictionary:
	var currency_rates: Dictionary = _read_currency_rates()
	var sell_back_ratio: float = clampf(GameConfig.get_float("domains.economy", "shop/sell_back_ratio", DEFAULT_SELL_RATIO), 0.05, 1.0)
	currency_rates["sell_back_ratio"] = sell_back_ratio
	currency_rates["cycle_ticks"] = maxi(1, GameConfig.get_int("domains.economy", "dynamic_market/time_cycle_ticks", 20))
	return currency_rates

## 按配置汇率将金/银/铜汇总为铜币基准总量
func calculate_total_copper(gold: int, silver: int, copper: int) -> int:
	var rates: Dictionary = _read_currency_rates()
	return maxi(0, gold) * int(rates["gold_to_copper"]) + maxi(0, silver) * int(rates["silver_to_copper"]) + maxi(0, copper) * int(rates["copper_to_copper"])

## 将铜币总量拆分为金/银/铜三阶面额
func split_copper(total_copper: int) -> Dictionary:
	var rates: Dictionary = _read_currency_rates()
	var remaining_copper: int = maxi(0, total_copper)
	var gold_unit: int = int(rates["gold_to_copper"])
	var silver_unit: int = int(rates["silver_to_copper"])
	@warning_ignore("integer_division")
	var gold_part: int = remaining_copper / gold_unit
	remaining_copper %= gold_unit
	@warning_ignore("integer_division")
	var silver_part: int = remaining_copper / silver_unit
	var copper_part: int = remaining_copper % silver_unit
	return {
		"gold": gold_part,
		"silver": silver_part,
		"copper": copper_part,
	}

## 根据货币选项索引查询对应铜币基准面值
func get_currency_copper(currency_index: int) -> int:
	var rates: Dictionary = _read_currency_rates()
	var indexed_units: Array[int] = [
		int(rates["gold_to_copper"]),
		int(rates["silver_to_copper"]),
		int(rates["copper_to_copper"]),
		int(rates["crystal_to_copper"]),
	]
	if currency_index >= 0 and currency_index < indexed_units.size():
		return indexed_units[currency_index]
	return int(rates["copper_to_copper"])

## 计算商店买入或卖出（含回购折扣）交易总价
func calculate_shop_total(base_price: int, quantity: int, is_sell: bool) -> int:
	var gross_copper: int = maxi(0, base_price) * maxi(0, quantity)
	if not is_sell:
		return gross_copper
	var sell_back_ratio: float = clampf(GameConfig.get_float("domains.economy", "shop/sell_back_ratio", DEFAULT_SELL_RATIO), 0.05, 1.0)
	return int(round(float(gross_copper) * sell_back_ratio))

## 计算源货币对目标货币的兑换比值（附零除守卫）
func calculate_exchange_rate(source_copper: int, target_copper: int) -> float:
	if target_copper <= 0:
		return 0.0
	return float(maxi(0, source_copper)) / float(target_copper)

## 按给定数量与汇率计算兑换目标数量
func calculate_exchange_result(amount: int, exchange_rate: float) -> float:
	return float(maxi(0, amount)) * maxf(0.0, exchange_rate)

## 基于动态市场周期参数确定性生成商品 7 日价格序列
func generate_price_series(commodity_key: String) -> Array:
	var seed_hash: int = int(abs(commodity_key.hash()))
	var baseline_price: int = 80 + (seed_hash % 120)
	var amplitude: float = clampf(GameConfig.get_float("domains.economy", "dynamic_market/price_change_rate_max", 0.25), 0.05, 0.5)
	var price_series: Array = []
	for day_index in range(7):
		var wave_factor: float = sin(float(day_index + (seed_hash % 5)) * 0.85) * amplitude
		var adjusted_price: int = maxi(10, int(round(float(baseline_price) * (1.0 + wave_factor))))
		price_series.append(adjusted_price)
	return price_series

## 分发商店买卖、竞拍与货币兑换动作至后端经济协议并同步钱包
func dispatch_economy_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return RealProtocolBridge.dispatch_flat("economy", action_type, payload_data)
