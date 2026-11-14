# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/domain_view_mapping_snapshot.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 46 后端域 × 17 前端视图映射的只读快照 DTO，承接审计报告四分类，供 CI 门禁与自检消费
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## DomainViewMappingSnapshot：Value Object DTO / Data Transport Model
class_name DomainViewMappingSnapshot
extends Resource

enum CoverageStatus {
	FULL,           # 完全覆盖
	PARTIAL,        # 部分覆盖
	MISSING,        # 完全缺失
	INFRA           # INFRA 后台服务（豁免）
}

@export var domain_name: String = ""
@export var coverage_status: CoverageStatus = CoverageStatus.MISSING
@export var backend_file_count: int = 0
@export var backend_static_method_count: int = 0
@export var frontend_view_names: Array[String] = []
@export var frontend_tab_names: Array[String] = []
@export var contract_ids: Array[String] = []  # 关联的契约条目 ID 列表


## 序列化快照为字典（覆盖状态枚举转字符串 + 三数组副本）
func to_dto() -> Dictionary:
	var status_label := "MISSING"
	match coverage_status:
		CoverageStatus.FULL: status_label = "FULL"
		CoverageStatus.PARTIAL: status_label = "PARTIAL"
		CoverageStatus.MISSING: status_label = "MISSING"
		CoverageStatus.INFRA: status_label = "INFRA"

	var views_copy: Array[String] = []
	for view_name in frontend_view_names:
		views_copy.append(view_name)

	var tabs_copy: Array[String] = []
	for tab_name in frontend_tab_names:
		tabs_copy.append(tab_name)

	var ids_copy: Array[String] = []
	for contract_id in contract_ids:
		ids_copy.append(contract_id)

	return {
		"domain_name": domain_name,
		"coverage_status": status_label,
		"backend_file_count": backend_file_count,
		"backend_static_method_count": backend_static_method_count,
		"frontend_view_names": views_copy,
		"frontend_tab_names": tabs_copy,
		"contract_ids": ids_copy
	}


## 从字典重建快照（覆盖状态单形态 String 契约，数组逐元素转型）
## 单形态契约：int 形态已退役——生产端恒产 String；非 String 一律 DtoShapeViolation 审计拒绝
static func from_dto(dict: Dictionary) -> Resource:
	var snapshot := new()
	if dict == null or dict.is_empty():
		return snapshot

	snapshot.domain_name = String(dict.get("domain_name", ""))
	var raw_status: Variant = dict.get("coverage_status", "MISSING")
	if raw_status is String:
		match String(raw_status).to_upper():
			"FULL": snapshot.coverage_status = CoverageStatus.FULL
			"PARTIAL": snapshot.coverage_status = CoverageStatus.PARTIAL
			"MISSING": snapshot.coverage_status = CoverageStatus.MISSING
			"INFRA": snapshot.coverage_status = CoverageStatus.INFRA
			_: snapshot.coverage_status = CoverageStatus.MISSING
	else:
		EventBusCore.get_instance().emit_log("warn", TemplateFormatter.format("DtoShapeViolation: coverage_status is not String ({type}), rejected as MISSING", {"type": str(raw_status)}))
		snapshot.coverage_status = CoverageStatus.MISSING

	snapshot.backend_file_count = int(dict.get("backend_file_count", 0))
	snapshot.backend_static_method_count = int(dict.get("backend_static_method_count", 0))

	var raw_views: Variant = dict.get("frontend_view_names", [])
	if raw_views is Array:
		var parsed_views: Array[String] = []
		for item in raw_views:
			parsed_views.append(String(item))
		snapshot.frontend_view_names = parsed_views
	else:
		snapshot.frontend_view_names = []

	var raw_tabs: Variant = dict.get("frontend_tab_names", [])
	if raw_tabs is Array:
		var parsed_tabs: Array[String] = []
		for item in raw_tabs:
			parsed_tabs.append(String(item))
		snapshot.frontend_tab_names = parsed_tabs
	else:
		snapshot.frontend_tab_names = []

	var raw_contracts: Variant = dict.get("contract_ids", [])
	if raw_contracts is Array:
		var parsed_contracts: Array[String] = []
		for item in raw_contracts:
			parsed_contracts.append(String(item))
		snapshot.contract_ids = parsed_contracts
	else:
		snapshot.contract_ids = []

	return snapshot
