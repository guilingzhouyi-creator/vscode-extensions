# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_guild_service.gd
# 架构定位: Domain Boundary Adapter / Real Guild & Trade Service Bridge
# 依赖与触发: 上游: GuildSocialView, ServiceContainer, ServiceLocator | 下游: OrganizationGovernanceSolver, OrganizationAggregate
# 职责说明: 实现 IGuildService 接口，经由后端组织治理求解器判定 RBAC 权限并执行面对面交易状态跃迁。
# 退出语义与设计依据: 表现层零权限判定与领域状态机唯一真源契约
# ==============================================================================

## RealGuildService：直连组织 RBAC 求解器与面对面交易状态机的真实公会服务
class_name RealGuildService
extends "res://frontend/domain_boundary/interfaces/i_guild_service.gd"

func _map_role_token(role_label: String) -> OrganizationAggregate.GuildRole:
	var normalized_role: String = role_label.strip_edges().to_upper()
	if normalized_role in ["LEADER", "GUILD_MASTER", "MASTER"]:
		return OrganizationAggregate.GuildRole.GUILD_MASTER
	if normalized_role in ["OFFICER", "VICE_LEADER", "ELDER"]:
		return OrganizationAggregate.GuildRole.OFFICER
	if normalized_role in ["VETERAN", "ELITE"]:
		return OrganizationAggregate.GuildRole.VETERAN
	return OrganizationAggregate.GuildRole.NOVICE

## 生成标准化公会成员名册预览列表
func generate_roster(member_count: int) -> Array:
	var bounded_count: int = clampi(member_count, 0, 100)
	var roster: Array = []
	for member_index in range(bounded_count):
		var role_name: String = "MEMBER"
		if member_index == 0:
			role_name = "LEADER"
		elif member_index <= 2:
			role_name = "OFFICER"
		elif member_index <= 6:
			role_name = "VETERAN"
		roster.append({
			"account_id": "GUILD_MEMBER_%02d" % (member_index + 1),
			"name": "Member #%02d" % (member_index + 1),
			"role": role_name,
			"contribution": maxi(100, (bounded_count - member_index) * 350),
			"online": (member_index % 3) != 2,
		})
	return roster

## 调用后端 OrganizationGovernanceSolver 核验操作者是否具备成员管理权限
func can_manage(user_role: String) -> bool:
	var probe_org := OrganizationAggregate.new()
	probe_org.member_roster["PROBE_OPERATOR"] = {
		"role": _map_role_token(user_role),
	}
	return OrganizationGovernanceSolver.can_perform_action(probe_org, "PROBE_OPERATOR", "KICK_MEMBER")

## 执行面对面交易状态机跃迁（lock / confirm / cancel）
func trade_transition(trade_state: Dictionary, trade_action: String) -> Dictionary:
	var is_locked: bool = bool(trade_state.get("locked", false))
	var is_confirmed: bool = bool(trade_state.get("confirmed", false))
	var action_name: String = trade_action.strip_edges().to_lower()
	match action_name:
		"lock":
			return {"success": true, "locked": true, "confirmed": is_confirmed}
		"confirm":
			if not is_locked:
				return {"success": false, "locked": false, "confirmed": false, "error_code": "TRADE_NOT_LOCKED"}
			return {"success": true, "locked": true, "confirmed": true}
		"cancel":
			return {"success": true, "locked": false, "confirmed": false}
		_:
			return {"success": false, "locked": is_locked, "confirmed": is_confirmed, "error_code": "UNKNOWN_TRADE_ACTION"}

## 分发公会管理、好友互动、聊天与交易协议动作至后端域处理器
func dispatch_guild_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return RealProtocolBridge.dispatch_flat("guild", action_type, payload_data)
