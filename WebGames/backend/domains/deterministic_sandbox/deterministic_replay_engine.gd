# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/deterministic_sandbox/deterministic_replay_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/deterministic.json | 信号: EventBus 领域广播
# 职责说明: 基于定点伪随机 LCG 驱动的确定性回放、状态指纹生成与系统能量守恒定律断言。 LCG 常数/伤害公式/指纹格式由 config/deterministic.json 驱动 （指纹格式变化会破坏跨版本回放可比性，改配置需谨慎）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name DeterministicReplayEngine extends RefCounted

# ==============================================================================
# 一、核心回放仿真（LCG 确定性生成 + 状态指纹）
# ==============================================================================

## 确定性轻量级沙盒回放执行器：输入预扫描 → 逐 tick LCG 伤害仿真 → 指纹哈希
## 契约：非法输入（tick 非递增非负 / action 未登记）整批拒绝 REPLAY_INPUT_INVALID，
##       不产生部分指纹；返回 { final_hp, final_ap, total_damage, final_hash, step_count }。
## 性能：单遍输入扫描 + 单遍回放循环，无嵌套瞬态分配。
static func simulate_replay(
	initial_hp: float,
	initial_ap: int,
	inputs: Array
) -> Dictionary:
	# 0. 输入预扫描（Phase 32 S2）：tick 严格递增非负、action 必须在 PhysicalVerbRegistry
	#    登记——非法整批拒绝（REPLAY_INPUT_INVALID），不产生部分指纹。
	for i in range(inputs.size()):
		var snapshot: Variant = inputs[i]
		var tick: int = int(snapshot.tick)
		if tick < 0:
			return { "success": false, "code": "REPLAY_INPUT_INVALID", "reason": "tick", "step_count": inputs.size() }
		if i > 0 and tick <= int(inputs[i - 1].tick):
			return { "success": false, "code": "REPLAY_INPUT_INVALID", "reason": "tick_not_monotonic", "step_count": inputs.size() }
		if not PhysicalVerbRegistry._verbs().has(snapshot.action_command):
			return { "success": false, "code": "REPLAY_INPUT_INVALID", "reason": "action_not_registered", "action_command": snapshot.action_command, "step_count": inputs.size() }

	var lcg_mult := GameConfig.get_int("domains.deterministic", "lcg/multiplier", 1103515245)
	var lcg_inc := GameConfig.get_int("domains.deterministic", "lcg/increment", 12345)
	var lcg_mask := GameConfig.get_int("domains.deterministic", "lcg/mask", 2147483647)
	# 钳制下界：modulus 为 0 会让下面的 % 与 / 直接崩溃，而它可被热重载改写
	var lcg_modulus := maxi(1, GameConfig.get_int("domains.deterministic", "lcg/modulus", 1000))
	var base_damage := GameConfig.get_float("domains.deterministic", "combat/base_damage", 25.0)
	var random_coefficient := GameConfig.get_float("domains.deterministic", "combat/random_coefficient", 0.2)
	var fp_format := GameConfig.get_string("domains.deterministic", "fingerprint/format", "T%d:HP%.1f:AP%d:D%.1f")
	var summary_sep := GameConfig.get_string("domains.deterministic", "fingerprint/summary_separator", ";")

	var hp = initial_hp
	var ap = initial_ap
	var total_damage_dealt: float = 0.0
	var state_fingerprints: Array[String] = []

	for snapshot in inputs:
		# 确定性伪随机发生器 (LCG)：线性同余式与掩码位与，跨平台位运算一致
		var lcg_val = (snapshot.rng_seed * lcg_mult + lcg_inc) & lcg_mask
		var roll = float(lcg_val % lcg_modulus) / float(lcg_modulus)

		var verb = PhysicalVerbRegistry.get_verb(snapshot.action_command)
		var base_ap = int(verb.get("base_ap", -2))
		ap += base_ap

		var dmg = base_damage * float(verb.get("k_mom", 1.0)) * (1.0 + random_coefficient * roll)
		total_damage_dealt += dmg
		hp = max(0.0, hp - dmg)

		var fp = fp_format % [snapshot.tick, hp, ap, dmg]
		state_fingerprints.append(fp)

	var summary_str = summary_sep.join(state_fingerprints)
	var final_hash = summary_str.sha256_text()

	return {
		"final_hp": hp,
		"final_ap": ap,
		"total_damage": total_damage_dealt,
		"final_hash": final_hash,
		"step_count": inputs.size()
	}

# ==============================================================================
# 二、能量与因果律守恒断言
# ==============================================================================

## 能量与因果律守恒断言器：输入总能量 ≈ 输出伤害 + 损耗（容差内成立）
## 契约：容差由 config/deterministic.json conservation/tolerance 驱动；返回 delta < tolerance。
static func verify_energy_conservation(total_input_energy: float, total_output_damage: float, loss_energy: float) -> bool:
	var tolerance := GameConfig.get_float("domains.deterministic", "conservation/tolerance", 0.001)
	var delta = abs(total_input_energy - (total_output_damage + loss_energy))
	return delta < tolerance
