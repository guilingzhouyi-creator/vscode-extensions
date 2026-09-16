# ==============================================================================
# 单元测试：游戏主循环与状态栈 (GameLoopStateStack Tests)
# 文件路径: res://tests/integration/pipelines/test_game_loop_fsm_pipeline.gd
# ==============================================================================
class_name TestGameLoopFSMPipeline extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_push_pop_single_active())
	results.append(test_switch_to_clears_stack())
	results.append(test_pop_guard_at_depth_one())
	results.append(test_context_merge_and_serialize())
	# Phase 56 L7 新增：同状态幂等压栈
	results.append(test_same_state_push_idempotent())
	var all_passed: bool = true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return {"domain": "Phase 05 S1: 游戏主循环状态栈", "all_passed": all_passed, "results": results}

static func test_push_pop_single_active() -> Dictionary:
	var stack := GameLoopStateStack.new()
	stack.push_state(GameLoopStateStack.EngineState.LOGIN_AUTH)
	stack.push_state(GameLoopStateStack.EngineState.WORLD_EXPLORATION)
	var passed: bool = stack.current_state == GameLoopStateStack.EngineState.WORLD_EXPLORATION and stack.stack_depth() == 3
	stack.pop_state()
	passed = passed and stack.current_state == GameLoopStateStack.EngineState.LOGIN_AUTH
	return {"test": "TC-P05-S1-01: 压栈/弹栈单活与深度", "passed": passed}

static func test_switch_to_clears_stack() -> Dictionary:
	var stack := GameLoopStateStack.new()
	stack.push_state(GameLoopStateStack.EngineState.WORLD_EXPLORATION, {"map": "town"})
	stack.switch_to(GameLoopStateStack.EngineState.COMBAT_ENCOUNTER, {"enemy": "orc"})
	var passed: bool = stack.stack_depth() == 1 and stack.current_state == GameLoopStateStack.EngineState.COMBAT_ENCOUNTER and stack.global_context.get("enemy") == "orc"
	return {"test": "TC-P05-S1-02: switch_to 清栈与上下文", "passed": passed}

static func test_pop_guard_at_depth_one() -> Dictionary:
	var stack := GameLoopStateStack.new()
	var before: int = stack.stack_depth()
	var after: int = stack.pop_state()
	var passed: bool = before == 1 and stack.stack_depth() == 1 and after == GameLoopStateStack.EngineState.BOOT_INIT
	return {"test": "TC-P05-S1-03: 栈深1时 pop 拒绝", "passed": passed}

static func test_context_merge_and_serialize() -> Dictionary:
	var stack := GameLoopStateStack.new()
	stack.push_state(GameLoopStateStack.EngineState.CHARACTER_SELECT, {"slot": 1})
	var data: Dictionary = stack.serialize()
	var restored := GameLoopStateStack.new()
	restored.deserialize(data)
	var passed: bool = restored.current_state == stack.current_state and restored.global_context.get("slot") == 1
	return {"test": "TC-P05-S1-04: 上下文合并与序列化", "passed": passed}

static func test_same_state_push_idempotent() -> Dictionary:
	# L7（Phase 56）：同状态带 context 重复 push 只刷新上下文、不追加重复栈帧（红证：修复前栈膨胀需多次 pop）
	var stack := GameLoopStateStack.new()
	stack.push_state(GameLoopStateStack.EngineState.LOGIN_AUTH)
	stack.push_state(GameLoopStateStack.EngineState.CHARACTER_SELECT)
	var depth_before := stack.stack_depth()
	stack.push_state(GameLoopStateStack.EngineState.CHARACTER_SELECT, {"slot": 1})
	stack.push_state(GameLoopStateStack.EngineState.CHARACTER_SELECT, {"slot": 2})
	var same_ok = stack.stack_depth() == depth_before and stack.global_context.get("slot") == 2
	# 不同状态仍正常压栈
	stack.push_state(GameLoopStateStack.EngineState.WORLD_EXPLORATION)
	var grow_ok = stack.stack_depth() == depth_before + 1
	var passed = same_ok and grow_ok and stack.current_state == GameLoopStateStack.EngineState.WORLD_EXPLORATION
	return {"test": "TC-P05-S1-05: 同状态幂等压栈（L7：不追加重复栈帧、仅刷新上下文）", "passed": passed}
