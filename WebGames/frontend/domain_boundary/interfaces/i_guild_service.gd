# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_guild_service.gd
# 架构定位: Domain Boundary Interface / Guild & Trade Service Contract
# 依赖与触发: 上游: 公会社交与交易视图, ServiceContainer | 下游: MockGuildService
# 职责说明: 规范公会成员名单生成、管理权限判定与面对面交易状态机跃迁接口。
# 退出语义与设计依据: 表现层零权限判定与交易状态机领域边界解耦契约
# ==============================================================================

## IGuildService：公会名册、权限判定与交易状态流转服务抽象接口
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
