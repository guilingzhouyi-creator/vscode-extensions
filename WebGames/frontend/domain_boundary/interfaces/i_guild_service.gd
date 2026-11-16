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
func generate_roster(_member_count: int) -> Array:
	EventBusCore.get_instance().emit_log("error", "IGuildService.generate_roster: pure virtual method must be implemented by subclass")
	return []

## 成员管理权限判定（管理角色白名单由服务层配置驱动）
func can_manage(_user_role: String) -> bool:
	EventBusCore.get_instance().emit_log("error", "IGuildService.can_manage: pure virtual method must be implemented by subclass")
	return false

## 交易状态机跃迁（trade_action: lock / confirm / cancel）→ {success, locked, confirmed}
func trade_transition(_trade_state: Dictionary, _trade_action: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGuildService.trade_transition: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 分发公会管理、好友、聊天与交易协议动作（默认兼容回执）
func dispatch_guild_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
