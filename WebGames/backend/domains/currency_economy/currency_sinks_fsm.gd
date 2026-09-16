# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/currency_economy/currency_sinks_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/currency.json | 信号: EventBus 领域广播
# 职责说明: 刚性回收深渊水池消费、货币阶梯扣除与平抑全域通货膨胀。 汇率与叙事文案由 config/currency.json、config/narratives/currency.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CurrencySinksAndFaucetsFSM extends RefCounted

## 刚性水池消费：阶梯扣除已下沉钱包账本，本层扣减成功即广播经济叙事
static func apply_rigid_sink_transaction(
	wallet: CharacterWalletEntity,
	sink_cost_copper: int,
	sink_category: String # GEAR_REFORGE / PORTAL_TELEPORT / LONGEVITY_ELIXIR
) -> bool:
	# 阶梯扣除（铜→银→金→白金、拆零找零）已下沉为钱包账本 API，本状态机只保留
	# 「刚性水池消费」的领域语义：扣减成功后广播经济类叙事。
	if not wallet.try_spend(sink_cost_copper):
		return false

	EventBusCore.get_instance().emit_narrative_by_key(
		"currency/sink_transaction", "economy", [sink_cost_copper, sink_category]
	)
	return true
