# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_quest_service.gd
# 架构定位: Domain Boundary Adapter / Real Quest Lifecycle Service Bridge
# 依赖与触发: 上游: QuestCausalityView, ServiceContainer, ServiceLocator | 下游: RealProtocolBridge, GameConfig
# 职责说明: 实现 IQuestService 接口，使用确定性状态转移表校验任务接取、放弃与提交动作，并同步后端协议态。
# 退出语义与设计依据: 表现层零任务状态机硬编码改写契约
# ==============================================================================

## RealQuestService：基于状态转移表与后端协议执行任务接取、放弃、悬赏与提交的真实任务服务
class_name RealQuestService
extends "res://frontend/domain_boundary/interfaces/i_quest_service.gd"

const QUEST_TRANSITIONS: Dictionary = {
	"AVAILABLE": {"accept": "ACTIVE"},
	"ACTIVE": {"abandon": "AVAILABLE", "submit": "COMPLETED"},
	"IN_PROGRESS": {"abandon": "AVAILABLE", "submit": "COMPLETED"},
}

## 校验并执行任务状态跃迁，非法跃迁返回明确错误码并保持原状态不变
func transition_status(quest: Dictionary, action: String) -> Dictionary:
	var quest_copy: Dictionary = quest.duplicate(true)
	var current_status: String = str(quest_copy.get("status", "")).strip_edges().to_upper()
	var requested_action: String = action.strip_edges().to_lower()
	if not QUEST_TRANSITIONS.has(current_status):
		return {"success": false, "quest": quest_copy, "error_code": "INVALID_QUEST_STATUS"}
	var allowed_actions: Dictionary = QUEST_TRANSITIONS[current_status] as Dictionary
	if not allowed_actions.has(requested_action):
		return {"success": false, "quest": quest_copy, "error_code": "TRANSITION_NOT_PERMITTED"}
	var next_status := str(allowed_actions[requested_action])
	quest_copy["status"] = next_status
	RealProtocolBridge.dispatch_flat("quest", "TRANSITION_QUEST", {
		"quest_id": str(quest_copy.get("quest_id", quest_copy.get("id", ""))),
		"next_status": next_status,
	})
	return {"success": true, "quest": quest_copy, "error_code": ""}

## 接取动态悬赏目标并持久化至后端任务记录
func accept_bounty(bounty_id: String, reward_gold: int = 0) -> Dictionary:
	return RealProtocolBridge.dispatch_flat("quest", "ACCEPT_BOUNTY", {
		"bounty_id": bounty_id,
		"next_status": "ACTIVE",
		"reward_gold": reward_gold,
	})
