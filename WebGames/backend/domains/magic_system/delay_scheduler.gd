# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/delay_scheduler.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 延时魔法（设置延时 N 步 → 经过 N 步强制打出）的独立待触发调度状态。 非阻塞设计：调度器只维护到期队列，到期项在行动系统可用时机消费， 任何情况下不得阻塞玩家正常行动卡继续打出。释放时间以步数为主要单位， 边界事件（持有者死亡/战斗结束/回合结束）与释放失败策略由配置驱动。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name DelayScheduler
extends RefCounted

var _pending: Array = []          # Array[MagicRuleTrigger]（待触发行动队列）
var _config: Dictionary = {}

func setup(delay_config: Dictionary) -> void:
	_config = delay_config.duplicate(true)

func config() -> Dictionary:
	return _config

## 设置延时：校验步数合法域与重复延时，入队待触发状态
func schedule(trigger: MagicRuleTrigger) -> Dictionary:
	var cfg := _config if not _config.is_empty() else {
		"min_steps": 1, "max_steps": 10, "allow_repeat": false
	}
	var min_steps := int(cfg.get("min_steps", 1))
	var max_steps := int(cfg.get("max_steps", 10))
	if trigger.remain_steps < min_steps or trigger.remain_steps > max_steps:
		return {
			"success": false,
			"error_code": "DELAY_OUT_OF_RANGE",
			"min_steps": min_steps,
			"max_steps": max_steps,
		}
	var allow_repeat := bool(cfg.get("allow_repeat", false))
	if not allow_repeat and _has_pending_magic(trigger.holder_id, trigger.magic_ref):
		return {"success": false, "error_code": "ALREADY_DELAYED", "magic_ref": trigger.magic_ref}
	_pending.append(trigger)
	return {"success": true, "trigger_id": trigger.trigger_id, "due_in_steps": trigger.remain_steps}

## 步进：仅推进到期判定，不抢占玩家行动槽（非阻塞核心）
func advance_steps(steps: int) -> void:
	for trigger in _pending:
		if trigger is MagicRuleTrigger:
			trigger.advance_steps(steps)

## 到期项出队（由行动系统在空闲时机消费；未消费不阻塞玩家主动出牌）
func drain_due(holder_id: String = "") -> Array:
	var due: Array = []
	var rest: Array = []
	for trigger in _pending:
		if not trigger is MagicRuleTrigger:
			continue
		if trigger.is_due() and (holder_id.is_empty() or trigger.holder_id == holder_id):
			due.append(trigger)
		else:
			rest.append(trigger)
	_pending = rest
	return due

func pending_count(holder_id: String = "") -> int:
	if holder_id.is_empty():
		return _pending.size()
	var count := 0
	for trigger in _pending:
		if trigger is MagicRuleTrigger and trigger.holder_id == holder_id:
			count += 1
	return count

## 持有者边界（死亡/战斗结束）：按 on_owner_death / on_battle_end 处置，
## 取消并清理（返回被取消数量）
func cancel_by_holder(holder_id: String) -> int:
	var rest: Array = []
	var cancelled := 0
	for trigger in _pending:
		if trigger is MagicRuleTrigger and trigger.holder_id == holder_id:
			cancelled += 1
		else:
			rest.append(trigger)
	_pending = rest
	return cancelled

## 释放失败处置（由调用方按 trigger.release_policy 执行，调度器只提供查询）
func release_fail_policy_name(trigger: MagicRuleTrigger) -> String:
	match int(trigger.release_policy):
		MagicRuleTrigger.ReleasePolicy.KEEP_PENDING:
			return "KEEP_PENDING"
		MagicRuleTrigger.ReleasePolicy.CANCEL_AND_REFUND:
			return "CANCEL_AND_REFUND"
	return "CANCEL"

func _has_pending_magic(holder_id: String, magic_ref: String) -> bool:
	for trigger in _pending:
		if trigger is MagicRuleTrigger \
				and trigger.holder_id == holder_id \
				and trigger.magic_ref == magic_ref:
			return true
	return false
