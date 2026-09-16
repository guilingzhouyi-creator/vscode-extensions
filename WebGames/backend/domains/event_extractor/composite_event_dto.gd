# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_extractor/composite_event_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: item_statistics, telemetry_account_lifecycle | 配置: config/domains/event_extractor.json | 信号: EventBus 领域广播
# 职责说明: 组合事件数据契约：一次业务事务（同一 transaction_id）的全部原始事件 折叠为一个 CompositeEventDTO（物品流 + 货币增量 + 元数据）； 提供 DTO 与分组规则表的 Schema 校验（零硬编码，规则由 event_extractor.json 驱动）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name CompositeEventDTO
extends RefCounted

var event_name: String = ""          # 组合事件名（规则表驱动，如 "transaction.cdkey_redeemed"）
var account_id: String = ""          # 账号 UID（隔离维度，必填）
var transaction_id: String = ""      # 事务相关性键（一次业务动作一个键，组合分组依据）
var item_flows: Array = []           # 物品流：[{ "canonical_id", "event_type", "quantity" }...]
var currency_delta: Dictionary = {}  # 货币增量（可选，如 { "gold": -100, "copper": 5000 }）
var meta: Dictionary = {}            # 事务元数据（来源渠道/原因码/审计锚点）
var timestamp_utc: int = 0

## 追加一条物品流（quantity 必须为正整数）
func add_item_flow(canonical_id: String, event_type: String, quantity: int) -> void:
	if canonical_id.is_empty() or quantity <= 0:
		return
	item_flows.append({ "canonical_id": canonical_id, "event_type": event_type, "quantity": quantity })

## 追加货币增量（delta 可为负）
func add_currency_delta(currency_key: String, delta: int) -> void:
	if delta == 0:
		return
	currency_delta[currency_key] = int(currency_delta.get(currency_key, 0)) + delta

# ==============================================================================
# Schema 校验
# ==============================================================================

## DTO 完整性校验：账号/事务键非空、事件名非空、物品流事件类型合法且数量为正
static func validate_dto(dto: CompositeEventDTO) -> Dictionary:
	var violations: Array[String] = []
	if dto.account_id.is_empty():
		violations.append("account_id 为空")
	if dto.transaction_id.is_empty():
		violations.append("transaction_id 为空（组合键缺失）")
	if dto.event_name.is_empty():
		violations.append("event_name 为空")
	for flow in dto.item_flows:
		var f: Dictionary = flow as Dictionary
		if f.is_empty() or f.get("canonical_id", "") == "":
			violations.append("item_flow 缺少 canonical_id")
			continue
		if not _is_valid_event_type(str(f.get("event_type", ""))):
			violations.append("item_flow 非法事件类型: %s" % str(f.get("event_type", "")))
		if int(f.get("quantity", 0)) <= 0:
			violations.append("item_flow 数量必须为正: %s" % str(f.get("canonical_id", "")))
	if not violations.is_empty():
		return { "valid": false, "violations": violations }
	return { "valid": true }

## 分组规则表条目校验：source_event 合法、group_key 非空、composite_event 非空
static func validate_grouping_rule(rule: Dictionary) -> Dictionary:
	var violations: Array[String] = []
	var source := str(rule.get("source_event", ""))
	if not _is_valid_event_type(source):
		violations.append("source_event 非法事件类型: %s" % source)
	if str(rule.get("group_key", "")).is_empty():
		violations.append("group_key 为空")
	if str(rule.get("composite_event", "")).is_empty():
		violations.append("composite_event 为空")
	if not violations.is_empty():
		return { "valid": false, "violations": violations }
	return { "valid": true }

# ==============================================================================
# 内部实现
# ==============================================================================

static func _is_valid_event_type(event_type: String) -> bool:
	var valid := [
		ItemStatisticsSolver.EVENT_ITEM_GRANTED,
		ItemStatisticsSolver.EVENT_ITEM_CONSUMED,
		ItemStatisticsSolver.EVENT_ITEM_DESTROYED,
		ItemStatisticsSolver.EVENT_ITEM_TRADED,
		ItemStatisticsSolver.EVENT_ITEM_FORGED,
		ItemStatisticsSolver.EVENT_ITEM_CLAWED_BACK
	]
	return valid.has(event_type)
