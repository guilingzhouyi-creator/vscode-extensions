# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 任务因果服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_quest_service.gd
# 职责: 规范任务状态跃迁接口，隔离底层状态机守卫
# ==============================================================================
class_name IQuestService
extends RefCounted

## 任务状态跃迁（action: accept / abandon / submit）→ {success, quest, error_code}
func transition_status(quest: Dictionary, action: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IQuestService.transition_status: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
