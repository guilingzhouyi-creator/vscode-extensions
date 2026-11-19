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
func transition_status(quest: Dictionary, quest_action: String) -> Dictionary:
	if quest.is_empty():
		return {"success": false, "error_code": "EMPTY_QUEST"}
	if not TRANSITIONS.has(quest_action):
		return {"success": false, "error_code": "INVALID_ACTION"}
	var transition_rule: Dictionary = TRANSITIONS[quest_action]
	var current_status := str(quest.get("status", ""))
	var allowed_statuses: Array = transition_rule.get("from", [])
	if not (current_status in allowed_statuses):
		return {"success": false, "error_code": "INVALID_TRANSITION", "from": current_status, "action": quest_action}
	var updated_quest: Dictionary = quest.duplicate(true)
	updated_quest["status"] = str(transition_rule.get("to", current_status))
	return {"success": true, "quest": updated_quest, "action": quest_action}

## 模拟接取悬赏目标
func accept_bounty(bounty_id: String, _reward_gold: int = 0) -> Dictionary:
	return {"success": true, "quest_id": bounty_id, "status": "ACTIVE"}
