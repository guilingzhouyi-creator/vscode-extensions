# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/item_statistics/item_statistics_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_statistics.json | 信号: EventBus 领域广播
# 职责说明: 物品全生命周期事件契约（获得/消耗/销毁/交易/锻造/追缴）： - 事件接入 record_item_event：更新账号 UID 物品 ID 库（递归挂载/落账）+ 旁路遥测 TelemetrySidecarEngine 落点； - 查询按账号 UID 隔离（直接操作该账号的库）；跨账号全局聚合需 RBAC 门禁； - 事件名约定 "<域>.<事件>"（与 EventBus 领域事件约定一致）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemStatisticsSolver
extends RefCounted

const EVENT_ITEM_GRANTED: String = "item.granted"
const EVENT_ITEM_CONSUMED: String = "item.consumed"
const EVENT_ITEM_DESTROYED: String = "item.destroyed"
const EVENT_ITEM_TRADED: String = "item.traded"
const EVENT_ITEM_FORGED: String = "item.forged"
const EVENT_ITEM_CLAWED_BACK: String = "item.clawed_back"

## 事件 → 库统计键 映射（获得/锻造 增加当前持有；其余扣减且下限 0）
const EVENT_TO_STAT_KEY := {
	EVENT_ITEM_GRANTED: AccountItemLibraryAggregate.STAT_GAINED,
	EVENT_ITEM_CONSUMED: AccountItemLibraryAggregate.STAT_CONSUMED,
	EVENT_ITEM_DESTROYED: AccountItemLibraryAggregate.STAT_DESTROYED,
	EVENT_ITEM_TRADED: AccountItemLibraryAggregate.STAT_TRADED,
	EVENT_ITEM_FORGED: AccountItemLibraryAggregate.STAT_FORGED,
	EVENT_ITEM_CLAWED_BACK: AccountItemLibraryAggregate.STAT_CLAWED_BACK
}

## 事件接入：更新账号物品库（递归挂载 + 落账）并经遥测旁路记录。
## catalog 用于解析物品分类（category_major/category_minor）建树；telemetry 可空注入（测试确定性）。
static func record_item_event(
	library: AccountItemLibraryAggregate,
	event_name: String,
	canonical_id: String,
	quantity: int,
	catalog: ItemRegistryCatalog = null,
	telemetry: TelemetrySidecarEngine = null,
	meta: Dictionary = {}
) -> Dictionary:
	if not GameConfig.get_bool("domains.item_statistics", "enabled", true):
		return { "success": false, "reason": "item_statistics disabled" }
	if not EVENT_TO_STAT_KEY.has(event_name) or quantity <= 0:
		return { "success": false, "reason": "invalid event" }

	var major := "UNCATEGORIZED"
	var minor := "UNSPECIFIED"
	if catalog != null:
		var proto = catalog.get_prototype(canonical_id)
		if proto != null:
			major = proto.category_major
			minor = proto.category_minor

	library.mount_item(canonical_id, major, minor)
	var applied = library.apply_item_delta(canonical_id, EVENT_TO_STAT_KEY[event_name], quantity)

	# 旁路遥测落点（可空注入；环形缓冲 + 批量刷盘由 TelemetrySidecarEngine 承担）
	if telemetry != null and GameConfig.get_bool("domains.item_statistics", "telemetry/record_to_sidecar", true):
		var payload := {
			"canonical_id": canonical_id,
			"quantity": int(applied.get("actual_quantity", quantity)),
			"category_major": major,
			"category_minor": minor
		}
		for k in meta:
			payload[k] = meta[k]
		telemetry.record_event(event_name, library.account_id, payload)

	return {
		"success": true,
		"canonical_id": canonical_id,
		"event": event_name,
		"actual_quantity": int(applied.get("actual_quantity", quantity))
	}

# ==============================================================================
# 查询（按账号 UID 隔离：仅操作该账号自己的库）
# ==============================================================================

static func query_account_item_stats(library: AccountItemLibraryAggregate, canonical_id: String) -> Dictionary:
	var found := library.find_item_node(canonical_id)
	if found.is_empty():
		return { "found": false, "canonical_id": canonical_id }
	return { "found": true, "canonical_id": canonical_id, "stats": found["node"]["stats"].duplicate() }

static func query_account_subtree(
	library: AccountItemLibraryAggregate,
	category_major: String = "",
	category_minor: String = ""
) -> Dictionary:
	return library.query_subtree(category_major, category_minor)

static func query_account_all(library: AccountItemLibraryAggregate) -> Array:
	return library.query_all_items()

# ==============================================================================
# 全局聚合（跨账号，按 canonical_id）：RBAC 门禁
# ==============================================================================

static func query_global_item_stats(
	libraries: Array,
	canonical_id: String,
	admin_level: int = 0
) -> Dictionary:
	if admin_level < _min_global_level():
		return { "success": false, "error_code": "STATS_GLOBAL_FORBIDDEN" }
	var agg := {
		"current_quantity": 0, "total_gained": 0, "total_consumed": 0, "total_destroyed": 0,
		"total_traded": 0, "total_forged": 0, "total_clawed_back": 0, "account_count": 0
	}
	for lib in libraries:
		var found: Dictionary = lib.find_item_node(canonical_id)
		if found.is_empty():
			continue
		var stats: Dictionary = found["node"]["stats"]
		for k in AccountItemLibraryAggregate.STAT_KEYS:
			agg[k] = int(agg[k]) + int(stats.get(k, 0))
		agg["account_count"] = int(agg["account_count"]) + 1
	return { "success": true, "canonical_id": canonical_id, "agg": agg }

# ==============================================================================
# 配置
# ==============================================================================

static func _min_global_level() -> int:
	return GameConfig.get_int("domains.item_statistics", "global_query_min_level", 2)
