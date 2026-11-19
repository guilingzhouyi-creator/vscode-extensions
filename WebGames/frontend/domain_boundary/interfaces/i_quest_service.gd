# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_quest_service.gd
# 架构定位: Domain Boundary Interface / Quest Lifecycle Service Contract
# 依赖与触发: 上游: 任务日志与因果面板视图, ServiceContainer | 下游: MockQuestService
# 职责说明: 规范任务接取、放弃与提交状态跃迁接口，隔离底层任务因果状态机守卫。
# 退出语义与设计依据: 表现层零任务状态机直改与领域边界解耦契约
# ==============================================================================

## IQuestService：任务状态流转边界服务抽象接口
class_name IQuestService
extends RefCounted

## 任务状态跃迁（action: accept / abandon / submit）→ {success, quest, error_code}
func transition_status(_quest: Dictionary, _action: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IQuestService.transition_status: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 接取悬赏目标
func accept_bounty(_bounty_id: String, _reward_gold: int = 0) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IQuestService.accept_bounty: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
