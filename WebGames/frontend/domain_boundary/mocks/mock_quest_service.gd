# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_quest_service.gd
# 架构定位: Domain Boundary Mock / Simulated Quest Lifecycle Service
# 依赖与触发: 上游: MockServiceContainer, 任务因果视图 | 下游: 无（纯状态跃迁模拟）
# 职责说明: 提供任务三态状态机（AVAILABLE / ACTIVE / COMPLETED）与合法跃迁守卫模拟实现。
# 退出语义与设计依据: 表现层零任务状态机直改与合法迁移白名单契约
# ==============================================================================

## MockQuestService：任务状态流转与非法跃迁拦截模拟服务
class_name MockQuestService
extends IQuestService

const TRANSITIONS := {
	"accept": {"from": ["AVAILABLE"], "to": "ACTIVE"},
	"abandon": {"from": ["ACTIVE"], "to": "AVAILABLE"},
	"submit": {"from": ["ACTIVE"], "to": "COMPLETED"},
}

## 校验任务前置状态并执行 accept/abandon/submit 合法状态跃迁，返回更新后的任务副本
func transition_status(quest: Dictionary, action: String) -> Dictionary:
	if quest.is_empty():
		return {"success": false, "error_code": "EMPTY_QUEST"}
	if not TRANSITIONS.has(action):
		return {"success": false, "error_code": "INVALID_ACTION"}
	var rule: Dictionary = TRANSITIONS[action]
	var current := str(quest.get("status", ""))
	var allowed: Array = rule.get("from", [])
	if not (current in allowed):
		return {"success": false, "error_code": "INVALID_TRANSITION", "from": current, "action": action}
	var updated: Dictionary = quest.duplicate(true)
	updated["status"] = str(rule.get("to", current))
	return {"success": true, "quest": updated, "action": action}
