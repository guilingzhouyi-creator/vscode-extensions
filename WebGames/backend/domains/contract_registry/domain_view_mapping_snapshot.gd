# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/domain_view_mapping_snapshot.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 46 后端域 × 17 前端视图映射的只读快照 DTO，承接审计报告四分类，供 CI 门禁与自检消费
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

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
	var status_str := "MISSING"
	match coverage_status:
		CoverageStatus.FULL: status_str = "FULL"
		CoverageStatus.PARTIAL: status_str = "PARTIAL"
		CoverageStatus.MISSING: status_str = "MISSING"
		CoverageStatus.INFRA: status_str = "INFRA"

	var views_copy: Array[String] = []
	for v in frontend_view_names:
		views_copy.append(v)

	var tabs_copy: Array[String] = []
	for t in frontend_tab_names:
		tabs_copy.append(t)

	var ids_copy: Array[String] = []
	for cid in contract_ids:
		ids_copy.append(cid)

	return {
		"domain_name": domain_name,
		"coverage_status": status_str,
		"backend_file_count": backend_file_count,
		"backend_static_method_count": backend_static_method_count,
		"frontend_view_names": views_copy,
		"frontend_tab_names": tabs_copy,
		"contract_ids": ids_copy
	}


## 从字典重建快照（覆盖状态单形态 String 契约，数组逐元素转型）
## 单形态契约：int 形态已退役——生产端恒产 String；非 String 一律 DtoShapeViolation 审计拒绝
static func from_dto(dict: Dictionary) -> Resource:
	var snap = new()
	if dict == null or dict.is_empty():
		return snap

	snap.domain_name = String(dict.get("domain_name", ""))
	var st = dict.get("coverage_status", "MISSING")
	if st is String:
		match String(st).to_upper():
			"FULL": snap.coverage_status = CoverageStatus.FULL
			"PARTIAL": snap.coverage_status = CoverageStatus.PARTIAL
			"MISSING": snap.coverage_status = CoverageStatus.MISSING
			"INFRA": snap.coverage_status = CoverageStatus.INFRA
			_: snap.coverage_status = CoverageStatus.MISSING
	else:
		push_warning("DtoShapeViolation: coverage_status 非 String 形态（%s），已按 MISSING 拒绝" % str(st))
		snap.coverage_status = CoverageStatus.MISSING

	snap.backend_file_count = int(dict.get("backend_file_count", 0))
	snap.backend_static_method_count = int(dict.get("backend_static_method_count", 0))

	var raw_v = dict.get("frontend_view_names", [])
	if raw_v is Array:
		var arr_v: Array[String] = []
		for item in raw_v:
			arr_v.append(String(item))
		snap.frontend_view_names = arr_v
	else:
		snap.frontend_view_names = []

	var raw_t = dict.get("frontend_tab_names", [])
	if raw_t is Array:
		var arr_t: Array[String] = []
		for item in raw_t:
			arr_t.append(String(item))
		snap.frontend_tab_names = arr_t
	else:
		snap.frontend_tab_names = []

	var raw_c = dict.get("contract_ids", [])
	if raw_c is Array:
		var arr_c: Array[String] = []
		for item in raw_c:
			arr_c.append(String(item))
		snap.contract_ids = arr_c
	else:
		snap.contract_ids = []

	return snap
