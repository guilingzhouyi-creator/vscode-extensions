# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_completeness_guard.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 46 域 × 17 视图映射的双向校验、MISSING/PARTIAL 运行时可见化、破坏性变更与孤儿视图审计
# 退出语义与设计依据: 业务域第一性原理 / 契约完备性守卫规范
# ==============================================================================

## ContractCompletenessGuard：Domain Logic Component
class_name ContractCompletenessGuard
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")
const IndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")

## ContractGapReport：契约缺口报告数据模型
class ContractGapReport:
	var generated_at: String = ""
	var total_domains: int = 0
	var total_views: int = 0
	var by_status: Dictionary = {
		"FULL": [],
		"PARTIAL": [],
		"MISSING": [],
		"INFRA": []
	}
	var reverse_orphans: Array[Dictionary] = []
	var forward_orphans: Array[Dictionary] = []
	var breaking_changes_pending: Array[Dictionary] = []
	var infra_exempt_list: Array[String] = []

	## 序列化契约缺口报告为字典（各清单副本防外部突变）
	func to_dto() -> Dictionary:
		return {
			"generated_at": generated_at,
			"total_domains": total_domains,
			"total_views": total_views,
			"by_status": by_status.duplicate(true),
			"reverse_orphans": reverse_orphans.duplicate(true),
			"forward_orphans": forward_orphans.duplicate(true),
			"breaking_changes_pending": breaking_changes_pending.duplicate(true),
			"infra_exempt_list": infra_exempt_list.duplicate()
		}


static func _make_coverage_result(
	domain: String,
	status: String,
	dto_count: int,
	event_count: int,
	command_count: int,
	missing_endpoints: Array
) -> Dictionary:
	return {
		"domain": domain,
		"coverage_status": status,
		"dto_count": dto_count,
		"event_count": event_count,
		"command_count": command_count,
		"missing_endpoints": missing_endpoints
	}


static func _accumulate_entry_endpoints(entry: RefCounted, counts: Array[int]) -> void:
	if not entry.source_path.is_empty() or entry.endpoint_kind == EntryClass.EndpointKind.DTO:
		counts[0] += 1
	if not entry.event_name.is_empty() or entry.endpoint_kind == EntryClass.EndpointKind.EVENT:
		counts[1] += 1
	if not entry.service_path.is_empty() or entry.endpoint_kind == EntryClass.EndpointKind.COMMAND:
		counts[2] += 1


static func _build_missing_endpoints(counts: Array[int]) -> Array[String]:
	var missing_endpoints: Array[String] = []
	if counts[0] == 0:
		missing_endpoints.append("DTO")
	if counts[1] == 0:
		missing_endpoints.append("EVENT")
	if counts[2] == 0:
		missing_endpoints.append("COMMAND")
	return missing_endpoints


## 域侧覆盖度审计
static func audit_domain_coverage(domain: String) -> Dictionary:
	IndexClass.ensure_loaded()
	if IndexClass.get_infra_domains().has(domain):
		return _make_coverage_result(domain, "INFRA", 0, 0, 0, [])

	var entries: Array = IndexClass.find_by_domain(domain)
	if entries.is_empty():
		return _make_coverage_result(domain, "MISSING", 0, 0, 0, ["DTO", "EVENT", "COMMAND"])

	var counts: Array[int] = [0, 0, 0]
	var exempt_count: int = 0

	for entry in entries:
		# 全部条目豁免才视为 INFRA（不被首个豁免条目短路）
		if entry.infra_exempt:
			exempt_count += 1
			continue
		# 显式 coverage_marker 标记 MISSING
		if entry.coverage_marker == "MISSING":
			return _make_coverage_result(domain, "MISSING", 0, 0, 0, ["DTO", "EVENT", "COMMAND"])
		_accumulate_entry_endpoints(entry, counts)

	if exempt_count == entries.size():
		return _make_coverage_result(domain, "INFRA", 0, 0, 0, [])

	var missing_endpoints: Array[String] = _build_missing_endpoints(counts)
	var status_label: String = "PARTIAL" if missing_endpoints.size() > 0 else "FULL"
	return _make_coverage_result(domain, status_label, counts[0], counts[1], counts[2], missing_endpoints)


## 视图侧契约密度审计
static func audit_view_density(view: String) -> Dictionary:
	IndexClass.ensure_loaded()
	var entries: Array = IndexClass.find_by_view(view)
	var domains_covered: Array[String] = []
	for entry in entries:
		if not domains_covered.has(entry.domain_name):
			domains_covered.append(entry.domain_name)

	# 孤儿视图由配置登记的 reverse_orphans 驱动，优先取配置条目 domain_name，缺失时回退视图名并去重
	var orphan_domains: Array[String] = []
	var seen_orphans: Dictionary = {}
	for orphan_record in IndexClass.get_reverse_orphans():
		if String(orphan_record.get("view_name", "")) != view:
			continue
		var orphan_domain: String = String(orphan_record.get("domain_name", ""))
		if orphan_domain.is_empty():
			orphan_domain = view
		if not seen_orphans.has(orphan_domain):
			seen_orphans[orphan_domain] = true
			orphan_domains.append(orphan_domain)

	return {
		"view": view,
		"total_contracts": entries.size(),
		"domains_covered": domains_covered,
		"orphan_domains": orphan_domains
	}


## INFRA 域豁免一致性审计（Inv-CT-6）
static func audit_infra_consistency() -> Array:
	IndexClass.ensure_loaded()
	var violations: Array[Dictionary] = []
	var infra_list: Array = IndexClass.get_infra_domains()
	var all_entries: Array = IndexClass.find_all()

	for entry in all_entries:
		if entry.infra_exempt and not infra_list.has(entry.domain_name):
			violations.append({
				"contract_id": entry.contract_id,
				"domain_name": entry.domain_name,
				"reason": "infra_exempt is true but domain not in infra_domains"
			})
		elif not entry.infra_exempt and infra_list.has(entry.domain_name):
			violations.append({
				"contract_id": entry.contract_id,
				"domain_name": entry.domain_name,
				"reason": "domain is in infra_domains but infra_exempt is false"
			})

	return violations


static func _collect_breaking_changes(all_entries: Array) -> Array[Dictionary]:
	var breaking_pending: Array[Dictionary] = []
	for entry in all_entries:
		if entry.contract_version > 1 and not entry.breaking_change_note.is_empty():
			breaking_pending.append({
				"contract_id": entry.contract_id,
				"version": entry.contract_version,
				"note": entry.breaking_change_note
			})
	return breaking_pending


static func _collect_forward_orphans(all_entries: Array, domains_seen: Array[String]) -> Array[Dictionary]:
	var domains_with_view: Dictionary = {}
	for entry in all_entries:
		if not entry.view_name.is_empty():
			domains_with_view[entry.domain_name] = true

	var forward_orphans: Array[Dictionary] = []
	for domain_name in domains_seen:
		if not domains_with_view.has(domain_name):
			forward_orphans.append({
				"domain_name": domain_name,
				"reason": "backend domain has no view mapping"
			})
	return forward_orphans


## 全域一致性扫描（CI 消费，DoD 核心基准）
static func audit_full_registry() -> Dictionary:
	IndexClass.ensure_loaded()
	var all_entries: Array = IndexClass.find_all()

	var domains_seen: Array[String] = []
	var views_seen: Array[String] = []
	var by_status: Dictionary = {
		"FULL": [],
		"PARTIAL": [],
		"MISSING": [],
		"INFRA": []
	}

	for entry in all_entries:
		if not domains_seen.has(entry.domain_name):
			domains_seen.append(entry.domain_name)
		if not views_seen.has(entry.view_name) and not entry.view_name.is_empty():
			views_seen.append(entry.view_name)

	for domain_name in domains_seen:
		var coverage_report: Dictionary = audit_domain_coverage(domain_name)
		var coverage_status: String = coverage_report.get("coverage_status", "MISSING")
		if by_status.has(coverage_status):
			by_status[coverage_status].append(domain_name)

	return {
		"total_domains": domains_seen.size(),
		"total_views": views_seen.size(),
		"by_status": by_status,
		"reverse_orphans": IndexClass.get_reverse_orphans(),
		"forward_orphans": _collect_forward_orphans(all_entries, domains_seen),
		"breaking_changes_pending": _collect_breaking_changes(all_entries),
		"infra_exempt_list": IndexClass.get_infra_domains()
	}
