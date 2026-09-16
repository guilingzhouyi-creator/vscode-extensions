# ==============================================================================
# 单元测试：领域 5 确定性沙盒回放与因果守恒 (Deterministic Sandbox Tests)
# 文件路径: res://tests/unit/domains/test_deterministic_sandbox.gd
# ==============================================================================
class_name TestDeterministicDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_input_snapshot())
	results.append(test_deterministic_replay_hash_invariant())
	results.append(test_energy_conservation_assertion())
	results.append(test_authority_audit_defense())
	# Phase 54 M2 新增：RNG 高位派生原语
	results.append(test_rng_coin_no_alternation())
	results.append(test_rng_pick_no_short_cycle())
	results.append(test_rng_primitives_boundaries())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 05: 单机确定性回放校验器", "all_passed": all_passed, "results": results }

static func test_input_snapshot() -> Dictionary:
	var snap := DeterministicInputSnapshot.new()
	snap.tick = 42
	snap.action_command = "STAB"
	var s = snap.serialize()
	var passed = (s.tick == 42) and (s.action_command == "STAB")
	return { "test": "TC-DET-01: 确定性输入快照构造", "passed": passed }

static func test_deterministic_replay_hash_invariant() -> Dictionary:
	var snaps: Array = []
	for i in range(5):
		var sp := DeterministicInputSnapshot.new()
		sp.tick = i
		sp.action_command = "SLASH" if i % 2 == 0 else "STAB"
		sp.rng_seed = 1000 + i
		snaps.append(sp)

	var run1 = DeterministicReplayEngine.simulate_replay(200.0, 5, snaps)
	var run2 = DeterministicReplayEngine.simulate_replay(200.0, 5, snaps)
	var passed = (run1.final_hash == run2.final_hash) and (run1.final_hp == run2.final_hp)
	return { "test": "TC-DET-02: 确定性沙盒回放 100% 相同哈希契约", "passed": passed, "hash": run1.final_hash }

static func test_energy_conservation_assertion() -> Dictionary:
	var ok = DeterministicReplayEngine.verify_energy_conservation(100.0, 70.0, 30.0)
	var bad = DeterministicReplayEngine.verify_energy_conservation(100.0, 70.0, 50.0)
	var passed = ok and not bad
	return { "test": "TC-DET-03: 系统能量守恒定律严格断言", "passed": passed }

static func test_authority_audit_defense() -> Dictionary:
	var fsm := AuthorityTriStateMachine.new()
	var normal = fsm.audit_input_continuity(10, 12, -2, 0)
	var desync = fsm.audit_input_continuity(10, 30, -2, 0)
	var cheat = fsm.audit_input_continuity(10, 10, -5, -8) # current_ap + cost = -13 < -10
	var passed = normal.valid and not desync.valid and not cheat.valid
	return { "test": "TC-DET-04: 时序攻击与透支作弊防御断言", "passed": passed }

static func test_rng_coin_no_alternation() -> Dictionary:
	# M2（Phase 54）：高位派生后 randi_range(0,1) 不再奇偶严格交替（红证：旧低比特取模输出 0,1,0,1 可预测）
	var rng := DeterministicRNG.from_seed(20240917)
	var seq: Array = []
	for i in range(32):
		seq.append(rng.randi_range(0, 1))
	var has_adjacent_same := false
	for i in range(1, seq.size()):
		if seq[i] == seq[i - 1]:
			has_adjacent_same = true
			break
	var has_zero := seq.has(0)
	var has_one := seq.has(1)
	var passed = has_adjacent_same and has_zero and has_one
	return { "test": "TC-DET-05: 掷硬币无奇偶交替（M2 高位派生）", "passed": passed }

static func test_rng_pick_no_short_cycle() -> Dictionary:
	# M2：pick 偶数池下标不再固定短周期（红证：size=4 时下标 2,3,0,1 循环）
	var rng := DeterministicRNG.from_seed(777)
	var pool := ["A", "B", "C", "D"]
	var idxs: Array = []
	for i in range(32):
		idxs.append(pool.find(rng.pick(pool)))
	var has_all := idxs.has(0) and idxs.has(1) and idxs.has(2) and idxs.has(3)
	var cycle4 := true # 若存在严格 4 周期则视为回归
	for i in range(4, idxs.size()):
		if idxs[i] != idxs[i - 4]:
			cycle4 = false
			break
	var passed = has_all and not cycle4
	return { "test": "TC-DET-06: pick 偶数池无短周期（M2）", "passed": passed }

static func test_rng_primitives_boundaries() -> Dictionary:
	# 边界守卫回归：hi==lo / hi<lo / 空池 / 单元素 / 同种子可复现
	var rng := DeterministicRNG.from_seed(123)
	var eq = rng.randi_range(5, 5) == 5
	var inv = rng.randi_range(8, 3) == 8 # hi<lo → 守卫返 lo
	var empty = rng.pick([]) == null
	var single: Variant = rng.pick(["ONLY"]) # 显式 Variant：pick 返回 Variant，禁 := 推断（警告即错误）
	var same_seed_ok := true
	var a := DeterministicRNG.from_seed(2024)
	var b := DeterministicRNG.from_seed(2024)
	for i in range(20):
		if a.randf() != b.randf():
			same_seed_ok = false
			break
	var passed = eq and inv and empty and single == "ONLY" and same_seed_ok
	return { "test": "TC-DET-07: RNG 原语边界守卫与同种子可复现（M2 回归）", "passed": passed }
