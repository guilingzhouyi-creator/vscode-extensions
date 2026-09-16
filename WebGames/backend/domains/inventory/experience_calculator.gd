# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/experience_calculator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 对数经历阶位 R 计算与神经记忆半衰期遗忘模型。 公式系数由 config/domains/inventory.json 的 formula 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ExperienceCalculator extends RefCounted

# ==============================================================================
# 一、多维经历阶位计算
# ==============================================================================

## 计算多维经历综合位格阶位 R
## R = floor(alpha * ln(1 + Rep) + beta * (Age/MaxLife)^gamma * Expl + delta * sum(Mastery))
static func evaluate_experience_rank(
	reputation: float,
	normalized_age: float,
	exploration_index: float,
	skill_mastery_sum: float
) -> int:
	var alpha := GameConfig.get_float("domains.inventory", "formula/alpha_rep", 2.5)
	var beta := GameConfig.get_float("domains.inventory", "formula/beta_growth", 1.8)
	var gamma := GameConfig.get_float("domains.inventory", "formula/gamma_age", 1.2)
	var delta := GameConfig.get_float("domains.inventory", "formula/delta_mastery", 0.05)
	var age_normalize := GameConfig.get_float("domains.inventory", "formula/age_normalize", 100.0)

	var safe_rep = max(0.0, reputation)
	var rep_term = alpha * log(1.0 + safe_rep)
	var age_ratio = clamp(normalized_age / age_normalize, 0.0, 1.0)
	var growth_term = beta * pow(age_ratio, gamma) * max(0.0, exploration_index)
	var mastery_term = delta * max(0.0, skill_mastery_sum)
	return int(floor(rep_term + growth_term + mastery_term))

# ==============================================================================
# 二、记忆半衰期遗忘模型
# ==============================================================================

## 神经记忆与动作熟练度半衰期遗忘模型
## lambda_decay = forget_base / max(1.0, INT * int_coefficient)
## M(t) = M0 * exp(-lambda_decay * elapsed_days)
static func calculate_memory_decay(initial_mastery: float, elapsed_days: float, int_stat: float) -> float:
	var forget_base := GameConfig.get_float("domains.inventory", "formula/forget_base_rate", 0.05)
	var int_coef := GameConfig.get_float("domains.inventory", "formula/int_coefficient", 0.1)

	var safe_int = max(1.0, int_stat * int_coef)
	var lambda_decay = forget_base / safe_int
	var safe_days = max(0.0, elapsed_days)
	return max(0.0, initial_mastery * exp(-lambda_decay * safe_days))
