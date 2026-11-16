# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_combat_service.gd
# 架构定位: Domain Boundary Adapter / Combat Encounter Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游: RealProtocolBridge, UnifiedProtocolDispatcher
# 职责说明: 实现 ICombatService 接口，通过统一协议驱动战斗快照拉取、技能消耗与世界首领转相结算。
# 退出语义与设计依据: 表现层零战斗数值计算与领域边界解耦契约
# ==============================================================================

## RealCombatService：经统一协议直连后端战斗域与活跃会话状态的真实战斗服务实现
class_name RealCombatService
extends "res://frontend/domain_boundary/interfaces/i_combat_service.gd"

## 获取当前战斗快照（首领多阶段血量、护盾与活跃玩家实时状态）
func get_combat_snapshot_async(battle_id: String, result_callback: Callable) -> void:
	var outcome := RealProtocolBridge.dispatch_flat("combat", "GET_COMBAT_SNAPSHOT", {"battle_id": battle_id})
	if result_callback.is_valid():
		result_callback.call(outcome)

## 执行技能打击结算，同步玩家 AP/MP 消耗与首领转相结果
func cast_skill_async(skill_id: String, target_id: String, result_callback: Callable, skill_parameters: Dictionary = {}) -> void:
	var request_payload := {"skill_id": skill_id, "target_id": target_id}
	if not skill_parameters.is_empty():
		request_payload.merge(skill_parameters, true)
	var outcome := RealProtocolBridge.dispatch_flat("combat", "CAST_SKILL", request_payload)
	if result_callback.is_valid():
		result_callback.call(outcome)
