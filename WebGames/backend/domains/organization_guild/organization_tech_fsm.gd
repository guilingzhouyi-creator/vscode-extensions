# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/organization_guild/organization_tech_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/organization_guild.json | 信号: EventBus 领域广播
# 职责说明: 管理公会驻地科技升级、消耗金库资源并为全体成员计算被动光环增益
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name OrganizationTechFSM
extends RefCounted

const FACILITY_ALCHEMY_LAB: String = "ALCHEMY_LAB"
const FACILITY_BLACKSMITH_FORGE: String = "BLACKSMITH_FORGE"
const FACILITY_TACTICAL_TRAINING: String = "TACTICAL_TRAINING"

## 科技升级：UPGRADE_TECH 权限/金库资源校验后升级设施等级并扣费
static func upgrade_facility(
	org: OrganizationAggregate,
	operator_account_id: String,
	facility_key: String
) -> Dictionary:
	if not OrganizationGovernanceSolver.can_perform_action(org, operator_account_id, "UPGRADE_TECH"):
		return {
			"success": false,
			"error_code": "PERMISSION_DENIED",
			"error_message": _msg("tech_permission_denied")
		}

	var current_lvl: int = org.tech_levels.get(facility_key, 1)
	var gold_per_lvl: int = GameConfig.get_int("domains.organization_guild", "tech/upgrade_cost_gold_per_level", 500)
	var crystals_per_lvl: int = GameConfig.get_int("domains.organization_guild", "tech/upgrade_cost_crystals_per_level", 10)
	var required_gold: int = current_lvl * gold_per_lvl
	var required_crystals: int = current_lvl * crystals_per_lvl

	if org.treasury_gold_coins < required_gold or org.treasury_mana_crystals < required_crystals:
		return {
			"success": false,
			"error_code": "INSUFFICIENT_FUNDS",
			"error_message": _msg("tech_funds_insufficient") % [required_gold, required_crystals]
		}

	org.treasury_gold_coins -= required_gold
	org.treasury_mana_crystals -= required_crystals
	org.tech_levels[facility_key] = current_lvl + 1

	return {
		"success": true,
		"facility_key": facility_key,
		"new_level": current_lvl + 1
	}

## 公会科技被动光环计算（炼金/锻造/战术三设施按等级线性增益）
static func calculate_guild_buff_modifiers(org: OrganizationAggregate) -> Dictionary:
	var alchemy_lvl: int = org.tech_levels.get(FACILITY_ALCHEMY_LAB, 1)
	var forge_lvl: int = org.tech_levels.get(FACILITY_BLACKSMITH_FORGE, 1)
	var training_lvl: int = org.tech_levels.get(FACILITY_TACTICAL_TRAINING, 1)

	var potion_ratio: float = GameConfig.get_float("domains.organization_guild", "tech/potion_recovery_bonus_ratio_per_level", 0.05)
	var dura_ratio: float = GameConfig.get_float("domains.organization_guild", "tech/durability_loss_reduction_per_level", 0.04)
	var exp_ratio: float = GameConfig.get_float("domains.organization_guild", "tech/combat_exp_gain_ratio_per_level", 0.03)

	return {
		"potion_recovery_bonus_ratio": alchemy_lvl * potion_ratio,
		"equipment_durability_loss_reduction": forge_lvl * dura_ratio,
		"combat_exp_gain_ratio": training_lvl * exp_ratio
	}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("organization_guild", key)
