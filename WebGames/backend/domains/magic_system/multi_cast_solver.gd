# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/multi_cast_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 魔法几重化求解器——一次行动卡打出 = 同一选定魔法同时发动 N 次攻击 （消耗恒 1 张行动卡），逐击经统一结算适配层走真实伤害管线。 Phase 42 收编：入参由历史自建行动卡定义改为**权威行动卡 CombatActionCardEntity**（verb_type/magic_ref/effects 驱动）。语义不变： 一次行动卡打出 = 同一选定魔法同时发动 N 次攻击（N ∈ 1..max_casts），无论发动 几次都只消耗 1 张行动卡（行动消耗次数 ≠ 实际魔法攻击次数）。 目标模式 / 快照策略 / 上限全部配置驱动（magic_rules.multi_cast），不硬编码。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MultiCastSolver
extends RefCounted

const CONSUMES_PLAY: int = 1  # 硬不变量：一次行动卡打出恒消耗 1 次行动（原行动卡别名已退役内联）

## 由权威行动卡读取几重化次数（effects 内 magic_cast 效果声明；默认 1）
static func _casts_of(card: PhysicalVerbRegistry.CombatActionCardEntity) -> int:
	var casts := 1
	for effect in card.effects:
		if effect is Dictionary and str(effect.get("kind", "")) == "magic_cast":
			casts = int(effect.get("casts_per_play", 1))
			break
	return maxi(1, casts)

## 校验一次打出的合法性（次数上限/魔法引用存在）
static func validate_play(
	card: PhysicalVerbRegistry.CombatActionCardEntity,
	mc_config: Dictionary = {}
) -> Dictionary:
	if card == null:
		return {"success": false, "error_code": "MISSING_CONTEXT"}
	var max_casts := int(mc_config.get("max_casts", 5))
	var casts := _casts_of(card)
	if casts < 1 or casts > max_casts:
		return {
			"success": false,
			"error_code": "MULTI_CAST_EXCEEDS_MAX",
			"requested": casts,
			"max_casts": max_casts,
		}
	return {"success": true, "consumes_play": CONSUMES_PLAY, "cast_count": casts}

## 执行一次打出：逐击经统一结算适配层（真实管线）返回 N 次攻击的结构化序列
static func execute_play(
	card: PhysicalVerbRegistry.CombatActionCardEntity,
	rank: int,
	ctx: Dictionary = {},
	mc_config: Dictionary = {}
) -> Dictionary:
	var check := validate_play(card, mc_config)
	if not check.get("success", false):
		return check
	var cast_count := int(check["cast_count"])
	var snapshot_mode := bool(mc_config.get("snapshot_per_play", false))
	var target_mode := String(mc_config.get("target_mode", "SAME"))
	var target_pool: Array = ctx.get("target_pool", [])
	var hit_results: Array = []
	var snapshot_ctx := ctx.duplicate()
	if snapshot_mode:
		snapshot_ctx["snapshot_locked"] = true
	# P7：SEQUENTIAL 需逐击不同 target 才复制 ctx；SAME/无池共享冻结 ctx 零拷贝
	# （MagicSettlementSolver.resolve_attack 仅只读 ctx，已核验无逐击就地写入）
	var sequential := target_mode == "SEQUENTIAL" and not target_pool.is_empty()
	for i in range(cast_count):
		var hit_ctx := snapshot_ctx
		if sequential:
			hit_ctx = snapshot_ctx.duplicate()
			hit_ctx["target_id"] = str(target_pool[i % target_pool.size()])
		elif target_mode == "SAME":
			if not hit_ctx.has("target_id"):
				hit_ctx["target_id"] = str(ctx.get("target_id", ""))
		var hit := MagicSettlementSolver.resolve_attack(card, rank, hit_ctx)
		if not hit.get("success", false):
			return hit
		hit_results.append(hit)
	return {
		"success": true,
		"consumes_play": CONSUMES_PLAY,
		"cast_count": cast_count,
		"attack_count": cast_count,
		"snapshot_mode": snapshot_mode,
		"hits": hit_results,
		"total_damage": _sum_damage(hit_results),
	}

static func _sum_damage(hits: Array) -> float:
	var total := 0.0
	for hit in hits:
		total += float(hit.get("damage", 0.0))
	return total
