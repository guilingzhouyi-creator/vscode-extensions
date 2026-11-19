# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_guild_service.gd
# 架构定位: Domain Boundary Mock / Simulated Guild & Trade Service
# 依赖与触发: 上游: MockServiceContainer, 公会社交视图 | 下游: GameConfig
# 职责说明: 提供模拟公会社交服务，负责成员名单生成、权限白名单判定与交易状态机跃迁。
# 退出语义与设计依据: 配置驱动权限白名单与交易状态跃迁守卫契约
# ==============================================================================

## MockGuildService：公会名册、权限判定与交易状态流转模拟服务
class_name MockGuildService
extends IGuildService

const RULES_SECTION := "frontend.views"
const RULES_KEY := "fe09_guild_social"

const MEMBER_NAME_KEYS := [
	"ui.fe09.mock.member.altria", "ui.fe09.mock.member.meryl", "ui.fe09.mock.member.grain",
	"ui.fe09.mock.member.silvia", "ui.fe09.mock.member.darius", "ui.fe09.mock.member.eleanor",
	"ui.fe09.mock.member.kyle", "ui.fe09.mock.member.lillian", "ui.fe09.mock.member.augustus",
	"ui.fe09.mock.member.celina", "ui.fe09.mock.member.beowulf", "ui.fe09.mock.member.isabella",
	"ui.fe09.mock.member.roland", "ui.fe09.mock.member.vera", "ui.fe09.mock.member.finn",
]
const CLASS_KEYS := [
	"ui.fe09.mock.class.swordmaster", "ui.fe09.mock.class.archmage", "ui.fe09.mock.class.paladin",
	"ui.fe09.mock.class.ranger", "ui.fe09.mock.class.shadow_assassin", "ui.fe09.mock.class.priest",
	"ui.fe09.mock.class.berserker", "ui.fe09.mock.class.summoner", "ui.fe09.mock.class.monk",
	"ui.fe09.mock.class.bard",
]
const ROLE_KEYS := [
	"ui.fe09.mock.role.leader", "ui.fe09.mock.role.vice_leader", "ui.fe09.mock.role.officer",
	"ui.fe09.mock.role.elite", "ui.fe09.mock.role.member", "ui.fe09.mock.role.member",
	"ui.fe09.mock.role.member", "ui.fe09.mock.role.member", "ui.fe09.mock.role.member",
	"ui.fe09.mock.role.member", "ui.fe09.mock.role.member", "ui.fe09.mock.role.member",
	"ui.fe09.mock.role.member", "ui.fe09.mock.role.member", "ui.fe09.mock.role.member",
]

## 确定性生成指定数量的模拟公会成员名单列表
func generate_roster(member_count: int) -> Array:
	var members: Array = []
	for member_index in range(maxi(0, member_count)):
		members.append({
			"name": MEMBER_NAME_KEYS[member_index % MEMBER_NAME_KEYS.size()],
			"class": CLASS_KEYS[member_index % CLASS_KEYS.size()],
			"level": 20 + (member_index * 3) % 30,
			"role": ROLE_KEYS[member_index % ROLE_KEYS.size()],
			"online": member_index % 3 != 2,
			"contribution": 500 + member_index * 320,
		})
	return members

## 读取 GameConfig 管理角色白名单，判定目标职位是否拥有管理权限
func can_manage(user_role: String) -> bool:
	var allowed_roles: Array = GameConfig.get_array(RULES_SECTION, RULES_KEY + "/manage_roles", ["LEADER", "OFFICER"])
	return user_role in allowed_roles

## 推进面对面交易锁定、确认或取消状态机，阻断非法越序操作
func trade_transition(trade_state: Dictionary, trade_action: String) -> Dictionary:
	var is_locked := bool(trade_state.get("locked", false))
	var is_confirmed := bool(trade_state.get("confirmed", false))
	match trade_action:
		"lock":
			if is_confirmed:
				return {"success": false, "error_code": "TRADE_CONFIRMED", "locked": is_locked, "confirmed": is_confirmed}
			is_locked = not is_locked
		"confirm":
			if not is_locked:
				return {"success": false, "error_code": "TRADE_NOT_LOCKED", "locked": is_locked, "confirmed": is_confirmed}
			is_confirmed = true
		"cancel":
			is_locked = false
			is_confirmed = false
		_:
			return {"success": false, "error_code": "INVALID_ACTION", "locked": is_locked, "confirmed": is_confirmed}
	return {"success": true, "locked": is_locked, "confirmed": is_confirmed}

## 模拟分发公会管理、好友、聊天与交易协议动作
func dispatch_guild_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
