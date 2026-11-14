# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/paged_result_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 分页查询响应结果传输对象，携带切片数据与翻页元数据。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PagedResultDTO：Value Object DTO / Data Transport Model
class_name PagedResultDTO
extends RefCounted

var page_index: int = 0
var page_size: int = 10
var total_count: int = 0
var total_pages: int = 0
var has_next: bool = false
var has_prev: bool = false
var next_cursor: String = ""
var items: Array = []

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"page_index": page_index,
		"page_size": page_size,
		"total_count": total_count,
		"total_pages": total_pages,
		"has_next": has_next,
		"has_prev": has_prev,
		"next_cursor": next_cursor,
		"items": items.duplicate()
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> PagedResultDTO:
	var paged_result := PagedResultDTO.new()
	paged_result.page_index = maxi(0, int(serialized_payload.get("page_index", 0)))
	paged_result.page_size = maxi(1, int(serialized_payload.get("page_size", 10)))
	paged_result.total_count = maxi(0, int(serialized_payload.get("total_count", 0)))
	paged_result.total_pages = maxi(0, int(serialized_payload.get("total_pages", 0)))
	paged_result.has_next = bool(serialized_payload.get("has_next", false))
	paged_result.has_prev = bool(serialized_payload.get("has_prev", false))
	paged_result.next_cursor = String(serialized_payload.get("next_cursor", ""))
	var raw_items: Variant = serialized_payload.get("items", [])
	if raw_items is Array:
		paged_result.items = raw_items.duplicate()
	return paged_result
