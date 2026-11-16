# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_economy_service.gd
# 架构定位: Domain Boundary Interface / Economy Service Contract
# 依赖与触发: 上游: 经济交易与商店视图, ServiceContainer | 下游: MockEconomyService
# 职责说明: 规范货币换算、交易合计、物价序列与汇率计算接口，隔离底层金融规则。
# 退出语义与设计依据: 表现层零金融汇率运算与领域边界解耦契约
# ==============================================================================

## IEconomyService：货币换算、商店结算与汇率计算服务抽象接口
class_name IEconomyService
extends RefCounted

## 获取经济规则（货币铜值 / 回购折扣），供视图只读展示
func get_rules() -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.get_rules: pure virtual method must be implemented by subclass")
	return {}

## 四元钱包 → 铜币总值（金/银/铜）
func calculate_total_copper(_gold: int, _silver: int, _copper: int) -> int:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.calculate_total_copper: pure virtual method must be implemented by subclass")
	return 0

## 铜币总值 → 金/银/铜拆分（{gold, silver, copper}）
func split_copper(_total_copper: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.split_copper: pure virtual method must be implemented by subclass")
	return {}

## 货币索引 → 单位铜值（0=金 1=银 2=铜 3=魔单晶）
func get_currency_copper(_currency_index: int) -> int:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.get_currency_copper: pure virtual method must be implemented by subclass")
	return 1

## 交易合计（卖出按回购折扣）
func calculate_shop_total(_base_price: int, _quantity: int, _is_sell: bool) -> int:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.calculate_shop_total: pure virtual method must be implemented by subclass")
	return 0

## 兑换率（源/目标铜值比）
func calculate_exchange_rate(_source_copper: int, _target_copper: int) -> float:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.calculate_exchange_rate: pure virtual method must be implemented by subclass")
	return 0.0

## 兑换结果
func calculate_exchange_result(_amount: int, _exchange_rate: float) -> float:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.calculate_exchange_result: pure virtual method must be implemented by subclass")
	return 0.0

## 商品 7 日价格序列（确定性生成）
func generate_price_series(_commodity_key: String) -> Array:
	EventBusCore.get_instance().emit_log("error", "IEconomyService.generate_price_series: pure virtual method must be implemented by subclass")
	return []

## 分发商店买卖、竞拍与兑换动作至后端经济域（默认兼容回执）
func dispatch_economy_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
