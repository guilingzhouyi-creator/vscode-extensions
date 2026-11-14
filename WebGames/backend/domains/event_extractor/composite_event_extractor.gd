# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_extractor/composite_event_extractor.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: item_statistics, telemetry_account_lifecycle | 配置: config/domains/event_extractor.json | 信号: EventBus 领域广播
# 职责说明: 配置驱动的通用提取管线「分组 → 组合 → 物化 → 投影」： - 分组：以 (account_id, transaction_id) 为组合键分组原始事件批次； - 组合：每组折叠为一个 CompositeEventDTO（物品流 + 货币增量 + 元数据）； - 物化：批量落账号 UID 递归树（复用 ItemStatisticsSolver 既有路径，减量下限 0）； - 投影：配置驱动派生视图（按账号/按物品汇总）。 规则表由 config/domains/event_extractor.json 驱动（零硬编码）； 空键守卫：transaction_id 缺失的原始事件不组合、保持逐条落账（不吞没）； 幂等：processed_keys 字典跨批次共享，已处理组键跳过。
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## CompositeEventExtractor：Value Object DTO / Data Transport Model
class_name CompositeEventExtractor
extends RefCounted

## L10: 组合键长度前缀编码（Inv-EC-1）——对任意字段内容无歧义。
## 旧实现以 KEY_SEP("|") 直接拼接：字段含 "|" 时跨账号分组碰撞（account="a|b" vs "a"+"b|c" 同键）。
static func _encode_composite_key(parts: Array) -> String:
	var key := ""
	for part in parts:
		var part_text := str(part)
		key += "%d:%s" % [part_text.length(), part_text]
	return key

# ==============================================================================
# 管线入口
# ==============================================================================

## 批次 → 分组 → 组合 → 物化 → 投影 → 遥测落点
static func extract(
	batch: Array,
	libraries: Dictionary,
	rules: Dictionary = {},
	catalog: ItemRegistryCatalog = null,
	telemetry: TelemetrySidecarEngine = null,
	processed_keys: Dictionary = {}
) -> Dictionary:
	if not GameConfig.get_bool("domains.event_extractor", "enabled", true):
		return {"success": false, "reason": "event_extractor disabled"}
	var rules_table: Dictionary = rules if not rules.is_empty() else _load_rules()
	var grouping_rules: Array = rules_table.get("grouping_rules", [])
	var projections: Dictionary = rules_table.get("projections", {})

	var groups := group_primitive_events(batch, grouping_rules)
	var composed_count := 0
	var raw_materialized_count := 0
	var materialized_flows := 0
	var invalid_dto_count := 0
	var clamped_flows: Array = []
	var skipped_keys: Array = []
	var projection_results: Array = []

	for group_key in groups:
		var group: Dictionary = groups[group_key]
		if processed_keys.has(group_key):
			skipped_keys.append(group_key)
			continue
		# 空键守卫：无事务键的原始事件不组合，保持逐条落账（不吞没）
		if str(group["transaction_id"]).is_empty():
			raw_materialized_count += _materialize_raw_events(group["events"], libraries, catalog)
			processed_keys[group_key] = true
			continue
		var composite_event := compose_group(group, _rule_by_id(str(group["rule_id"]), grouping_rules))
		var validation_result := CompositeEventDTO.validate_dto(composite_event)
		if not validation_result.valid:
			invalid_dto_count += 1
			continue
		var library: AccountItemLibrary = libraries.get(composite_event.account_id, null)
		var materialize_result := materialize(composite_event, library, catalog)
		materialized_flows += int(materialize_result.materialized)
		clamped_flows.append_array(materialize_result.clamped_flows)
		projection_results.append(project(composite_event, projections, str(group["projection"])))
		# 组合事件遥测落点（原始事件已由来源记录，此处仅记录组合事件）
		if telemetry != null:
			telemetry.record_event(composite_event.event_name, composite_event.account_id, {
				"transaction_id": composite_event.transaction_id,
				"item_flows": composite_event.item_flows,
				"currency_delta": composite_event.currency_delta,
				"timestamp_utc": composite_event.timestamp_utc
			})
		processed_keys[group_key] = true
		composed_count += 1

	return {
		"success": true,
		"composed_count": composed_count,
		"invalid_dto_count": invalid_dto_count,
		"raw_materialized_count": raw_materialized_count,
		"materialized_flows": materialized_flows,
		"clamped_flows": clamped_flows,
		"skipped_keys": skipped_keys,
		"projections": projection_results
	}

# ==============================================================================
# 步骤1 分组
# ==============================================================================

static func _new_group_entry(rule_id: String, account_id: String, transaction_id: String, projection: String) -> Dictionary:
	return {
		"rule_id": rule_id,
		"account_id": account_id,
		"transaction_id": transaction_id,
		"projection": projection,
		"events": []
	}

## 以 (rule_id, account_id, transaction_id) 三元组为组合键分组原始事件批次
static func group_primitive_events(batch: Array, grouping_rules: Array) -> Dictionary:
	var groups := {}
	for raw_event in batch:
		var primitive_event := _normalize_primitive(raw_event)
		if primitive_event.is_empty():
			continue
		var rule := _resolve_rule(primitive_event, grouping_rules)
		var rule_id := str(rule.get("rule_id", "raw"))
		var key := _encode_composite_key([rule_id, primitive_event["account_id"], primitive_event["transaction_id"]])
		if not groups.has(key):
			groups[key] = _new_group_entry(rule_id, str(primitive_event["account_id"]), str(primitive_event["transaction_id"]), str(rule.get("projection", "")))
		groups[key]["events"].append(primitive_event)
	return groups

# ==============================================================================
# 步骤2 组合
# ==============================================================================

static func _merge_primitive_into_dto(composite_event: CompositeEventDTO, primitive_event: Dictionary) -> void:
	composite_event.add_item_flow(str(primitive_event["canonical_id"]), str(primitive_event["event_type"]), int(primitive_event["quantity"]))
	var currency_delta_map: Dictionary = primitive_event.get("currency_delta", {})
	for currency_key in currency_delta_map:
		composite_event.add_currency_delta(str(currency_key), int(currency_delta_map[currency_key]))
	var metadata_map: Dictionary = primitive_event.get("meta", {})
	for metadata_key in metadata_map:
		if not composite_event.meta.has(metadata_key):
			composite_event.meta[metadata_key] = metadata_map[metadata_key]
	if composite_event.timestamp_utc == 0:
		composite_event.timestamp_utc = int(primitive_event.get("timestamp_utc", 0))

## 每组折叠为一个 CompositeEventDTO：物品流按 (canonical_id, event_type) 求和、货币增量合并
static func compose_group(group: Dictionary, rule: Dictionary) -> CompositeEventDTO:
	var composite_event := CompositeEventDTO.new()
	composite_event.event_name = str(rule.get("composite_event", "transaction.composed"))
	composite_event.account_id = str(group["account_id"])
	composite_event.transaction_id = str(group["transaction_id"])
	for primitive_event in group["events"]:
		_merge_primitive_into_dto(composite_event, primitive_event)
	return composite_event

# ==============================================================================
# 步骤3 物化
# ==============================================================================

## 组合事件批量落账号 UID 递归树（复用 ItemStatisticsSolver 既有路径，减量下限 0）
static func materialize(composite_event: CompositeEventDTO, library: AccountItemLibrary, catalog: ItemRegistryCatalog) -> Dictionary:
	var materialized := 0
	var clamped_flows: Array = []
	if library == null:
		return {"materialized": 0, "clamped_flows": []}
	for flow in composite_event.item_flows:
		var record_result: Variant = ItemStatisticsSolver.record_item_event(
			library, str(flow["event_type"]), str(flow["canonical_id"]), int(flow["quantity"]), catalog, null
		)
		if record_result.success:
			materialized += 1
			if int(record_result.actual_quantity) < int(flow["quantity"]):
				clamped_flows.append({
					"canonical_id": str(flow["canonical_id"]),
					"event_type": str(flow["event_type"]),
					"requested": int(flow["quantity"]),
					"actual": int(record_result.actual_quantity)
				})
	return {"materialized": materialized, "clamped_flows": clamped_flows}

# ==============================================================================
# 步骤4 投影
# ==============================================================================

static func _ensure_item_projection_subdict(items: Dictionary, canonical_id: String) -> Dictionary:
	if not items.has(canonical_id):
		items[canonical_id] = {}
	return items[canonical_id]

## 配置驱动派生视图：按账号汇总物品流与货币增量
static func project(composite_event: CompositeEventDTO, projections: Dictionary, projection_name: String) -> Dictionary:
	var rule: Dictionary = projections.get(projection_name, {})
	var items := {}
	for flow in composite_event.item_flows:
		var canonical_id := str(flow["canonical_id"])
		var event_type := str(flow["event_type"])
		var item_bucket: Dictionary = _ensure_item_projection_subdict(items, canonical_id)
		item_bucket[event_type] = int(item_bucket.get(event_type, 0)) + int(flow["quantity"])
	return {
		"projection": projection_name,
		"scope": str(rule.get("scope", "account")),
		"account_id": composite_event.account_id,
		"transaction_id": composite_event.transaction_id,
		"items": items,
		"currency_delta": composite_event.currency_delta,
		"item_flow_count": composite_event.item_flows.size()
	}

# ==============================================================================
# 内部实现
# ==============================================================================

## 原始事件归一化：兼容 TelemetryEventDTO（环形缓冲批次）与 Dictionary 两种来源；
## 非法事件（非六类/空 canonical_id/数量非正）返回空字典（跳过）
static func _normalize_primitive(raw_event: Variant) -> Dictionary:
	var primitive_event := {}
	if raw_event is TelemetryEventDTO:
		var telemetry_event: TelemetryEventDTO = raw_event
		var payload: Dictionary = telemetry_event.payload_attributes
		primitive_event = {
			"account_id": telemetry_event.account_id,
			"event_type": telemetry_event.event_name,
			"canonical_id": str(payload.get("canonical_id", "")),
			"quantity": int(payload.get("quantity", 0)),
			"transaction_id": str(payload.get("transaction_id", "")),
			"currency_delta": payload.get("currency_delta", {}),
			"meta": {"source": "telemetry_sidecar"},
			"timestamp_utc": telemetry_event.timestamp_utc
		}
	elif raw_event is Dictionary:
		var event_dictionary: Dictionary = raw_event
		primitive_event = {
			"account_id": str(event_dictionary.get("account_id", "")),
			"event_type": str(event_dictionary.get("event_type", "")),
			"canonical_id": str(event_dictionary.get("canonical_id", "")),
			"quantity": int(event_dictionary.get("quantity", 0)),
			"transaction_id": str(event_dictionary.get("transaction_id", "")),
			"currency_delta": event_dictionary.get("currency_delta", {}),
			"meta": event_dictionary.get("meta", {}),
			"timestamp_utc": int(event_dictionary.get("timestamp_utc", 0))
		}
	else:
		return {}
	if primitive_event["account_id"].is_empty() or primitive_event["canonical_id"].is_empty() or int(primitive_event["quantity"]) <= 0:
		return {}
	if not CompositeEventDTO.is_valid_event_type(str(primitive_event["event_type"])):
		return {}
	return primitive_event

## 空键守卫物化：无事务键的原始事件逐条落账（等价原逐条行为，不吞没）
static func _materialize_raw_events(events: Array, libraries: Dictionary, catalog: ItemRegistryCatalog) -> int:
	var count := 0
	for primitive_event in events:
		var library: AccountItemLibrary = libraries.get(str(primitive_event["account_id"]), null)
		if library == null:
			continue
		var record_result: Variant = ItemStatisticsSolver.record_item_event(
			library, str(primitive_event["event_type"]), str(primitive_event["canonical_id"]), int(primitive_event["quantity"]), catalog, null
		)
		if record_result.success:
			count += 1
	return count

## 规则解析：优先采用原始事件 meta.rule_id 显式指定的规则（多规则同源事件时消歧）；
## 缺省回退 source_event 首匹配；无规则命中回退 raw（逐条/原始组合）
static func _resolve_rule(primitive_event: Dictionary, grouping_rules: Array) -> Dictionary:
	var metadata_map: Dictionary = primitive_event.get("meta", {})
	var explicit_id := str(metadata_map.get("rule_id", ""))
	if not explicit_id.is_empty():
		for raw_rule in grouping_rules:
			var rule: Dictionary = raw_rule as Dictionary
			if rule.is_empty():
				continue
			if str(rule.get("rule_id", "")) == explicit_id:
				return rule
		return {"rule_id": "raw", "composite_event": "transaction.raw", "projection": ""}
	return _match_rule(str(primitive_event["event_type"]), grouping_rules)

static func _match_rule(event_type: String, grouping_rules: Array) -> Dictionary:
	for raw_rule in grouping_rules:
		var rule: Dictionary = raw_rule as Dictionary
		if rule.is_empty():
			continue
		if str(rule.get("source_event", "")) == event_type:
			return rule
	return {"rule_id": "raw", "composite_event": "transaction.raw", "projection": ""}

static func _rule_by_id(rule_id: String, grouping_rules: Array) -> Dictionary:
	for raw_rule in grouping_rules:
		var rule: Dictionary = raw_rule as Dictionary
		if rule.is_empty():
			continue
		if str(rule.get("rule_id", "")) == rule_id:
			return rule
	return {"rule_id": rule_id, "composite_event": "transaction.%s" % rule_id, "projection": ""}

# ==============================================================================
# 配置读取（零硬编码：规则全部来自 event_extractor.json）
# ==============================================================================

static func _load_rules() -> Dictionary:
	return {
		"grouping_rules": GameConfig.get_array("domains.event_extractor", "grouping_rules", []),
		"projections": GameConfig.get_dict("domains.event_extractor", "projections", {})
	}
