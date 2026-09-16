# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/potential_growth/dynamic_attribute_adjuster.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/potential.json | 信号: EventBus 领域广播
# 职责说明: 击杀怪物 / 触发事件 → 系统直加或直减的**底层实际值域**（L3）永久调整： - 作用于实际能力值而非显示等级（等级不变，底层数值联动）； - 实际值下限 0（直减不可到负数），实际生效量记入 sheet.dynamic_adjustments； - 调整后实时重算生理机能 SF，并经 potential.dynamic_adjusted 领域事件广播； - 触发-幅值映射由 config/domains/potential.json 的 dynamic_adjust.channels 按事件频道（<域>.<事件>，如 monster.killed / world_boss.boss_defeated）驱动； - 永久性：心核洗点仅重置 L2 阅历重塑层与 L1 等级，L3 动态调整不逆转。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name DynamicAttributeAdjuster
extends RefCounted

const STAT_STR: String = "STR"
const STAT_CON: String = "CON"
const STAT_INT: String = "INT"
const STAT_AGI: String = "AGI"
const STAT_SPR: String = "SPR"
const STAT_VIT: String = "VIT"

const DEFAULT_STAT_LIST: Array[String] = [STAT_STR, STAT_CON, STAT_INT, STAT_AGI, STAT_SPR, STAT_VIT]

## 本求解器发出的领域事件频道
const EVENT_CHANNEL_ADJUSTED: String = "potential.dynamic_adjusted"

## 事件频道 → 属性调整（L3 实际值域直加/直减）：频道为 "<域>.<事件>"（事件流系统约定），
## 未在配置表登记的频道静默忽略（返回 NO_DYNAMIC_ADJUST_CONFIG）。
static func consume_event_channel(
	sheet: CharacterPhysiologySheet,
	channel: String,
	payload: Dictionary = {}
) -> Dictionary:
	var channels: Dictionary = GameConfig.get_dict("domains.potential", "dynamic_adjust/channels", {})
	if not channels.has(channel):
		return { "success": false, "error_code": "NO_DYNAMIC_ADJUST_CONFIG", "channel": channel }

	var adjustments: Dictionary = channels[channel]
	var applied: Array = []
	var total_delta := 0.0
	for stat in adjustments:
		var res = apply_dynamic_adjustment(sheet, str(stat), float(adjustments[stat]))
		if res.success:
			applied.append(res)
			total_delta += float(res.actual_delta)

	EventBusCore.get_instance().emit_domain_event(EVENT_CHANNEL_ADJUSTED, {
		"args": [channel, total_delta],
		"summary": { "channel": channel, "applied": applied, "total_delta": total_delta }
	})
	return { "success": true, "channel": channel, "applied": applied, "total_delta": total_delta }

## 单属性动态调整（L3 实际值域）：直加/直减实际值、下限 0、永久落账、重算 SF。
## 直减触碰下限时按实际生效量记录（actual_delta 可能为 0）。
static func apply_dynamic_adjustment(
	sheet: CharacterPhysiologySheet,
	stat_name: String,
	delta: float
) -> Dictionary:
	var allowed: Array = GameConfig.get_array("domains.potential", "growth/stat_list", DEFAULT_STAT_LIST)
	if not stat_name in allowed:
		return { "success": false, "error_code": "INVALID_STAT", "stat_name": stat_name }

	var floor_val := GameConfig.get_float("domains.potential", "dynamic_adjust/floor", 0.0)
	var current_actual := sheet.get_actual_value(stat_name)
	var target := maxf(floor_val, current_actual + delta)
	var actual_delta := target - current_actual
	var floor_hit := current_actual + delta < floor_val

	if is_equal_approx(actual_delta, 0.0):
		return {
			"success": true, "stat_name": stat_name,
			"requested_delta": delta, "actual_delta": 0.0,
			"new_value": current_actual, "floor_hit": floor_hit
		}

	sheet.dynamic_adjustments[stat_name] = float(sheet.dynamic_adjustments.get(stat_name, 0.0)) + actual_delta
	LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)
	return {
		"success": true, "stat_name": stat_name,
		"requested_delta": delta, "actual_delta": actual_delta,
		"new_value": target, "floor_hit": floor_hit
	}
