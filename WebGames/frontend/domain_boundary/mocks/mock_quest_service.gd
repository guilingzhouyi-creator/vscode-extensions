# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟任务因果服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_quest_service.gd
# 职责: 任务三态状态机（AVAILABLE / ACTIVE / COMPLETED）与合法跃迁守卫
# ==============================================================================
class_name MockQuestService
extends IQuestService

const TRANSITIONS := {
	"accept": {"from": ["AVAILABLE"], "to": "ACTIVE"},
	"abandon": {"from": ["ACTIVE"], "to": "AVAILABLE"},
	"submit": {"from": ["ACTIVE"], "to": "COMPLETED"},
}

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
