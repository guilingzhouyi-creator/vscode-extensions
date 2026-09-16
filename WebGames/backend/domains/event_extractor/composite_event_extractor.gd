# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_extractor/composite_event_extractor.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: item_statistics, telemetry_account_lifecycle | 配置: config/domains/event_extractor.json | 信号: EventBus 领域广播
# 职责说明: 配置驱动的通用提取管线「分组 → 组合 → 物化 → 投影」： - 分组：以 (account_id, transaction_id) 为组合键分组原始事件批次； - 组合：每组折叠为一个 CompositeEventDTO（物品流 + 货币增量 + 元数据）； - 物化：批量落账号 UID 递归树（复用 ItemStatisticsSolver 既有路径，减量下限 0）； - 投影：配置驱动派生视图（按账号/按物品汇总）。 规则表由 config/domains/event_extractor.json 驱动（零硬编码）； 空键守卫：transaction_id 缺失的原始事件不组合、保持逐条落账（不吞没）； 幂等：processed_keys 字典跨批次共享，已处理组键跳过。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name CompositeEventExtractor
extends RefCounted

## L10（Phase 54）：组合键长度前缀编码（Inv-EC-1）——对任意字段内容无歧义。
## 旧实现以 KEY_SEP("|") 直接拼接：字段含 "|" 时跨账号分组碰撞（account="a|b" vs "a"+"b|c" 同键）。
static func _encode_composite_key(parts: Array) -> String:
	var key := ""
	for part in parts:
		var s := str(part)
		key += "%d:%s" % [s.length(), s]
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
		return { "success": false, "reason": "event_extractor disabled" }
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
		var dto := compose_group(group, _rule_by_id(str(group["rule_id"]), grouping_rules))
		var val_res := CompositeEventDTO.validate_dto(dto)
		if not val_res.valid:
			invalid_dto_count += 1
			continue
		var lib: AccountItemLibraryAggregate = libraries.get(dto.account_id, null)
		var mat := materialize(dto, lib, catalog)
		materialized_flows += int(mat.materialized)
		for c in mat.clamped_flows:
			clamped_flows.append(c)
		projection_results.append(project(dto, projections, str(group["projection"])))
		# 组合事件遥测落点（原始事件已由来源记录，此处仅记录组合事件）
		if telemetry != null:
			telemetry.record_event(dto.event_name, dto.account_id, {
				"transaction_id": dto.transaction_id,
				"item_flows": dto.item_flows,
				"currency_delta": dto.currency_delta,
				"timestamp_utc": dto.timestamp_utc
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

## 以 (rule_id, account_id, transaction_id) 三元组为组合键分组原始事件批次
static func group_primitive_events(batch: Array, grouping_rules: Array) -> Dictionary:
	var groups := {}
	for evt in batch:
		var prim := _normalize_primitive(evt)
		if prim.is_empty():
			continue
		var rule := _resolve_rule(prim, grouping_rules)
		var rule_id := str(rule.get("rule_id", "raw"))
		var key := _encode_composite_key([rule_id, prim["account_id"], prim["transaction_id"]])
		if not groups.has(key):
			groups[key] = {
				"rule_id": rule_id,
				"account_id": prim["account_id"],
				"transaction_id": prim["transaction_id"],
				"projection": str(rule.get("projection", "")),
				"events": []
			}
		groups[key]["events"].append(prim)
	return groups

# ==============================================================================
# 步骤2 组合
# ==============================================================================

## 每组折叠为一个 CompositeEventDTO：物品流按 (canonical_id, event_type) 求和、货币增量合并
static func compose_group(group: Dictionary, rule: Dictionary) -> CompositeEventDTO:
	var dto := CompositeEventDTO.new()
	dto.event_name = str(rule.get("composite_event", "transaction.composed"))
	dto.account_id = str(group["account_id"])
	dto.transaction_id = str(group["transaction_id"])
	for prim in group["events"]:
		dto.add_item_flow(str(prim["canonical_id"]), str(prim["event_type"]), int(prim["quantity"]))
		var cd: Dictionary = prim.get("currency_delta", {})
		for k in cd:
			dto.add_currency_delta(str(k), int(cd[k]))
		var meta: Dictionary = prim.get("meta", {})
		for k in meta:
			if not dto.meta.has(k):
				dto.meta[k] = meta[k]
		if dto.timestamp_utc == 0:
			dto.timestamp_utc = int(prim.get("timestamp_utc", 0))
	return dto

# ==============================================================================
# 步骤3 物化
# ==============================================================================

## 组合事件批量落账号 UID 递归树（复用 ItemStatisticsSolver 既有路径，减量下限 0）
static func materialize(dto: CompositeEventDTO, library: AccountItemLibraryAggregate, catalog: ItemRegistryCatalog) -> Dictionary:
	var materialized := 0
	var clamped_flows: Array = []
	if library == null:
		return { "materialized": 0, "clamped_flows": [] }
	for flow in dto.item_flows:
		var res = ItemStatisticsSolver.record_item_event(
			library, str(flow["event_type"]), str(flow["canonical_id"]), int(flow["quantity"]), catalog, null
		)
		if res.success:
			materialized += 1
			if int(res.actual_quantity) < int(flow["quantity"]):
				clamped_flows.append({
					"canonical_id": str(flow["canonical_id"]),
					"event_type": str(flow["event_type"]),
					"requested": int(flow["quantity"]),
					"actual": int(res.actual_quantity)
				})
	return { "materialized": materialized, "clamped_flows": clamped_flows }

# ==============================================================================
# 步骤4 投影
# ==============================================================================

## 配置驱动派生视图：按账号汇总物品流与货币增量
static func project(dto: CompositeEventDTO, projections: Dictionary, projection_name: String) -> Dictionary:
	var rule: Dictionary = projections.get(projection_name, {})
	var items := {}
	for flow in dto.item_flows:
		var cid := str(flow["canonical_id"])
		var event_type := str(flow["event_type"])
		if not items.has(cid):
			items[cid] = {}
		items[cid][event_type] = int(items[cid].get(event_type, 0)) + int(flow["quantity"])
	return {
		"projection": projection_name,
		"scope": str(rule.get("scope", "account")),
		"account_id": dto.account_id,
		"transaction_id": dto.transaction_id,
		"items": items,
		"currency_delta": dto.currency_delta,
		"item_flow_count": dto.item_flows.size()
	}

# ==============================================================================
# 内部实现
# ==============================================================================

## 原始事件归一化：兼容 TelemetryEventDTO（环形缓冲批次）与 Dictionary 两种来源；
## 非法事件（非六类/空 canonical_id/数量非正）返回空字典（跳过）
static func _normalize_primitive(evt: Variant) -> Dictionary:
	var prim := {}
	if evt is TelemetryEventDTO:
		var dto: TelemetryEventDTO = evt
		var payload: Dictionary = dto.payload_attributes
		prim = {
			"account_id": dto.account_id,
			"event_type": dto.event_name,
			"canonical_id": str(payload.get("canonical_id", "")),
			"quantity": int(payload.get("quantity", 0)),
			"transaction_id": str(payload.get("transaction_id", "")),
			"currency_delta": payload.get("currency_delta", {}),
			"meta": { "source": "telemetry_sidecar" },
			"timestamp_utc": dto.timestamp_utc
		}
	elif evt is Dictionary:
		var d: Dictionary = evt
		prim = {
			"account_id": str(d.get("account_id", "")),
			"event_type": str(d.get("event_type", "")),
			"canonical_id": str(d.get("canonical_id", "")),
			"quantity": int(d.get("quantity", 0)),
			"transaction_id": str(d.get("transaction_id", "")),
			"currency_delta": d.get("currency_delta", {}),
			"meta": d.get("meta", {}),
			"timestamp_utc": int(d.get("timestamp_utc", 0))
		}
	else:
		return {}
	if prim["account_id"].is_empty() or prim["canonical_id"].is_empty() or int(prim["quantity"]) <= 0:
		return {}
	if not _valid_event_type(str(prim["event_type"])):
		return {}
	return prim

## 空键守卫物化：无事务键的原始事件逐条落账（等价原逐条行为，不吞没）
static func _materialize_raw_events(events: Array, libraries: Dictionary, catalog: ItemRegistryCatalog) -> int:
	var count := 0
	for prim in events:
		var lib: AccountItemLibraryAggregate = libraries.get(str(prim["account_id"]), null)
		if lib == null:
			continue
		var res = ItemStatisticsSolver.record_item_event(
			lib, str(prim["event_type"]), str(prim["canonical_id"]), int(prim["quantity"]), catalog, null
		)
		if res.success:
			count += 1
	return count

## 规则解析：优先采用原始事件 meta.rule_id 显式指定的规则（多规则同源事件时消歧）；
## 缺省回退 source_event 首匹配；无规则命中回退 raw（逐条/原始组合）
static func _resolve_rule(prim: Dictionary, grouping_rules: Array) -> Dictionary:
	var meta: Dictionary = prim.get("meta", {})
	var explicit_id := str(meta.get("rule_id", ""))
	if not explicit_id.is_empty():
		for r in grouping_rules:
			var rule: Dictionary = r as Dictionary
			if rule.is_empty():
				continue
			if str(rule.get("rule_id", "")) == explicit_id:
				return rule
		return { "rule_id": "raw", "composite_event": "transaction.raw", "projection": "" }
	return _match_rule(str(prim["event_type"]), grouping_rules)

static func _match_rule(event_type: String, grouping_rules: Array) -> Dictionary:
	for r in grouping_rules:
		var rule: Dictionary = r as Dictionary
		if rule.is_empty():
			continue
		if str(rule.get("source_event", "")) == event_type:
			return rule
	return { "rule_id": "raw", "composite_event": "transaction.raw", "projection": "" }

static func _rule_by_id(rule_id: String, grouping_rules: Array) -> Dictionary:
	for r in grouping_rules:
		var rule: Dictionary = r as Dictionary
		if rule.is_empty():
			continue
		if str(rule.get("rule_id", "")) == rule_id:
			return rule
	return { "rule_id": rule_id, "composite_event": "transaction.%s" % rule_id, "projection": "" }

static func _valid_event_type(event_type: String) -> bool:
	return event_type in [
		ItemStatisticsSolver.EVENT_ITEM_GRANTED,
		ItemStatisticsSolver.EVENT_ITEM_CONSUMED,
		ItemStatisticsSolver.EVENT_ITEM_DESTROYED,
		ItemStatisticsSolver.EVENT_ITEM_TRADED,
		ItemStatisticsSolver.EVENT_ITEM_FORGED,
		ItemStatisticsSolver.EVENT_ITEM_CLAWED_BACK
	]

# ==============================================================================
# 配置读取（零硬编码：规则全部来自 event_extractor.json）
# ==============================================================================

static func _load_rules() -> Dictionary:
	return {
		"grouping_rules": GameConfig.get_array("domains.event_extractor", "grouping_rules", []),
		"projections": GameConfig.get_dict("domains.event_extractor", "projections", {})
	}
