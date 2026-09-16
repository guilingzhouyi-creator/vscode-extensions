# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_rule_trigger.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 建模「延时到期强制打出」等待触发行动——独立调度状态，与玩家主动出牌 解耦：触发时不得阻塞正常行动卡继续打出。由延时调度器驱动步进与到期 判定，携带目标策略、属性快照策略与释放失败处置，供边界状态消费。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicRuleTrigger
extends RefCounted

enum TriggerKind {
	DELAYED_CAST = 1,  # 延时魔法到期强制打出
}

enum ReleasePolicy {
	KEEP_PENDING = 1,  # 保留状态下轮重试
	CANCEL_AND_REFUND, # 取消并回退资源
	CANCEL,            # 取消（默认，不退款）
}

enum TargetPolicy {
	FAIL_ON_MISSING = 1,  # 目标缺失 → 受控失败（默认）
	LOCKED,               # 锁定原目标
	RETARGET,             # 释放时按规则重选
}

var trigger_id: String = ""
var kind: TriggerKind = TriggerKind.DELAYED_CAST
var holder_id: String = ""
var magic_ref: String = ""
var source_card_id: String = ""
var remain_steps: int = 0
var casts_per_play: int = 1              # 延时 + 几重化组合（释放时按当时配置触发）
var target_policy: TargetPolicy = TargetPolicy.FAIL_ON_MISSING
var release_policy: ReleasePolicy = ReleasePolicy.CANCEL
var snapshot_at_cast: Dictionary = {}    # 创建时属性快照（attribute_snapshot=AT_CAST 时生效）
var use_snapshot: bool = false           # true=按创建时快照结算；false=释放时实时

## 序列化触发状态为字典（枚举转整型 + 快照深拷贝）
func to_dto() -> Dictionary:
	return {
		"trigger_id": trigger_id,
		"kind": int(kind),
		"holder_id": holder_id,
		"magic_ref": magic_ref,
		"source_card_id": source_card_id,
		"remain_steps": remain_steps,
		"casts_per_play": casts_per_play,
		"target_policy": int(target_policy),
		"release_policy": int(release_policy),
		"snapshot_at_cast": snapshot_at_cast.duplicate(true),
		"use_snapshot": use_snapshot,
	}

## 从字典重建触发状态（缺省回退默认策略）
static func from_dto(data: Dictionary) -> MagicRuleTrigger:
	var tr := MagicRuleTrigger.new()
	tr.trigger_id = str(data.get("trigger_id", ""))
	tr.kind = int(data.get("kind", TriggerKind.DELAYED_CAST))
	tr.holder_id = str(data.get("holder_id", ""))
	tr.magic_ref = str(data.get("magic_ref", ""))
	tr.source_card_id = str(data.get("source_card_id", ""))
	tr.remain_steps = int(data.get("remain_steps", 0))
	tr.casts_per_play = int(data.get("casts_per_play", 1))
	tr.target_policy = int(data.get("target_policy", TargetPolicy.FAIL_ON_MISSING))
	tr.release_policy = int(data.get("release_policy", ReleasePolicy.CANCEL))
	tr.snapshot_at_cast = data.get("snapshot_at_cast", {}).duplicate(true)
	tr.use_snapshot = bool(data.get("use_snapshot", false))
	return tr

## 步进推进（下限 0，防负）
func advance_steps(steps: int) -> void:
	remain_steps = maxi(0, remain_steps - steps)

## 到期判定（remain_steps ≤ 0）
func is_due() -> bool:
	return remain_steps <= 0
