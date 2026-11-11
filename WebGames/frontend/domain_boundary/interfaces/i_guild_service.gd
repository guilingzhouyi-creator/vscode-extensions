# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 公会社交服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_guild_service.gd
# 职责: 规范公会成员名单生成、管理权限判定与交易状态机接口
# ==============================================================================
class_name IGuildService
extends RefCounted

## 生成公会成员名单（等级/贡献/角色/在线态按规则生成）
func generate_roster(count: int) -> Array:
	EventBusCore.get_instance().emit_log("error", "IGuildService.generate_roster: pure virtual method must be implemented by subclass")
	return []

## 成员管理权限判定（管理角色白名单由服务层配置驱动）
func can_manage(user_role: String) -> bool:
	EventBusCore.get_instance().emit_log("error", "IGuildService.can_manage: pure virtual method must be implemented by subclass")
	return false

## 交易状态机跃迁（action: lock / confirm / cancel）→ {success, locked, confirmed}
func trade_transition(state: Dictionary, action: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGuildService.trade_transition: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
