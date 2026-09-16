# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/identity_disguise/identity_deception_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/identity_disguise.json | 信号: EventBus 领域广播
# 职责说明: 易容伪装精密度 vs 观察者洞察检定 (INT vs AGI) 判定看穿概率
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name IdentityDeceptionSolver
extends RefCounted

## 看穿检定：洞察力（INT×权重+感知加成）vs 伪装力（精密度×权重+AGI×权重）超阈值即识破
static func evaluate_insight_check(
	observer_int: float,
	observer_perception_bonus: float,
	disguise_quality: float,
	actor_agi: float
) -> bool:
	var int_w := GameConfig.get_float("domains.identity_disguise", "insight_formula/int_weight", 1.5)
	var perc_w := GameConfig.get_float("domains.identity_disguise", "insight_formula/perception_bonus_weight", 1.0)
	var qual_w := GameConfig.get_float("domains.identity_disguise", "insight_formula/deception_quality_weight", 1.0)
	var agi_w := GameConfig.get_float("domains.identity_disguise", "insight_formula/agi_weight", 0.5)
	var threshold := GameConfig.get_float("domains.identity_disguise", "insight_formula/reveal_threshold", 15.0)
	var insight_power = observer_int * int_w + observer_perception_bonus * perc_w
	var deception_power = disguise_quality * qual_w + actor_agi * agi_w
	return insight_power > (deception_power + threshold)
