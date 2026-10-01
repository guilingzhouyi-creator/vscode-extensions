# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_completeness_guard.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 46 域 × 17 视图映射的双向校验、MISSING/PARTIAL 运行时可见化、破坏性变更与孤儿视图审计
# 设计依据: 业务域第一性原理 / 契约完备性守卫规范
# ==============================================================================

class_name ContractCompletenessGuard
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")
const IndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")

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
	dto_cnt: int,
	ev_cnt: int,
	cmd_cnt: int,
	missing_eps: Array
) -> Dictionary:
	return {
		"domain": domain,
		"coverage_status": status,
		"dto_count": dto_cnt,
		"event_count": ev_cnt,
		"command_count": cmd_cnt,
		"missing_endpoints": missing_eps
	}


static func _accumulate_entry_endpoints(e: RefCounted, counts: Array[int]) -> void:
	if not e.source_path.is_empty() or e.endpoint_kind == EntryClass.EndpointKind.DTO:
		counts[0] += 1
	if not e.event_name.is_empty() or e.endpoint_kind == EntryClass.EndpointKind.EVENT:
		counts[1] += 1
	if not e.service_path.is_empty() or e.endpoint_kind == EntryClass.EndpointKind.COMMAND:
		counts[2] += 1


static func _build_missing_endpoints(counts: Array[int]) -> Array[String]:
	var missing_eps: Array[String] = []
	if counts[0] == 0:
		missing_eps.append("DTO")
	if counts[1] == 0:
		missing_eps.append("EVENT")
	if counts[2] == 0:
		missing_eps.append("COMMAND")
	return missing_eps


## 域侧覆盖度审计
static func audit_domain_coverage(domain: String) -> Dictionary:
	IndexClass.ensure_loaded()
	if IndexClass.get_infra_domains().has(domain):
		return _make_coverage_result(domain, "INFRA", 0, 0, 0, [])

	var entries: Array = IndexClass.find_by_domain(domain)
	if entries.is_empty():
		return _make_coverage_result(domain, "MISSING", 0, 0, 0, ["DTO", "EVENT", "COMMAND"])

	var counts: Array[int] = [0, 0, 0]
	var exempt_cnt: int = 0

	for e in entries:
		# 全部条目豁免才视为 INFRA（不被首个豁免条目短路）
		if e.infra_exempt:
			exempt_cnt += 1
			continue
		# 显式 coverage_marker 标记 MISSING
		if e.coverage_marker == "MISSING":
			return _make_coverage_result(domain, "MISSING", 0, 0, 0, ["DTO", "EVENT", "COMMAND"])
		_accumulate_entry_endpoints(e, counts)

	if exempt_cnt == entries.size():
		return _make_coverage_result(domain, "INFRA", 0, 0, 0, [])

	var missing_eps: Array[String] = _build_missing_endpoints(counts)
	var status_str: String = "PARTIAL" if missing_eps.size() > 0 else "FULL"
	return _make_coverage_result(domain, status_str, counts[0], counts[1], counts[2], missing_eps)


## 视图侧契约密度审计
static func audit_view_density(view: String) -> Dictionary:
	IndexClass.ensure_loaded()
	var entries: Array = IndexClass.find_by_view(view)
	var domains_covered: Array[String] = []
	for e in entries:
		if not domains_covered.has(e.domain_name):
			domains_covered.append(e.domain_name)

	# 孤儿视图由配置登记的 reverse_orphans 驱动，优先取配置条目 domain_name，缺失时回退视图名并去重
	var orphan_domains: Array[String] = []
	var seen_orphans: Dictionary = {}
	for o in IndexClass.get_reverse_orphans():
		if String(o.get("view_name", "")) != view:
			continue
		var od: String = String(o.get("domain_name", ""))
		if od.is_empty():
			od = view
		if not seen_orphans.has(od):
			seen_orphans[od] = true
			orphan_domains.append(od)

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

	for e in all_entries:
		if e.infra_exempt and not infra_list.has(e.domain_name):
			violations.append({
				"contract_id": e.contract_id,
				"domain_name": e.domain_name,
				"reason": "infra_exempt is true but domain not in infra_domains"
			})
		elif not e.infra_exempt and infra_list.has(e.domain_name):
			violations.append({
				"contract_id": e.contract_id,
				"domain_name": e.domain_name,
				"reason": "domain is in infra_domains but infra_exempt is false"
			})

	return violations


static func _collect_breaking_changes(all_entries: Array) -> Array[Dictionary]:
	var breaking_pending: Array[Dictionary] = []
	for e in all_entries:
		if e.contract_version > 1 and not e.breaking_change_note.is_empty():
			breaking_pending.append({
				"contract_id": e.contract_id,
				"version": e.contract_version,
				"note": e.breaking_change_note
			})
	return breaking_pending


static func _collect_forward_orphans(all_entries: Array, domains_seen: Array[String]) -> Array[Dictionary]:
	var domains_with_view: Dictionary = {}
	for e in all_entries:
		if not e.view_name.is_empty():
			domains_with_view[e.domain_name] = true

	var forward_orphans: Array[Dictionary] = []
	for d in domains_seen:
		if not domains_with_view.has(d):
			forward_orphans.append({
				"domain_name": d,
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

	for e in all_entries:
		if not domains_seen.has(e.domain_name):
			domains_seen.append(e.domain_name)
		if not views_seen.has(e.view_name) and not e.view_name.is_empty():
			views_seen.append(e.view_name)

	for dom in domains_seen:
		var rep: Dictionary = audit_domain_coverage(dom)
		var st: String = rep.get("coverage_status", "MISSING")
		if by_status.has(st):
			by_status[st].append(dom)

	return {
		"total_domains": domains_seen.size(),
		"total_views": views_seen.size(),
		"by_status": by_status,
		"reverse_orphans": IndexClass.get_reverse_orphans(),
		"forward_orphans": _collect_forward_orphans(all_entries, domains_seen),
		"breaking_changes_pending": _collect_breaking_changes(all_entries),
		"infra_exempt_list": IndexClass.get_infra_domains()
	}
