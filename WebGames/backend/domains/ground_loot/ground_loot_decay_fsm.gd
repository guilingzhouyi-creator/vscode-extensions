# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/ground_loot/ground_loot_decay_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/ground_loot.json | 信号: EventBus 领域广播
# 职责说明: 随世界时钟推移推进保护倒计时与衰变存活计时，自动回收风化有机物。 纯静态工具类（无状态），由全局衰变时钟/回收调度方周期调用； 寿命阈值来自聚合体构造时配置（config/domains/ground_loot.json lifespan.*）。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name GroundLootDecayFSM
extends RefCounted

# ==============================================================================
# 一、核心推进算法
# ==============================================================================

## 地面掉落衰变推进：保护倒计时归零 + 存活寿命耗尽置衰变并释放引用（触发 GC）。
## 契约：drop 已衰变时直接返回（幂等）；保护倒计时钳制非负；寿命耗尽后置 is_decayed
##       并清空 item_entity 引用（RefCounted 引用归零触发 GC，不再被地面系统持有）。
static func tick_ground_loot(drop: GroundDroppedItemAggregate, delta_seconds: float) -> void:
	if drop.is_decayed:
		return

	# 推进保护倒计时（钳制到 0，不产生负值）
	if drop.protection_remain_seconds > 0.0:
		drop.protection_remain_seconds = maxf(0.0, drop.protection_remain_seconds - delta_seconds)

	# 推进存活寿命：耗尽即衰变并释放物品引用
	if drop.total_lifespan_seconds > 0.0:
		drop.elapsed_alive_seconds += delta_seconds
		if drop.elapsed_alive_seconds >= drop.total_lifespan_seconds:
			drop.is_decayed = true
			drop.item_entity = null # 释放引用触发 GC
