# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/solvers/pagination_slice_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 内存集合分页切片算法求解器，严密计算总页数、首尾边界、游标与切片子集。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name PaginationSliceSolver
extends RefCounted

## 对源数组进行分页切片并返回标准 PagedResultDTO 载荷
## 守卫边界：防 null、防负数索引、尺寸钳制 1..50、防止切片超界
static func slice_array(source_array: Array, query: PaginationQueryDTO) -> PagedResultDTO:
	var result := PagedResultDTO.new()
	var effective_query := query
	if effective_query == null:
		effective_query = PaginationQueryDTO.make_default()

	var page_size: int = clampi(effective_query.page_size, PaginationQueryDTO.MIN_PAGE_SIZE, PaginationQueryDTO.MAX_PAGE_SIZE)
	var page_index: int = maxi(0, effective_query.page_index)

	result.page_index = page_index
	result.page_size = page_size

	if source_array == null or source_array.is_empty():
		result.total_count = 0
		result.total_pages = 0
		result.has_next = false
		result.has_prev = false
		result.next_cursor = ""
		result.items = []
		return result

	var total_count: int = source_array.size()
	result.total_count = total_count
	result.total_pages = ceili(float(total_count) / float(page_size))

	var start_idx: int = page_index * page_size
	if start_idx >= total_count:
		result.has_next = false
		result.has_prev = page_index > 0
		result.next_cursor = ""
		result.items = []
		return result

	var end_idx: int = mini(start_idx + page_size, total_count)
	result.items = source_array.slice(start_idx, end_idx)
	result.has_next = end_idx < total_count
	result.has_prev = page_index > 0
	result.next_cursor = str(page_index + 1) if result.has_next else ""

	return result
