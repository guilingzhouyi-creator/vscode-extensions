# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/ascension_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 魔法升格化——消耗指定条件后使目标魔法的现有位阶提升一阶。位阶为独立 数据维度（复用 MagicTierRegistry 阶位梯度 1~11），升格后按新位阶计算 后续效果，**不把升格后的每一级制作为独立技能/新卡**。 最大位阶 / 条件 / 连续升格 / 永久性 / 最高位阶处理由 magic_rules.json 的 ascension 段驱动；与高阶级位形态不变量（god-form 须 SUPERTIER） 冲突时受控拒绝。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name AscensionSolver
extends RefCounted

## 校验升格条件：ranks 为魔法位阶登记表（magic_ref -> int），由调用方持有。
## ctx 供 MagicRuleCondition 求值（holder_rank / learned_by_school / variant_flags）。
static func validate_ascension(
	ranks: Dictionary,
	magic_ref: String,
	asc_config: Dictionary = {},
	ctx: Dictionary = {}
) -> Dictionary:
	if magic_ref.is_empty():
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	if not ranks.has(magic_ref):
		return {"success": false, "error_code": "MAGIC_NOT_REGISTERED", "magic_ref": magic_ref}
	var max_rank := clampi(int(asc_config.get("max_rank", 11)), 1, 11)
	var cur_rank := int(ranks[magic_ref])
	if cur_rank >= max_rank:
		return {"success": false, "error_code": "RANK_ALREADY_MAX", "rank": cur_rank, "max_rank": max_rank}
	var conditions: Dictionary = asc_config.get("conditions", {})
	if not conditions.is_empty() and not MagicRuleCondition.evaluate(conditions, ctx):
		return {"success": false, "error_code": "ASCENSION_CONDITION_FAILED", "magic_ref": magic_ref}
	return {"success": true, "magic_ref": magic_ref, "current_rank": cur_rank, "next_rank": cur_rank + 1}

## 执行升格：位阶 +1（仅一步；连续升格由调用方按 max_steps_per_play 循环调用，
## 每步仍独立校验）。form 用于 god-form 高阶形态不变量（RANK_10/11 须 SUPERTIER）。
static func apply_ascension(
	ranks: Dictionary,
	magic_ref: String,
	form: int = MagicTierSnapshot.MagicForm.INCANTATION,
	asc_config: Dictionary = {},
	ctx: Dictionary = {}
) -> Dictionary:
	var check := validate_ascension(ranks, magic_ref, asc_config, ctx)
	if not check.get("success", false):
		return check
	var next_rank := int(check["next_rank"])
	# 从属不变量：高阶位阶（RANK_10/11）必须配对超位形态（SUPERTIER）
	if MagicTierSnapshot.is_god_rank(next_rank) \
			and not MagicTierSnapshot.is_god_form_pair_valid(next_rank, form):
		return {"success": false, "error_code": "GOD_FORM_PAIR_VIOLATION", "rank": next_rank, "form": form}
	ranks[magic_ref] = next_rank
	return {
		"success": true,
		"magic_ref": magic_ref,
		"previous_rank": int(check["current_rank"]),
		"rank": next_rank,
	}
