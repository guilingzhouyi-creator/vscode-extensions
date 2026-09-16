# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/pending_timeline_modifier_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 显式承载上一回合对下一回合时间轴的干预（事件密度/最小间距）， 包含来源、生命周期与单次消费标记——严禁通过隐式全局内存变量泄漏（Inv-TR-5）
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name PendingTimelineModifierDTO
extends RefCounted

var source_id: String = ""        # 来源（产生该修饰的回合 / 事件 / 效果 ID，留痕可溯）
var lifetime_rounds: int = 1      # 生命周期：可生效的回合数（每次消费递减，≤0 即标记消费）
var is_consumed: bool = false     # 单次消费标记：被回合排期消费后置 true，禁止重复生效
var event_count_delta: int = 0    # 对下一回合事件数量密度的影响（+ 增密 / - 疏化）
var min_spacing_delta: int = 0    # 对下一回合最小事件间距的影响（- 更密集，下限 500ms）

func to_internal_dict() -> Dictionary:
	return {
		"source_id": source_id,
		"lifetime_rounds": lifetime_rounds,
		"is_consumed": is_consumed,
		"event_count_delta": event_count_delta,
		"min_spacing_delta": min_spacing_delta,
	}
