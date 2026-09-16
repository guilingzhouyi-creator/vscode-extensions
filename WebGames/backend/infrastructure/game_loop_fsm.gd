# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Lifecycle FSM)
# 文件路径: res://backend/infrastructure/game_loop_fsm.gd
# 架构定位: Deterministic Game Loop FSM
# 跨域依赖: 上游: GameBootstrap, WorldGateway | 下游: EventBusCore | 配置: config/infrastructure/fsm.json | 信号: 主循环状态跃迁广播
# 职责说明: 顶层生命周期主循环状态机：冷启动 → 登录 → 创角 → 大地图 → 战斗 → 结算 状态栈保证栈顶单活、幂等切换与全局上下文不丢失；场景切入切出 DTO 契约 全部经枚举强类型，零硬编码字符串。
# 设计依据: Phase 26 全局游戏主循环状态机规范
# ==============================================================================

class_name GameLoopStateStack extends RefCounted

# ==============================================================================
# 一、状态枚举与状态
# ==============================================================================

enum EngineState {
	BOOT_INIT,          # 引擎冷启动与配置预热
	LOGIN_AUTH,         # 鉴权登录与会话初始化
	CHARACTER_SELECT,   # 创角与角色槽位选择
	WORLD_EXPLORATION,  # 大地图探索与城镇漫游（文字版首版）
	COMBAT_ENCOUNTER,   # 局部战术回合侵彻战斗
	SETTLEMENT_REWARD,  # 战后结算与任务交付
	PAUSED_MODAL        # 模态弹窗与暂停冻结
}

var state_stack: Array[EngineState] = []
var current_state: EngineState = EngineState.BOOT_INIT
var global_context: Dictionary = {}

# ==============================================================================
# 二、状态栈操作（压栈 / 弹栈 / 切换）
# ==============================================================================

## 构造：初始化状态栈（BOOT_INIT 单帧）与全局上下文
func _init() -> void:
	state_stack = [EngineState.BOOT_INIT]
	current_state = EngineState.BOOT_INIT
	global_context = {}

## 压栈：新状态入栈并合并上下文（幂等：重复压同状态仅刷新上下文，不追加重复栈帧）
func push_state(new_state: EngineState, context_payload: Dictionary = {}) -> void:
	# L7（Phase 56）：同状态带 context 的重复 push 不再追加栈帧（旧实现仅空 context 拦截，
	# 非空 context 会栈膨胀、需多次 pop 才回到本状态，与「幂等」注释相悖）
	if new_state == current_state:
		if not context_payload.is_empty():
			for k in context_payload:
				global_context[k] = context_payload[k]
		return
	state_stack.append(new_state)
	current_state = new_state
	if not context_payload.is_empty():
		for k in context_payload:
			global_context[k] = context_payload[k]
	EventBusCore.get_instance().emit_domain_event("engine.state_pushed", {"args": [new_state], "summary": {"state": new_state}})

## 弹栈：回到上一状态（栈深 1 时拒绝，保持单活）
func pop_state() -> EngineState:
	if state_stack.size() <= 1:
		return current_state
	state_stack.pop_back()
	current_state = state_stack.back()
	EventBusCore.get_instance().emit_domain_event("engine.state_popped", {"args": [current_state], "summary": {"state": current_state}})
	return current_state

## 切换：清空栈至目标状态（用于登录→选角等切段）
func switch_to(target: EngineState, context_payload: Dictionary = {}) -> void:
	state_stack = [target]
	current_state = target
	global_context = context_payload.duplicate() if not context_payload.is_empty() else {}
	EventBusCore.get_instance().emit_domain_event("engine.state_switched", {"args": [target], "summary": {"state": target}})

## 是否可弹栈（栈深 > 1 时保持栈顶单活）
func can_pop() -> bool:
	return state_stack.size() > 1

## 当前栈深
func stack_depth() -> int:
	return state_stack.size()

# ==============================================================================
# 三、序列化与反序列化（存档持久化）
# ==============================================================================

## 状态栈序列化（栈帧/当前状态/全局上下文）
func serialize() -> Dictionary:
	return {"stack": state_stack.duplicate(), "current": current_state, "context": global_context.duplicate()}

## 状态栈反序列化（帧范围校验 + 空栈兜底 BOOT_INIT）
func deserialize(data: Dictionary) -> void:
	var arr: Array = data.get("stack", [EngineState.BOOT_INIT])
	state_stack = []
	for v in arr:
		var s := int(v)
		if s >= EngineState.BOOT_INIT and s <= EngineState.PAUSED_MODAL:
			state_stack.append(s as EngineState)
	if state_stack.is_empty():
		state_stack.append(EngineState.BOOT_INIT)
	var cur := int(data.get("current", state_stack.back()))
	if cur >= EngineState.BOOT_INIT and cur <= EngineState.PAUSED_MODAL:
		current_state = cur as EngineState
	else:
		current_state = state_stack.back()
	global_context = Dictionary(data.get("context", {}))
