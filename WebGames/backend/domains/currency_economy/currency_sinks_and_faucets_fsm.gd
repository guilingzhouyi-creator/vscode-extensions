# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/currency_economy/currency_sinks_and_faucets_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/currency.json | 信号: EventBus 领域广播
# 职责说明: 刚性回收深渊水池消费、货币阶梯扣除与平抑全域通货膨胀。 汇率与叙事文案由 config/currency.json、config/narratives/currency.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
## CurrencySinksAndFaucetsFSM：Domain FSM / Lifecycle Session Engine
class_name CurrencySinksAndFaucetsFSM
extends RefCounted

## 刚性水池消费：阶梯扣除已下沉钱包账本，本层扣减成功即广播经济叙事
static func apply_rigid_sink_transaction(
	wallet: CharacterWalletEntity,
	sink_cost_copper: int,
	sink_category: String # GEAR_REFORGE / PORTAL_TELEPORT / LONGEVITY_ELIXIR
) -> bool:
	if not wallet.try_spend(sink_cost_copper):
		return false
	EventBusCore.get_instance().emit_narrative_by_key(
		"currency/sink_transaction",
		"economy",
		[sink_cost_copper, sink_category]
	)
	return true
