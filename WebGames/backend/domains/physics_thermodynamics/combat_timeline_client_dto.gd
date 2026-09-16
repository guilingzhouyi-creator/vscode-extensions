# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_timeline_client_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 专门面向表现层/客户端暴露的只读安全视图，消除未决事件绝对时间戳与倒计时泄漏
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatTimelineClientDTO
extends RefCounted

## 专门面向表现层/前端暴露的只读安全视图，100% 消除未决事件精确倒计时与未来卡牌窥探
class PresenterSnapshotDTO extends RefCounted:
	var round_number: int = 1
	var progress_ratio: float = 0.0            # 时间轴推进比例 [0.0, 1.0]，供进度条渲染
	var is_round_concluded: bool = false
	var conclude_reason: String = ""           # 回合结算原因（超时/紧张点打断/AP与手牌耗尽）
	var current_hand_count: int = 0
	var resolved_events: Array[Dictionary] = [] # 仅包含已发生的事件通知 (如 {"kind": "NORMAL_DRAW", "drawn": 1})
	var is_zero_hand_active: bool = false      # 当前是否因特殊状态处于无牌可打姿态

	func to_client_view() -> Dictionary:
		return {
			"round_number": round_number,
			"progress_ratio": progress_ratio,
			"is_round_concluded": is_round_concluded,
			"conclude_reason": conclude_reason,
			"current_hand_count": current_hand_count,
			"resolved_events": resolved_events.duplicate(),
			"is_zero_hand_active": is_zero_hand_active,
		}
