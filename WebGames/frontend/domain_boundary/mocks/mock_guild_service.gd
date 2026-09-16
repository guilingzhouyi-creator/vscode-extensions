# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟公会社交服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_guild_service.gd
# 职责: 成员生成规则、RBAC 白名单读取与交易锁定/确认状态机
# ==============================================================================
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

func generate_roster(count: int) -> Array:
	var members: Array = []
	for i in range(maxi(0, count)):
		members.append({
			"name": MEMBER_NAME_KEYS[i % MEMBER_NAME_KEYS.size()],
			"class": CLASS_KEYS[i % CLASS_KEYS.size()],
			"level": 20 + (i * 3) % 30,
			"role": ROLE_KEYS[i % ROLE_KEYS.size()],
			"online": i % 3 != 2,
			"contribution": 500 + i * 320,
		})
	return members

func can_manage(user_role: String) -> bool:
	var allowed_roles: Array = GameConfig.get_array(RULES_SECTION, RULES_KEY + "/manage_roles", ["LEADER", "OFFICER"])
	return user_role in allowed_roles

func trade_transition(state: Dictionary, action: String) -> Dictionary:
	var locked := bool(state.get("locked", false))
	var confirmed := bool(state.get("confirmed", false))
	match action:
		"lock":
			if confirmed:
				return {"success": false, "error_code": "TRADE_CONFIRMED", "locked": locked, "confirmed": confirmed}
			locked = not locked
		"confirm":
			if not locked:
				return {"success": false, "error_code": "TRADE_NOT_LOCKED", "locked": locked, "confirmed": confirmed}
			confirmed = true
		"cancel":
			locked = false
			confirmed = false
		_:
			return {"success": false, "error_code": "INVALID_ACTION", "locked": locked, "confirmed": confirmed}
	return {"success": true, "locked": locked, "confirmed": confirmed}
