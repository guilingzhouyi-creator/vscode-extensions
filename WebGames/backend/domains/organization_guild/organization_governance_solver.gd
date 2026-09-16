# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/organization_guild/organization_governance_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/organization_guild.json | 信号: EventBus 领域广播
# 职责说明: 判定职位 RBAC 操作许可、金库出纳审计与外交宣战状态机迁移
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name OrganizationGovernanceSolver
extends RefCounted

## 职位 RBAC 操作许可判定：三类动作白名单（会长独占/官员及以上/成员及以上）按配置逐级匹配
static func can_perform_action(org: OrganizationAggregate, operator_account_id: String, action: String) -> bool:
	if not org.member_roster.has(operator_account_id):
		return false

	var role: OrganizationAggregate.GuildRole = org.get_member_role(operator_account_id)
	var master_only: Array = GameConfig.get_array("domains.organization_guild", "rbac/actions/guild_master_only", ["DISBAND_GUILD", "DECLARE_WAR", "TRANSFER_LEADERSHIP"])
	var officer_up: Array = GameConfig.get_array("domains.organization_guild", "rbac/actions/officer_and_above", ["WITHDRAW_TREASURY", "UPGRADE_TECH", "KICK_MEMBER"])
	var member_up: Array = GameConfig.get_array("domains.organization_guild", "rbac/actions/member_and_above", ["ACCEPT_COMMISSION", "DEPOSIT_TREASURY"])
	if action in master_only:
		return role == OrganizationAggregate.GuildRole.GUILD_MASTER
	if action in officer_up:
		return role >= OrganizationAggregate.GuildRole.OFFICER
	if action in member_up:
		return role >= OrganizationAggregate.GuildRole.NOVICE
	return false

## 金库出纳：权限/负值符号守卫（Inv-VD-2）/余额三级校验后扣减
static func withdraw_from_treasury(
	org: OrganizationAggregate,
	operator_account_id: String,
	amount_gold: int,
	amount_crystals: int
) -> Dictionary:
	if not can_perform_action(org, operator_account_id, "WITHDRAW_TREASURY"):
		return {
			"success": false,
			"error_code": "PERMISSION_DENIED",
			"error_message": _msg("treasury_permission_denied")
		}

	# L3（Phase 55）：取款符号守卫（Inv-VD-2）——负金额此前恒通过余额比较，
	# `-=` 负值等价凭空入账（绕过 DEPOSIT 权限/出纳审计语义），一律 INVALID_AMOUNT 拦截
	if amount_gold < 0 or amount_crystals < 0:
		return {
			"success": false,
			"error_code": "INVALID_AMOUNT",
			"error_message": _msg("treasury_invalid_amount")
		}

	if org.treasury_gold_coins < amount_gold or org.treasury_mana_crystals < amount_crystals:
		return {
			"success": false,
			"error_code": "INSUFFICIENT_TREASURY",
			"error_message": _msg("treasury_insufficient")
		}

	org.treasury_gold_coins -= amount_gold
	org.treasury_mana_crystals -= amount_crystals
	return {
		"success": true,
		"withdrawn_gold": amount_gold,
		"withdrawn_crystals": amount_crystals
	}

## 外交宣战状态机：DECLARE_WAR 权限校验后写入目标组织外交关系
static func set_diplomatic_stance(
	org: OrganizationAggregate,
	operator_account_id: String,
	target_org_id: String,
	new_stance: OrganizationAggregate.DiplomaticStance
) -> Dictionary:
	if not can_perform_action(org, operator_account_id, "DECLARE_WAR"):
		return {
			"success": false,
			"error_code": "PERMISSION_DENIED",
			"error_message": _msg("diplomacy_permission_denied")
		}

	org.diplomatic_relations[target_org_id] = new_stance
	return {
		"success": true,
		"target_org_id": target_org_id,
		"new_stance": new_stance
	}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("organization_guild", key)
