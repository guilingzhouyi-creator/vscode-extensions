# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/organization_guild/organization_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/organization_guild.json | 信号: EventBus 领域广播
# 职责说明: 原生公会与玩家自建组织实体，管理职位 RBAC、公共金库、驻地科技树与外交状态
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name OrganizationAggregate
extends RefCounted

enum OrganizationType {
	NATIVE_ADVENTURER_GUILD,   # 原生冒险者公会 (官方法定)
	NATIVE_MAGES_ASSOCIATION,  # 原生秘术学者协会
	NATIVE_MERCENARY_UNION,    # 原生雇佣兵同盟
	NATIVE_THIEVES_BROTHERHOOD,# 原生暗影兄弟会
	PLAYER_CREATED_CUSTOM      # 玩家自建自治组织
}

enum DiplomaticStance {
	ALLIED,     # 军事同盟
	FRIENDLY,   # 友好贸易
	NEUTRAL,    # 中立
	HOSTILE,    # 敌对
	AT_WAR      # 宣战死斗状态
}

enum GuildRole {
	GUILD_MASTER = 4, # 会长/领袖
	OFFICER = 3,      # 副会长/长老
	VETERAN = 2,      # 精英成员
	NOVICE = 1        # 见习新人
}

class OrgMemberDTO extends RefCounted:
	var account_id: String
	var character_name: String
	var role: GuildRole = GuildRole.NOVICE
	var join_timestamp_utc: int = 0
	var contribution_points: int = 0

	## 成员 DTO 构造（账户/名/职位）
	func _init(p_acc: String, p_name: String, p_role: GuildRole = GuildRole.NOVICE) -> void:
		account_id = p_acc
		character_name = p_name
		role = p_role

var org_id: String = ""                         # 组织全局唯一 ID
var localized_name: String = ""                 # 组织名称
var org_type: OrganizationType = OrganizationType.PLAYER_CREATED_CUSTOM
var leader_account_id: String = ""              # 会长账户 ID
var headquarters_town_id: String = GameConfig.get_string("domains.world", "node_defaults/town_id", "TOWN_VALAN") # 驻地总部所在城镇 ID

# 组织公共金库与科技
var treasury_mana_crystals: int = 0
var treasury_gold_coins: int = 0
var tech_levels: Dictionary = {
	"ALCHEMY_LAB": 1,
	"BLACKSMITH_FORGE": 1,
	"TACTICAL_TRAINING": 1
}

# 成员花名册 (account_id -> OrgMemberDTO)
var member_roster: Dictionary = {}

# 外交关系字典 (target_org_id -> DiplomaticStance)
var diplomatic_relations: Dictionary = {}

## 组织聚合构造（ID/名称/类型）
func _init(p_id: String = "", p_name: String = "", p_type: OrganizationType = OrganizationType.PLAYER_CREATED_CUSTOM) -> void:
	org_id = p_id
	localized_name = p_name
	org_type = p_type

## 登记成员入花名册（默认见习）
func add_member(acc_id: String, char_name: String, role: GuildRole = GuildRole.NOVICE) -> void:
	member_roster[acc_id] = OrgMemberDTO.new(acc_id, char_name, role)

## 成员职位查询（未登记回退 NOVICE）
func get_member_role(acc_id: String) -> GuildRole:
	if member_roster.has(acc_id):
		return member_roster[acc_id].role
	return GuildRole.NOVICE
