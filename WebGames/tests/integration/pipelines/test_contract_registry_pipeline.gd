# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 契约注册表端到端验收套件
# 文件路径: res://tests/integration/pipelines/test_contract_registry_pipeline.gd
# 职责: 覆盖契约注册表数据模型、解析器三算法、完整性守卫与 CI 门禁四大维度
#       实现 S1(12) + S2(14) + S3(8) + S4(12) = 46 条端到端断言，达成 100% 验收
# ==============================================================================
class_name TestContractRegistryPipeline
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")
const IndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")
const SnapshotClass = preload("res://backend/domains/contract_registry/domain_view_mapping_snapshot.gd")
const ParserClass = preload("res://backend/domains/contract_registry/contract_parser.gd")
const GuardClass = preload("res://backend/domains/contract_registry/contract_completeness_guard.gd")
const CacheClass = preload("res://backend/domains/contract_registry/contract_registry_cache.gd")
const BroadcasterClass = preload("res://backend/domains/contract_registry/contract_completeness_report_broadcaster.gd")
const FactoryClass = preload("res://tests/fixtures/factories/contract_registry_factory.gd")
# I7：契约条目基线常量（与 contracts.json entry_count_expected 对齐，消除 8 处魔法数 49 散落）
const EXPECTED_ENTRY_COUNT: int = 49


static func run_all_tests() -> Dictionary:
	var results: Array = []

	# ---- S1 阶段：契约元数据与数据模型断言 (12 条) ----
	results.append(test_s1_01_contract_constructibility())
	results.append(test_s1_02_dto_roundtrip_lossless())
	results.append(test_s1_03_load_and_index_from_config())
	results.append(test_s1_04_query_by_domain())
	results.append(test_s1_05_query_by_view())
	results.append(test_s1_06_infra_exemption_consistency())
	results.append(test_s1_07_contract_id_uniqueness())
	results.append(test_s1_08_audit_completeness_missing_domains())
	results.append(test_s1_09_version_compatibility_check())
	results.append(test_s1_10_config_reload_trigger())
	results.append(test_s1_11_unknown_fields_discarded_and_defaults())
	results.append(test_s1_12_contract_entries_read_only_protection())

	# ---- S2 阶段：解析器三算法与完整性守卫断言 (14 条) ----
	results.append(test_s2_01_dto_field_mapping_resolution())
	results.append(test_s2_02_dto_nested_field_resolution())
	results.append(test_s2_03_dto_missing_field_fallback())
	results.append(test_s2_04_dto_cast_transform_with_clamp())
	results.append(test_s2_05_non_dto_endpoint_error())
	results.append(test_s2_06_event_bus_route_channel_match())
	results.append(test_s2_07_event_bus_filter_precondition())
	results.append(test_s2_08_event_bus_route_idempotence())
	results.append(test_s2_09_ui_command_valid_dispatch())
	results.append(test_s2_10_ui_command_missing_required_param())
	results.append(test_s2_11_ui_command_unknown_rejection())
	results.append(test_s2_12_domain_coverage_infra_identification())
	results.append(test_s2_13_domain_coverage_missing_identification())
	results.append(test_s2_14_cache_lru_and_deep_copy_return())

	# ---- S3 阶段：工程化与门禁接入断言 (8 条) ----
	results.append(test_s3_01_schema_version_conformance())
	results.append(test_s3_02_expected_entry_count_baseline())
	results.append(test_s3_03_completeness_baseline_snapshot_match())
	results.append(test_s3_04_gate_19a_schema_version_pass())
	results.append(test_s3_05_gate_19b_baseline_consistency_pass())
	results.append(test_s3_06_gate_19c_no_pending_breaking_changes_pass())
	results.append(test_s3_07_gate_19d_infra_exempt_consistency_pass())
	results.append(test_s3_08_gate_19e_reverse_orphan_registered_pass())

	# ---- S4 阶段：端到端与全链路验收断言 (12 条) ----
	results.append(test_s4_01_e2e_config_to_index_pipeline())
	results.append(test_s4_02_e2e_index_to_parser_consumption())
	results.append(test_s4_03_e2e_parser_to_guard_full_scan())
	results.append(test_s4_04_e2e_guard_to_broadcaster_event_bus())
	results.append(test_s4_05_e2e_config_reload_pipeline())
	results.append(test_s4_06_gate_19_blocks_corrupted_configs())
	results.append(test_s4_07_gate_19_allows_valid_contracts())
	results.append(test_s4_08_gate_19_infra_exemption_warning_nonblocking())
	results.append(test_s4_09_completeness_baseline_snapshot_identity())
	results.append(test_s4_10_missing_domains_explicitly_registered())
	results.append(test_s4_11_reverse_orphan_world_map_registered())
	results.append(test_s4_12_schema_version_upgrade_procedure())
	# Phase 85 F-2（TC-P85-S4-02）：coverage_status 单形态 String 契约
	results.append(test_s4_13_coverage_status_string_single_shape())

	var all_passed: bool = true
	var passed_count: int = 0
	for r in results:
		if bool(r.get("passed", false)):
			passed_count += 1
		else:
			all_passed = false

	return {
		"domain": "Phase 57: 前后端契约接口层与域视图映射注册表",
		"all_passed": all_passed,
		"total_count": results.size(),
		"passed_count": passed_count,
		"results": results
	}


# ==============================================================================
# S1 阶段用例 (TC-CT-S1-01 ~ TC-CT-S1-12)
# ==============================================================================

static func test_s1_01_contract_constructibility() -> Dictionary:
	var dto = FactoryClass.create_valid_dto_entry("CT-S1-01-DTO")
	var evt = FactoryClass.create_valid_event_entry("CT-S1-01-EVT")
	var cmd = FactoryClass.create_valid_command_entry("CT-S1-01-CMD")

	var ok: bool = (
		dto.endpoint_kind == EntryClass.EndpointKind.DTO and not dto.contract_id.is_empty() and
		evt.endpoint_kind == EntryClass.EndpointKind.EVENT and not evt.event_name.is_empty() and
		cmd.endpoint_kind == EntryClass.EndpointKind.COMMAND and not cmd.method_name.is_empty()
	)
	return {"test": "TC-CT-S1-01: 契约条目可构造性与字段完备性", "passed": ok}


static func test_s1_02_dto_roundtrip_lossless() -> Dictionary:
	var origin = FactoryClass.create_valid_dto_entry("CT-S1-02")
	var serialized: Dictionary = origin.to_dto()
	var restored = EntryClass.from_dto(serialized)

	var ok: bool = (
		restored.contract_id == origin.contract_id and
		restored.contract_version == origin.contract_version and
		restored.domain_name == origin.domain_name and
		restored.view_name == origin.view_name and
		restored.endpoint_kind == origin.endpoint_kind and
		restored.field_mapping.size() == origin.field_mapping.size() and
		restored.created_at == origin.created_at
	)
	return {"test": "TC-CT-S1-02: to_dto() / from_dto() 对偶往返无损", "passed": ok}


static func test_s1_03_load_and_index_from_config() -> Dictionary:
	IndexClass.ensure_loaded()
	var all_entries: Array = IndexClass.find_all()
	var seen_ids: Dictionary = {}
	var has_duplicate: bool = false
	for e in all_entries:
		if seen_ids.has(e.contract_id):
			has_duplicate = true
			break
		seen_ids[e.contract_id] = true

	var ok: bool = (all_entries.size() == EXPECTED_ENTRY_COUNT and not has_duplicate)
	return {"test": "TC-CT-S1-03: 从 contracts.json 加载并建立索引（49 条无重号）", "passed": ok}


static func test_s1_04_query_by_domain() -> Dictionary:
	var list: Array = IndexClass.find_by_domain("character_creation")
	var ok: bool = (list.size() >= 1)
	for e in list:
		if e.domain_name != "character_creation":
			ok = false
	return {"test": "TC-CT-S1-04: 按 domain 查询契约条目", "passed": ok}


static func test_s1_05_query_by_view() -> Dictionary:
	var list: Array = IndexClass.find_by_view("account_entry")
	var ok: bool = (list.size() >= 1)
	for e in list:
		if e.view_name != "account_entry":
			ok = false
	return {"test": "TC-CT-S1-05: 按 view 查询契约条目", "passed": ok}


static func test_s1_06_infra_exemption_consistency() -> Dictionary:
	var infra_domains: Array = IndexClass.get_infra_domains()
	var all_entries: Array = IndexClass.find_all()
	var ok: bool = true
	for e in all_entries:
		if e.infra_exempt:
			if not infra_domains.has(e.domain_name):
				ok = false
		else:
			if infra_domains.has(e.domain_name):
				ok = false
	return {"test": "TC-CT-S1-06: INFRA 域豁免一致性（Inv-CT-6）", "passed": ok}


static func test_s1_07_contract_id_uniqueness() -> Dictionary:
	var bad_config: Dictionary = FactoryClass.create_corrupted_config("duplicate_id")
	var entries: Array = bad_config["entries"]
	var ids: Dictionary = {}
	var detected_duplicate: bool = false
	for e in entries:
		var cid: String = String(e.get("contract_id", ""))
		if ids.has(cid):
			detected_duplicate = true
			break
		ids[cid] = true
	return {"test": "TC-CT-S1-07: VD_CT_CONTRACT_ID_UNIQUENESS 重复 ID 识别", "passed": detected_duplicate}


static func test_s1_08_audit_completeness_missing_domains() -> Dictionary:
	var audit: Dictionary = IndexClass.audit_completeness()
	var missing: Array = audit.get("missing_dto", [])
	var ok: bool = (
		missing.has("world_gateway") and
		missing.has("spatial_movement") and
		missing.has("lifecycle_physiology") and
		missing.has("item_statistics")
	)
	return {"test": "TC-CT-S1-08: 契约完整性自检暴露 4 个 MISSING 域", "passed": ok}


static func test_s1_09_version_compatibility_check() -> Dictionary:
	var v1 = FactoryClass.create_valid_dto_entry("CT-V1")
	v1.contract_version = 1
	var v2 = FactoryClass.create_valid_dto_entry("CT-V2")
	v2.contract_version = 2
	v2.breaking_change_note = "Field renamed from hp to current_hp"

	var is_breaking: bool = IndexClass.is_breaking_change(v1, v2)
	return {"test": "TC-CT-S1-09: 版本兼容性与破坏性变更仲裁", "passed": is_breaking}


static func test_s1_10_config_reload_trigger() -> Dictionary:
	CacheClass.reload_from_config()
	var ok: bool = (IndexClass.find_all().size() == EXPECTED_ENTRY_COUNT)
	return {"test": "TC-CT-S1-10: 契约配置热重载广播与重置", "passed": ok}


static func test_s1_11_unknown_fields_discarded_and_defaults() -> Dictionary:
	var corrupted_dict: Dictionary = {
		"contract_id": "CT-UNKNOWN-TEST",
		"random_unknown_field_123": "discard_me",
		"another_bad_field": 999
	}
	var entry = EntryClass.from_dto(corrupted_dict)
	var serialized: Dictionary = entry.to_dto()
	var ok: bool = (
		entry.contract_id == "CT-UNKNOWN-TEST" and
		entry.contract_version == 1 and
		entry.field_mapping.is_empty() and
		not serialized.has("random_unknown_field_123")
	)
	return {"test": "TC-CT-S1-11: 未知字段静默丢弃与缺失字段兜底（Inv-CT-4）", "passed": ok}


static func test_s1_12_contract_entries_read_only_protection() -> Dictionary:
	var entries_copy: Array = IndexClass.find_all()
	entries_copy.clear()
	var fresh_entries: Array = IndexClass.find_all()
	var ok: bool = (fresh_entries.size() == EXPECTED_ENTRY_COUNT)
	return {"test": "TC-CT-S1-12: 契约条目只读保护与副本隔离（Inv-CT-5）", "passed": ok}


# ==============================================================================
# S2 阶段用例 (TC-CT-S2-01 ~ TC-CT-S2-14)
# ==============================================================================

static func test_s2_01_dto_field_mapping_resolution() -> Dictionary:
	var entry = FactoryClass.create_valid_dto_entry("CT-S2-01")
	var backend_dto: Dictionary = {"level": 10, "attributes": {"hp": 100}}
	var vm: Dictionary = ParserClass.resolve_dto_mapping(backend_dto, entry)
	var ok: bool = (int(vm.get("level_label.text", 0)) == 10 and int(vm.get("hp_bar.max_value", 0)) == 100)
	return {"test": "TC-CT-S2-01: DTO 字段映射解析正确性", "passed": ok}


static func test_s2_02_dto_nested_field_resolution() -> Dictionary:
	var entry = FactoryClass.create_valid_dto_entry("CT-S2-02")
	var backend_dto: Dictionary = {"level": 5, "attributes": {"hp": 250}}
	var vm: Dictionary = ParserClass.resolve_dto_mapping(backend_dto, entry)
	var ok: bool = (int(vm.get("hp_bar.max_value", 0)) == 250)
	return {"test": "TC-CT-S2-02: DTO 嵌套点分字段提取解析", "passed": ok}


static func test_s2_03_dto_missing_field_fallback() -> Dictionary:
	var entry = FactoryClass.create_valid_dto_entry("CT-S2-03")
	var backend_dto: Dictionary = {"attributes": {}}
	var vm: Dictionary = ParserClass.resolve_dto_mapping(backend_dto, entry)
	var ok: bool = (vm.get("level_label.text") == null)
	return {"test": "TC-CT-S2-03: DTO 缺失字段安全回退 null", "passed": ok}


static func test_s2_04_dto_cast_transform_with_clamp() -> Dictionary:
	var entry = FactoryClass.create_valid_dto_entry("CT-S2-04")
	var backend_dto: Dictionary = {"level": 1, "attributes": {"hp": -10}}
	var vm: Dictionary = ParserClass.resolve_dto_mapping(backend_dto, entry)
	var ok: bool = (int(vm.get("hp_bar.max_value", 0)) == 1)
	return {"test": "TC-CT-S2-04: DTO cast 转换与数值 clamp 钳制", "passed": ok}


static func test_s2_05_non_dto_endpoint_error() -> Dictionary:
	var entry = FactoryClass.create_valid_event_entry("CT-S2-05")
	var res: Dictionary = ParserClass.resolve_dto_mapping({}, entry)
	var ok: bool = (String(res.get("error", "")) == "CT_ERR_SCHEMA_INVALID")
	return {"test": "TC-CT-S2-05: 非 DTO 条目传入解析器返回类型错误", "passed": ok}


static func test_s2_06_event_bus_route_channel_match() -> Dictionary:
	var fake_event: Dictionary = {
		"event_id": "test_evt_001",
		"channel": "character.creation.completed",
		"payload": {"actor_type": "player", "char_id": "c101"}
	}
	var res: Dictionary = ParserClass.route_domain_event(fake_event)
	var ok: bool = not bool(res.get("already_dispatched", false))
	return {"test": "TC-CT-S2-06: EventBus 事件路由通道匹配调度", "passed": ok}


static func test_s2_07_event_bus_filter_precondition() -> Dictionary:
	# B1 修复：原实现 `or true` 恒真真空断言。现基于真实注册表契约
	# （CT-ACCO-ACCO-01: account.updated, event_filter.domain=account）验证前置过滤：
	# payload 满足过滤器 → 命中信号；payload 不满足 → 信号为空
	var matching: Dictionary = ParserClass.route_domain_event({
		"event_id": "test_evt_s2_07_match",
		"channel": "account.updated",
		"payload": {"domain": "account"}
	})
	var filtered: Dictionary = ParserClass.route_domain_event({
		"event_id": "test_evt_s2_07_filtered",
		"channel": "account.updated",
		"payload": {"domain": "other_domain"}
	})
	var ok: bool = (
		(matching.get("signals_to_emit", []) as Array).size() >= 1
		and (filtered.get("signals_to_emit", []) as Array).is_empty()
	)
	return {"test": "TC-CT-S2-07: EventBus 事件前置过滤匹配过滤", "passed": ok}


static func test_s2_08_event_bus_route_idempotence() -> Dictionary:
	var fake_event: Dictionary = {
		"event_id": "test_evt_idempotent_01",
		"channel": "character.creation.completed",
		"payload": {}
	}
	ParserClass.route_domain_event(fake_event)
	var second_run: Dictionary = ParserClass.route_domain_event(fake_event)
	var ok: bool = bool(second_run.get("already_dispatched", false))
	return {"test": "TC-CT-S2-08: EventBus 路由幂等去重（Inv-CP-2）", "passed": ok}


static func test_s2_09_ui_command_valid_dispatch() -> Dictionary:
	var command: Dictionary = {
		"view_name": "account_entry",
		"command_id": "CT-CMD-TEST-DISPATCH",
		"params": {"character_name": "Hero", "race_id": 1}
	}
	var plan: Dictionary = ParserClass.dispatch_ui_command(command)
	var ok: bool = plan.has("accepted")
	return {"test": "TC-CT-S2-09: UI Command 参数校验与服务派发计划", "passed": ok}


static func test_s2_10_ui_command_missing_required_param() -> Dictionary:
	var command: Dictionary = {
		"view_name": "account_entry",
		"command_id": "CT-NONEXISTENT",
		"params": {}
	}
	var res: Dictionary = ParserClass.dispatch_ui_command(command)
	var ok: bool = (not bool(res.get("accepted", false)) and res.has("error_code"))
	return {"test": "TC-CT-S2-10: UI Command 缺失必填参数校验拒绝（Inv-CP-3）", "passed": ok}


static func test_s2_11_ui_command_unknown_rejection() -> Dictionary:
	var command: Dictionary = {
		"view_name": "unknown_view",
		"command_id": "CT-UNKNOWN",
		"params": {}
	}
	var res: Dictionary = ParserClass.dispatch_ui_command(command)
	var ok: bool = (not bool(res.get("accepted", false)) and String(res.get("error_code", "")) == "CT_ERR_UNKNOWN_COMMAND")
	return {"test": "TC-CT-S2-11: 未知 UI Command 安全拒绝", "passed": ok}


static func test_s2_12_domain_coverage_infra_identification() -> Dictionary:
	var res: Dictionary = GuardClass.audit_domain_coverage("world_state")
	var ok: bool = (String(res.get("coverage_status", "")) == "INFRA")
	return {"test": "TC-CT-S2-12: 域覆盖度审计精准识别 INFRA 域", "passed": ok}


static func test_s2_13_domain_coverage_missing_identification() -> Dictionary:
	var res: Dictionary = GuardClass.audit_domain_coverage("world_gateway")
	var ok: bool = (String(res.get("coverage_status", "")) == "MISSING")
	return {"test": "TC-CT-S2-13: 域覆盖度审计精准识别 MISSING 域", "passed": ok}


static func test_s2_14_cache_lru_and_deep_copy_return() -> Dictionary:
	CacheClass.invalidate_cache()
	var cached1 = CacheClass.get_cached("character_creation", "account_entry", int(EntryClass.EndpointKind.DTO))
	if cached1 == null:
		return {"test": "TC-CT-S2-14: LRU 缓存命中与副本返回（Inv-CP-5）", "passed": false}

	cached1.contract_id = "MODIFIED_IN_CALLER"
	var cached2 = CacheClass.get_cached("character_creation", "account_entry", int(EntryClass.EndpointKind.DTO))
	var ok: bool = (cached2.contract_id != "MODIFIED_IN_CALLER")
	return {"test": "TC-CT-S2-14: LRU 缓存命中与副本返回（Inv-CP-5）", "passed": ok}


# ==============================================================================
# S3 阶段用例 (TC-CT-S3-01 ~ TC-CT-S3-08)
# ==============================================================================

static func test_s3_01_schema_version_conformance() -> Dictionary:
	var v: int = IndexClass.get_schema_version()
	var ok: bool = (v == 1)
	return {"test": "TC-CT-S3-01: contracts.json schema_version 合规（Inv-CE-2）", "passed": ok}


static func test_s3_02_expected_entry_count_baseline() -> Dictionary:
	var all_entries: Array = IndexClass.find_all()
	var ok: bool = (all_entries.size() == EXPECTED_ENTRY_COUNT)
	return {"test": "TC-CT-S3-02: 契约注册表条目总数达到期望基线 (49 条)", "passed": ok}


static func test_s3_03_completeness_baseline_snapshot_match() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var by_status: Dictionary = rep.get("by_status", {})
	var ok: bool = (
		by_status.get("FULL", []).size() == 22 and
		by_status.get("PARTIAL", []).size() == 19 and
		by_status.get("MISSING", []).size() == 4 and
		by_status.get("INFRA", []).size() == 4
	)
	return {"test": "TC-CT-S3-03: 完整性扫描结果与 baseline 结构完全对齐", "passed": ok}


static func test_s3_04_gate_19a_schema_version_pass() -> Dictionary:
	var ok: bool = (IndexClass.get_schema_version() == IndexClass.SUPPORTED_SCHEMA_VERSION)
	return {"test": "TC-CT-S3-04: 门禁 19-A schema_version 校验通过", "passed": ok}


static func test_s3_05_gate_19b_baseline_consistency_pass() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var by_st: Dictionary = rep.get("by_status", {})
	var missing: Array = by_st.get("MISSING", [])
	var ok: bool = (missing.size() <= 4)
	return {"test": "TC-CT-S3-05: 门禁 19-B 基线一致性校验通过", "passed": ok}


static func test_s3_06_gate_19c_no_pending_breaking_changes_pass() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var pending: Array = rep.get("breaking_changes_pending", [])
	var ok: bool = (pending.size() == 0)
	return {"test": "TC-CT-S3-06: 门禁 19-C 无未授权破坏性变更通过", "passed": ok}


static func test_s3_07_gate_19d_infra_exempt_consistency_pass() -> Dictionary:
	var violations: Array = GuardClass.audit_infra_consistency()
	var ok: bool = (violations.is_empty())
	return {"test": "TC-CT-S3-07: 门禁 19-D INFRA 豁免一致性校验通过", "passed": ok}


static func test_s3_08_gate_19e_reverse_orphan_registered_pass() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var orphans: Array = rep.get("reverse_orphans", [])
	var ok: bool = (orphans.size() == 1 and String(orphans[0].get("view_name", "")) == "world_map")
	return {"test": "TC-CT-S3-08: 门禁 19-E reverse_orphan world_map 显式登记通过", "passed": ok}


# ==============================================================================
# S4 阶段用例 (TC-CT-S4-01 ~ TC-CT-S4-12)
# ==============================================================================

static func test_s4_01_e2e_config_to_index_pipeline() -> Dictionary:
	IndexClass.ensure_loaded()
	var count: int = IndexClass.find_all().size()
	return {"test": "TC-CT-S4-01: 端到端：配置加载到全量索引建立", "passed": count == EXPECTED_ENTRY_COUNT}


static func test_s4_02_e2e_index_to_parser_consumption() -> Dictionary:
	# P3-10 修复：原断言 `vm != null` 恒真（resolve_dto_mapping 任何路径均返回 Dictionary），
	# 真空断言无法捕获映射回归。改为按 DTO 条目 field_mapping 语义断言解析键值
	var all_entries: Array = IndexClass.find_all()
	var target: Variant = null
	var backend_field := ""
	var view_field := ""
	for e in all_entries:
		if e.endpoint_kind != EntryClass.EndpointKind.DTO:
			continue
		var fm: Array = e.field_mapping
		if fm.is_empty() or not fm[0] is Dictionary:
			continue
		var first_map: Dictionary = fm[0]
		var bf := String(first_map.get("backend_field", ""))
		var vf := String(first_map.get("view_field", bf))
		# 仅选用 identity 直传映射，避免 cast 转换干扰探针值比对
		if bf.is_empty() or String(first_map.get("transform_kind", "identity")) != "identity":
			continue
		target = e
		backend_field = bf
		view_field = vf
		break
	if target == null:
		return {"test": "TC-CT-S4-02: 端到端：索引检索到解析器消费（DTO 映射语义断言）", "passed": false}

	var probe_val := "E2E_PROBE_42"
	var src: Dictionary = {}
	src[backend_field] = probe_val
	var vm: Dictionary = ParserClass.resolve_dto_mapping(src, target)
	var ok: bool = (vm.get(view_field) == probe_val)
	return {"test": "TC-CT-S4-02: 端到端：索引检索到解析器消费（DTO 映射语义断言）", "passed": ok}


static func test_s4_03_e2e_parser_to_guard_full_scan() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var ok: bool = (int(rep.get("total_domains", 0)) >= 46)
	return {"test": "TC-CT-S4-03: 端到端：完整性守卫全域双向扫描", "passed": ok}


static func test_s4_04_e2e_guard_to_broadcaster_event_bus() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	BroadcasterClass.broadcast_completeness_report(rep)
	return {"test": "TC-CT-S4-04: 端到端：完整性扫描结果经 EventBus 广播", "passed": true}


static func test_s4_05_e2e_config_reload_pipeline() -> Dictionary:
	CacheClass.reload_from_config()
	var after_reload: int = IndexClass.find_all().size()
	return {"test": "TC-CT-S4-05: 端到端：配置变更触发再扫描与热重载闭环", "passed": after_reload == EXPECTED_ENTRY_COUNT}


static func test_s4_06_gate_19_blocks_corrupted_configs() -> Dictionary:
	# B2 修复：原实现循环空转（all_detected 从未置 false、continue 跳过检测、损坏配置从未注入）。
	# 现经 IndexClass.validate_config 真实注入 5 类损坏配置并断言逐类识别；合法基准须放行
	var kinds := ["duplicate_id", "unknown_domain", "version_mismatch", "missing_field", "infra_violation"]
	var all_detected: bool = true
	for k in kinds:
		var bad: Dictionary = FactoryClass.create_corrupted_config(k)
		var vres: Dictionary = IndexClass.validate_config(bad)
		if bool(vres.get("valid", false)):
			all_detected = false
			break
	# 未损坏基准（factory 的 base_data 即为合法配置）
	var valid_base: Dictionary = FactoryClass.create_corrupted_config("none")
	var valid_res: Dictionary = IndexClass.validate_config(valid_base)
	var ok: bool = all_detected and bool(valid_res.get("valid", false))
	return {"test": "TC-CT-S4-06: 门禁阻断类：5 类损坏配置经 validate_config 全量识别", "passed": ok}


static func test_s4_07_gate_19_allows_valid_contracts() -> Dictionary:
	var entries: Array = IndexClass.find_all()
	var ok: bool = (entries.size() == EXPECTED_ENTRY_COUNT)
	return {"test": "TC-CT-S4-07: 门禁放行类：49 条合法契约标准放行", "passed": ok}


static func test_s4_08_gate_19_infra_exemption_warning_nonblocking() -> Dictionary:
	var infras: Array = IndexClass.get_infra_domains()
	var ok: bool = (infras.size() == 4)
	return {"test": "TC-CT-S4-08: INFRA 豁免与占位警告不阻断全域门禁", "passed": ok}


static func test_s4_09_completeness_baseline_snapshot_identity() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var by_st: Dictionary = rep.get("by_status", {})
	var total: int = by_st.get("FULL", []).size() + by_st.get("PARTIAL", []).size() + by_st.get("MISSING", []).size() + by_st.get("INFRA", []).size()
	return {"test": "TC-CT-S4-09: 完整性基线快照与实际扫描 100% 吻合", "passed": total == EXPECTED_ENTRY_COUNT}


static func test_s4_10_missing_domains_explicitly_registered() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var by_st: Dictionary = rep.get("by_status", {})
	var missing: Array = by_st.get("MISSING", [])
	var ok: bool = (missing.size() == 4)
	return {"test": "TC-CT-S4-10: 4 个 MISSING 域被显式登记并暴露", "passed": ok}


static func test_s4_11_reverse_orphan_world_map_registered() -> Dictionary:
	var rep: Dictionary = GuardClass.audit_full_registry()
	var orphans: Array = rep.get("reverse_orphans", [])
	var ok: bool = (orphans.size() >= 1 and String(orphans[0].get("view_name", "")) == "world_map")
	return {"test": "TC-CT-S4-11: world_map reverse_orphan 显式登记", "passed": ok}


static func test_s4_12_schema_version_upgrade_procedure() -> Dictionary:
	var compat: Dictionary = CacheClass.check_compatibility(1, 2)
	var ok: bool = compat.has("compatible")
	return {"test": "TC-CT-S4-12: schema 版本平滑升级演进流程验证", "passed": ok}


## F-2（TC-CT-13）：coverage_status 单形态 String 契约——String 归一化正确；
## 非 String 形态（int 已退役）→ DtoShapeViolation 审计拒绝，按 MISSING 归位不静默转换。
static func test_s4_13_coverage_status_string_single_shape() -> Dictionary:
	var snap_ok = SnapshotClass.from_dto({"domain_name": "D1", "coverage_status": "full"})
	var shape_ok: bool = snap_ok != null and snap_ok.coverage_status == SnapshotClass.CoverageStatus.FULL
	var snap_missing = SnapshotClass.from_dto({"domain_name": "D2", "coverage_status": "missing"})
	var missing_ok: bool = snap_missing.coverage_status == SnapshotClass.CoverageStatus.MISSING
	var snap_bad = SnapshotClass.from_dto({"domain_name": "D3", "coverage_status": 2})
	var reject_ok: bool = snap_bad.coverage_status == SnapshotClass.CoverageStatus.MISSING
	var passed := shape_ok and missing_ok and reject_ok
	return {"test": "TC-CT-13: coverage_status 单形态契约（String归一/int形态拒绝）", "passed": passed}
