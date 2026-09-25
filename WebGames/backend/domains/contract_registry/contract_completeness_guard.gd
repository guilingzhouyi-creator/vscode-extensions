# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_completeness_guard.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 46 域 × 17 视图映射的双向校验、MISSING/PARTIAL 运行时可见化、破坏性变更与孤儿视图审计
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
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


## 域侧覆盖度审计
static func audit_domain_coverage(domain: String) -> Dictionary:
	IndexClass.ensure_loaded()
	var infra_list: Array = IndexClass.get_infra_domains()
	if infra_list.has(domain):
		return {
			"domain": domain,
			"coverage_status": "INFRA",
			"dto_count": 0,
			"event_count": 0,
			"command_count": 0,
			"missing_endpoints": []
		}

	var entries: Array = IndexClass.find_by_domain(domain)
	if entries.is_empty():
		return {
			"domain": domain,
			"coverage_status": "MISSING",
			"dto_count": 0,
			"event_count": 0,
			"command_count": 0,
			"missing_endpoints": ["DTO", "EVENT", "COMMAND"]
		}

	var dto_cnt := 0
	var ev_cnt := 0
	var cmd_cnt := 0
	var exempt_cnt := 0
	var missing_marker := false

	for e in entries:
		# S4：INFRA 豁免聚合判定——全部条目豁免才视为 INFRA（不再被首个豁免条目短路）
		if e.infra_exempt:
			exempt_cnt += 1
			continue
		# I2：显式 coverage_marker 标记 MISSING（替代 breaking_change_note 字符串魔法判定）
		if e.coverage_marker == "MISSING":
			missing_marker = true
			break

		if not e.source_path.is_empty() or e.endpoint_kind == EntryClass.EndpointKind.DTO:
			dto_cnt += 1
		if not e.event_name.is_empty() or e.endpoint_kind == EntryClass.EndpointKind.EVENT:
			ev_cnt += 1
		if not e.service_path.is_empty() or e.endpoint_kind == EntryClass.EndpointKind.COMMAND:
			cmd_cnt += 1

	if exempt_cnt == entries.size():
		return {
			"domain": domain,
			"coverage_status": "INFRA",
			"dto_count": 0,
			"event_count": 0,
			"command_count": 0,
			"missing_endpoints": []
		}

	if missing_marker:
		return {
			"domain": domain,
			"coverage_status": "MISSING",
			"dto_count": 0,
			"event_count": 0,
			"command_count": 0,
			"missing_endpoints": ["DTO", "EVENT", "COMMAND"]
		}

	var missing_eps: Array[String] = []
	if dto_cnt == 0: missing_eps.append("DTO")
	if ev_cnt == 0: missing_eps.append("EVENT")
	if cmd_cnt == 0: missing_eps.append("COMMAND")

	var status_str := "FULL"
	if missing_eps.size() > 0:
		status_str = "PARTIAL"

	return {
		"domain": domain,
		"coverage_status": status_str,
		"dto_count": dto_cnt,
		"event_count": ev_cnt,
		"command_count": cmd_cnt,
		"missing_endpoints": missing_eps
	}


## 视图侧契约密度审计
static func audit_view_density(view: String) -> Dictionary:
	IndexClass.ensure_loaded()
	var entries: Array = IndexClass.find_by_view(view)
	var domains_covered: Array[String] = []
	for e in entries:
		if not domains_covered.has(e.domain_name):
			domains_covered.append(e.domain_name)

	# I1：孤儿视图由配置登记的 reverse_orphans 驱动（不再硬编码 world_map 特例）
	# P2-3/4 修复：优先取配置条目 domain_name（孤儿域语义），缺失时回退视图名并去重，
	# 避免多孤儿同视图时重复累积查询键
	var orphan_domains: Array[String] = []
	var seen_orphans: Dictionary = {}
	for o in IndexClass.get_reverse_orphans():
		if String(o.get("view_name", "")) != view:
			continue
		var od := String(o.get("domain_name", ""))
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


## 全域一致性扫描（CI 消费，DoD 核心基准）
static func audit_full_registry() -> Dictionary:
	IndexClass.ensure_loaded()
	var all_entries: Array = IndexClass.find_all()

	var domains_seen: Array[String] = []
	var views_seen: Array[String] = []
	var by_status := {
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
		var rep := audit_domain_coverage(dom)
		var st: String = rep.get("coverage_status", "MISSING")
		if by_status.has(st):
			by_status[st].append(dom)

	# I1：reverse_orphan 取自配置登记（ContractRegistryIndex.get_reverse_orphans），审计不再硬编码
	var reverse_orphans: Array[Dictionary] = IndexClass.get_reverse_orphans()

	var breaking_pending: Array[Dictionary] = []
	for e in all_entries:
		if e.contract_version > 1 and not e.breaking_change_note.is_empty():
			breaking_pending.append({
				"contract_id": e.contract_id,
				"version": e.contract_version,
				"note": e.breaking_change_note
			})

	# I1：forward_orphan（后端域无任何视图映射）由数据推导（预置哈希集合，降阶至 O(D + E)）
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

	return {
		"total_domains": domains_seen.size(),
		"total_views": views_seen.size(),
		"by_status": by_status,
		"reverse_orphans": reverse_orphans,
		"forward_orphans": forward_orphans,
		"breaking_changes_pending": breaking_pending,
		"infra_exempt_list": IndexClass.get_infra_domains()
	}
