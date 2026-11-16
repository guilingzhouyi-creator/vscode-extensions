# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/config_router_engine.gd
# 架构定位: Generalized Configuration Router Engine
# 依赖与触发: 触发方: GameConfig.get_* 全局调用 | 上游: ConfigRouteDTO | 下游: 各领域子配置表
# 职责说明: 提供多配置表点分命名空间解析、兼容别名重定向与键路径智能分派。
# 退出语义与设计依据: 演进 01 超大型子域多配置表目录拆分与泛化路由架构
# ==============================================================================

## ConfigRouterEngine：Generalized Configuration Router Engine
class_name ConfigRouterEngine extends RefCounted

## 主表兼容别名映射（请求表名 -> 默认主子表）
static var _primary_aliases: Dictionary = {
	"domains.combat": "domains.combat.mechanics"
}


## 领域下辖子表注册表（领域表名 -> 包含的所有子表清单）
static var _domain_subtables: Dictionary = {
	"domains.combat": [
		"domains.combat.mechanics",
		"domains.combat.damage_formulas",
		"domains.combat.buff_definitions"
	]
}

## 键前缀路由规则表（请求表名 -> { 键前缀: 目标子表名 }）
static var _prefix_routes: Dictionary = {
	"domains.combat": {
		"kinetic": "domains.combat.damage_formulas",
		"phase_transition": "domains.combat.damage_formulas",
		"defense_multipliers": "domains.combat.damage_formulas",
		"buff_types": "domains.combat.buff_definitions",
		"resistance_coefficients": "domains.combat.buff_definitions",
		"dispel_rules": "domains.combat.buff_definitions"
	}
}

## 零分配高频路径表解析缓存（仅缓存路由映射表名，不缓存可变配置值）
static var _table_only_cache: Dictionary = {}
static var _prefix_table_cache: Dictionary = {}
static var _subtables_cache: Dictionary = {}

## 构造规范的点分子表名
static func build_subtable_key(root_layer: String, domain_id: String, subtable_name: String) -> String:
	return "%s.%s.%s" % [root_layer, domain_id, subtable_name]

## 判断给定表名是否为多表子域的子表
static func is_subtable(table_name: String) -> bool:
	var parts := table_name.split(".")
	return parts.size() >= 3

## 获取给定领域的全部子表清单（带静态列表缓存）
static func get_subtables_for_domain(domain_name: String) -> Array:
	if _domain_subtables.has(domain_name):
		return _domain_subtables[domain_name]
	if _subtables_cache.has(domain_name):
		return _subtables_cache[domain_name]
	var matching_subtables: Array = []
	if _primary_aliases.has(domain_name):
		matching_subtables = [_primary_aliases[domain_name]]
	elif domain_name.begins_with("domains."):
		var dot_index: int = domain_name.find(".", 8)
		if dot_index == -1:
			matching_subtables = [domain_name + ".core"]
	_subtables_cache[domain_name] = matching_subtables
	return matching_subtables

## 基础别名解析（单一表名）
static func resolve_table_name(requested_table: String) -> String:
	if _primary_aliases.has(requested_table):
		return _primary_aliases[requested_table]
	if _table_only_cache.has(requested_table):
		return _table_only_cache[requested_table]
	var resolved: String = requested_table
	if requested_table.begins_with("domains."):
		var dot_index: int = requested_table.find(".", 8)
		if dot_index == -1:
			resolved = requested_table + ".core"
	_table_only_cache[requested_table] = resolved
	return resolved

## 热路径零分配目标表名解析（免除 ConfigRouteDTO 构造与数组 split）
static func resolve_target_table(requested_table: String, path: String = "") -> String:
	if not _prefix_routes.has(requested_table):
		return resolve_table_name(requested_table)
	var slash_index: int = path.find("/")
	var first_segment: String = path.substr(0, slash_index) if slash_index >= 0 else path
	if not first_segment.is_empty():
		var cached_prefix_map: Variant = _prefix_table_cache.get(requested_table, null)
		if cached_prefix_map is Dictionary and (cached_prefix_map as Dictionary).has(first_segment):
			return String((cached_prefix_map as Dictionary)[first_segment])
		var prefix_map: Dictionary = _prefix_routes[requested_table]
		var target_subtable: String = prefix_map.get(first_segment, "")
		if not target_subtable.is_empty():
			if not _prefix_table_cache.has(requested_table):
				_prefix_table_cache[requested_table] = {}
			_prefix_table_cache[requested_table][first_segment] = target_subtable
			return target_subtable
	return resolve_table_name(requested_table)

## 全要素智能路由解析（表名 + 键路径 -> ConfigRouteDTO）
static func resolve_route(requested_table: String, path: String = "") -> ConfigRouteDTO:
	var route := ConfigRouteDTO.new(requested_table, requested_table, ConfigRouteDTO.RouteResolutionMode.DIRECT_PASSTHROUGH)
	var parts := requested_table.split(".")
	if parts.size() >= 2:
		route.root_layer = parts[0]
		route.domain_id = parts[1]
	if parts.size() >= 3:
		route.sub_table_id = parts[2]
		route.resolution_mode = ConfigRouteDTO.RouteResolutionMode.EXACT_SUBTABLE
		return route

	# 检查是否为多表子域别名，并基于键前缀分流
	if _prefix_routes.has(requested_table) and not path.is_empty():
		var first_segment := path.split("/")[0]
		var subtable_target: String = _prefix_routes[requested_table].get(first_segment, "")
		if not subtable_target.is_empty():
			route.resolved_table = subtable_target
			route.resolution_mode = ConfigRouteDTO.RouteResolutionMode.SUBTABLE_FALLBACK
			var subtable_parts := subtable_target.split(".")
			if subtable_parts.size() >= 3:
				route.sub_table_id = subtable_parts[2]
			return route

	# 回退至主表别名
	if _primary_aliases.has(requested_table):
		route.resolved_table = _primary_aliases[requested_table]
		route.resolution_mode = ConfigRouteDTO.RouteResolutionMode.LEGACY_COMPAT_ALIAS
		var alias_parts := route.resolved_table.split(".")
		if alias_parts.size() >= 3:
			route.sub_table_id = alias_parts[2]
		return route
	elif parts.size() == 2 and parts[0] == "domains":
		route.resolved_table = "%s.%s.core" % [parts[0], parts[1]]
		route.sub_table_id = "core"
		route.resolution_mode = ConfigRouteDTO.RouteResolutionMode.LEGACY_COMPAT_ALIAS
		return route

	return route
