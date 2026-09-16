# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 经济交易服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_economy_service.gd
# 职责: 规范货币换算、交易合计、物价序列与汇率接口，隔离底层金融规则
# ==============================================================================
class_name IEconomyService
extends RefCounted

## 获取经济规则（货币铜值 / 回购折扣），供视图只读展示
func get_rules() -> Dictionary:
	printerr("IEconomyService.get_rules: 纯虚函数必须由子类实现")
	return {}

## 四元钱包 → 铜币总值（金/银/铜）
func calculate_total_copper(gold: int, silver: int, copper: int) -> int:
	printerr("IEconomyService.calculate_total_copper: 纯虚函数必须由子类实现")
	return 0

## 铜币总值 → 金/银/铜拆分（{gold, silver, copper}）
func split_copper(total: int) -> Dictionary:
	printerr("IEconomyService.split_copper: 纯虚函数必须由子类实现")
	return {}

## 货币索引 → 单位铜值（0=金 1=银 2=铜 3=魔单晶）
func get_currency_copper(index: int) -> int:
	printerr("IEconomyService.get_currency_copper: 纯虚函数必须由子类实现")
	return 1

## 交易合计（卖出按回购折扣）
func calculate_shop_total(base_price: int, qty: int, is_sell: bool) -> int:
	printerr("IEconomyService.calculate_shop_total: 纯虚函数必须由子类实现")
	return 0

## 兑换率（源/目标铜值比）
func calculate_exchange_rate(src_copper: int, tgt_copper: int) -> float:
	printerr("IEconomyService.calculate_exchange_rate: 纯虚函数必须由子类实现")
	return 0.0

## 兑换结果
func calculate_exchange_result(amount: int, rate: float) -> float:
	printerr("IEconomyService.calculate_exchange_result: 纯虚函数必须由子类实现")
	return 0.0

## 商品 7 日价格序列（确定性生成）
func generate_price_series(commodity_key: String) -> Array:
	printerr("IEconomyService.generate_price_series: 纯虚函数必须由子类实现")
	return []
