# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_registry_entry.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 单一契约端点条目，承载 46 后端域 ↔ 17 前端视图之间的单一事实来源映射定义
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ContractRegistryEntry
extends Resource

enum EndpointKind {
	DTO,          # Domain DTO -> View ViewModel 转换契约
	EVENT,        # Domain Event -> View Signal 订阅契约
	COMMAND,      # View Command -> Domain Service 调用契约
	GM_READONLY   # INFRA 域 GM 只读契约入口
}

# ---- 契约标识 ----
@export var contract_id: String = ""          # 唯一 ID，格式：CT-{DOMAIN}-{VIEW}-{SEQ}
@export var contract_version: int = 1         # Inv-CT-3 整数递增版本号

# ---- 域 ↔ 视图 ↔ 端点三元坐标 ----
@export var domain_name: String = ""          # 后端域标识
@export var view_name: String = ""            # 前端视图标识
@export var endpoint_kind: EndpointKind = EndpointKind.DTO

# ---- 契约字段映射（DTO/Event 契约用）----
@export var source_path: String = ""          # 后端来源路径
@export var target_path: String = ""          # 前端目标路径
@export var field_mapping: Array = []          # [{backend_field, view_field, transform_kind, transform_config}]
@export var transform_kind: String = "identity"    # identity/cast/format/enum_map/aggregate/filter

# ---- 事件契约专属字段（Event 契约用）----
@export var event_name: String = ""           # EventBus 事件名
@export var signal_name: String = ""          # 前端 View 信号名
@export var event_filter: Dictionary = {}     # 事件过滤器（domain/actor/resource 前置匹配）

# ---- 命令契约专属字段（Command 契约用）----
@export var service_path: String = ""         # 后端 Service 全限定名
@export var method_name: String = ""          # 后端方法名
@export var params_schema: Array = []          # 参数 schema
@export var response_dto: String = ""         # 响应 DTO 类型名

# ---- 契约生命周期与审计 ----
@export var breaking_change_note: String = "" # 破坏性变更说明（Inv-CT-3）
@export var coverage_marker: String = ""       # 显式覆盖标记 ""/MISSING（Inv-CT-7，替代字符串魔法判定）
@export var infra_exempt: bool = false         # INFRA 域豁免标记（Inv-CT-6）
@export var deprecated: bool = false
@export var replacement_contract_id: String = ""
@export var created_at: String = ""
@export var last_reviewed_at: String = ""


## 对偶序列化：转换为字典 DTO
func to_dto() -> Dictionary:
	var kind_str := "DTO"
	match endpoint_kind:
		EndpointKind.DTO: kind_str = "DTO"
		EndpointKind.EVENT: kind_str = "EVENT"
		EndpointKind.COMMAND: kind_str = "COMMAND"
		EndpointKind.GM_READONLY: kind_str = "GM_READONLY"

	var clean_field_mapping: Array[Dictionary] = []
	for fm in field_mapping:
		clean_field_mapping.append(fm.duplicate(true))

	var clean_params_schema: Array[Dictionary] = []
	for ps in params_schema:
		clean_params_schema.append(ps.duplicate(true))

	return {
		"contract_id": contract_id,
		"contract_version": contract_version,
		"domain_name": domain_name,
		"view_name": view_name,
		"endpoint_kind": kind_str,
		"source_path": source_path,
		"target_path": target_path,
		"field_mapping": clean_field_mapping,
		"transform_kind": transform_kind,
		"event_name": event_name,
		"signal_name": signal_name,
		"event_filter": event_filter.duplicate(true),
		"service_path": service_path,
		"method_name": method_name,
		"params_schema": clean_params_schema,
		"response_dto": response_dto,
		"breaking_change_note": breaking_change_note,
		"coverage_marker": coverage_marker,
		"infra_exempt": infra_exempt,
		"deprecated": deprecated,
		"replacement_contract_id": replacement_contract_id,
		"created_at": created_at,
		"last_reviewed_at": last_reviewed_at
	}


## 对偶反序列化：从字典 DTO 构建条目（Inv-CT-4 容错降级与字段守卫）
static func from_dto(dict: Dictionary) -> Resource:
	var entry = new()
	if dict == null or dict.is_empty():
		return entry

	entry.contract_id = String(dict.get("contract_id", ""))
	entry.contract_version = int(dict.get("contract_version", 1))
	entry.domain_name = String(dict.get("domain_name", ""))
	entry.view_name = String(dict.get("view_name", ""))

	var kind_val = dict.get("endpoint_kind", "DTO")
	if kind_val is int:
		entry.endpoint_kind = kind_val as EndpointKind
	elif kind_val is String:
		match String(kind_val).to_upper():
			"DTO": entry.endpoint_kind = EndpointKind.DTO
			"EVENT": entry.endpoint_kind = EndpointKind.EVENT
			"COMMAND": entry.endpoint_kind = EndpointKind.COMMAND
			"GM_READONLY": entry.endpoint_kind = EndpointKind.GM_READONLY
			_: entry.endpoint_kind = EndpointKind.DTO
	else:
		entry.endpoint_kind = EndpointKind.DTO

	entry.source_path = String(dict.get("source_path", ""))
	entry.target_path = String(dict.get("target_path", ""))

	var raw_fm = dict.get("field_mapping", [])
	if raw_fm is Array:
		var parsed_fm: Array[Dictionary] = []
		for item in raw_fm:
			if item is Dictionary:
				parsed_fm.append((item as Dictionary).duplicate(true))
		entry.field_mapping = parsed_fm
	else:
		entry.field_mapping = []

	entry.transform_kind = String(dict.get("transform_kind", "identity"))
	entry.event_name = String(dict.get("event_name", ""))
	entry.signal_name = String(dict.get("signal_name", ""))

	var raw_ef = dict.get("event_filter", {})
	entry.event_filter = (raw_ef as Dictionary).duplicate(true) if raw_ef is Dictionary else {}

	entry.service_path = String(dict.get("service_path", ""))
	entry.method_name = String(dict.get("method_name", ""))

	var raw_ps = dict.get("params_schema", [])
	if raw_ps is Array:
		var parsed_ps: Array[Dictionary] = []
		for item in raw_ps:
			if item is Dictionary:
				parsed_ps.append((item as Dictionary).duplicate(true))
		entry.params_schema = parsed_ps
	else:
		entry.params_schema = []

	entry.response_dto = String(dict.get("response_dto", ""))
	entry.breaking_change_note = String(dict.get("breaking_change_note", ""))
	entry.coverage_marker = String(dict.get("coverage_marker", ""))
	entry.infra_exempt = bool(dict.get("infra_exempt", false))
	entry.deprecated = bool(dict.get("deprecated", false))
	entry.replacement_contract_id = String(dict.get("replacement_contract_id", ""))
	entry.created_at = String(dict.get("created_at", ""))
	entry.last_reviewed_at = String(dict.get("last_reviewed_at", ""))

	return entry
