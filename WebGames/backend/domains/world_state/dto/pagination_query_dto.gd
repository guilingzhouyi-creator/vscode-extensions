# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/pagination_query_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 分页与游标查询请求传输对象，定义通用切片参数与边界守卫。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name PaginationQueryDTO
extends RefCounted

const MIN_PAGE_SIZE: int = 1
const MAX_PAGE_SIZE: int = 50
const DEFAULT_PAGE_SIZE: int = 10

var page_index: int = 0
var page_size: int = DEFAULT_PAGE_SIZE
var cursor_token: String = ""
var filter_tag: String = ""

func _init(p_page_index: int = 0, p_page_size: int = DEFAULT_PAGE_SIZE, p_cursor: String = "", p_filter: String = "") -> void:
	page_index = maxi(0, p_page_index)
	page_size = clampi(p_page_size, MIN_PAGE_SIZE, MAX_PAGE_SIZE)
	cursor_token = p_cursor
	filter_tag = p_filter

func to_dto() -> Dictionary:
	return {
		"page_index": page_index,
		"page_size": page_size,
		"cursor_token": cursor_token,
		"filter_tag": filter_tag
	}

static func from_dto(data: Dictionary) -> PaginationQueryDTO:
	var raw_index := int(data.get("page_index", 0))
	var raw_size := int(data.get("page_size", DEFAULT_PAGE_SIZE))
	var cursor := String(data.get("cursor_token", ""))
	var filter := String(data.get("filter_tag", ""))
	return PaginationQueryDTO.new(raw_index, raw_size, cursor, filter)

static func make_default(size: int = DEFAULT_PAGE_SIZE) -> PaginationQueryDTO:
	return PaginationQueryDTO.new(0, size, "", "")
