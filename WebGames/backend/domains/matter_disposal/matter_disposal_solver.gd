# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/matter_disposal/matter_disposal_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/matter_disposal.json | 信号: EventBus 领域广播
# 职责说明: 严格遵循物质守恒，拒绝背包凭空删除；计算熔炉焚化产出炉渣与魔素尘埃
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name MatterDisposalSolver
extends RefCounted

static func execute_disposal(
	player_pos: Vector2,
	facility: ItemDisposalFacilityDTO,
	target_item: ItemEntity,
	security_passcode: String = ""
) -> Dictionary:
	# 1. 设施合法性检定 (必须借由设施或溶剂，严禁空中销毁)
	if facility == null:
		return {
			"success": false,
			"error_code": "NO_DISPOSAL_FACILITY",
			"error_message": _msg("vanish_forbidden")
		}

	# 2. 空间距离检定 (便携溶剂无距离限制)
	if facility.method != ItemDisposalFacilityDTO.DisposalMethod.PORTABLE_ACID_SOLVENT:
		if not SpatialMath.within_radius(player_pos, facility.facility_pos, facility.max_operate_radius):
			return {
				"success": false,
				"error_code": "OUT_OF_FACILITY_RANGE",
				"error_message": _msg("facility_too_far") % facility.max_operate_radius
			}

	var valuable_thr := GameConfig.get_int("domains.matter_disposal", "safety/valuable_enhance_threshold", 7)
	var confirm_code := GameConfig.get_string("domains.matter_disposal", "safety/confirm_passcode", "CONFIRM_DESTROY")
	if target_item == null:
		return {"success": false, "error_code": "INVALID_ITEM"}
	# `combat_metrics.enhance_level` is the canonical runtime field.  The
	# legacy socket key is read only as a migration fallback for older saves;
	# canonical data always wins when both fields are present.
	var enh_level := int(target_item.combat_metrics.get("enhance_level", 0))
	if not target_item.combat_metrics.has("enhance_level"):
		enh_level = int(target_item.affix_sockets.get("enhancement_level", 0))
	if enh_level >= valuable_thr and security_passcode != confirm_code:
		return {
			"success": false,
			"error_code": "VALUABLE_LOCK_ACTIVE",
			"error_message": _msg("safety_locked")
		}

	# 4. 物质守恒质量换算
	var total_mass = target_item.mass_kg
	var slag_mass = total_mass * facility.slag_ash_yield_ratio
	var dust_mass = total_mass * facility.mana_dust_yield_ratio

	var slag_per_kg := GameConfig.get_float("domains.matter_disposal", "conversion/slag_per_kg", 2.0)
	var dust_per_kg := GameConfig.get_float("domains.matter_disposal", "conversion/dust_per_kg", 5.0)
	var min_yield := GameConfig.get_int("domains.matter_disposal", "conversion/min_yield", 1)
	var slag_count = maxi(min_yield, int(round(slag_mass * slag_per_kg)))
	var dust_count = maxi(min_yield, int(round(dust_mass * dust_per_kg)))

	return {
		"success": true,
		"destroyed_item_id": target_item.item_id,
		"original_mass_kg": total_mass,
		"yield_slag_ash_count": slag_count,
		"yield_mana_dust_count": dust_count,
		"slag_ash_mass_kg": slag_mass,
		"mana_dust_mass_kg": dust_mass
	}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("matter_disposal", key)
