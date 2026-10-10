# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/config_router_engine.gd
# 架构定位: Generalized Configuration Router Engine
# 职责说明: 提供多配置表点分命名空间解析、兼容别名重定向与键路径智能分派。
# 设计依据: 演进 01 超大型子域多配置表目录拆分与泛化路由架构
# ==============================================================================

class_name ConfigRouterEngine extends RefCounted

const ConfigRouteDTO = preload("res://backend/infrastructure/config_route_dto.gd")

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

## 构造规范的点分子表名
static func build_subtable_key(root_layer: String, domain_id: String, sub_table: String) -> String:
	return "%s.%s.%s" % [root_layer, domain_id, sub_table]

## 判断给定表名是否为多表子域的子表
static func is_subtable(table_name: String) -> bool:
	var parts := table_name.split(".")
	return parts.size() >= 3

## 获取给定领域的全部子表清单
static func get_subtables_for_domain(domain_name: String) -> Array:
	if _domain_subtables.has(domain_name):
		return _domain_subtables[domain_name]
	if _primary_aliases.has(domain_name):
		return [_primary_aliases[domain_name]]
	var parts := domain_name.split(".")
	if parts.size() == 2 and parts[0] == "domains":
		return ["%s.%s.core" % [parts[0], parts[1]]]
	return []

## 基础别名解析（单一表名）
static func resolve_table_name(requested_table: String) -> String:
	if _primary_aliases.has(requested_table):
		return _primary_aliases[requested_table]
	var parts := requested_table.split(".")
	if parts.size() == 2 and parts[0] == "domains":
		return "%s.%s.core" % [parts[0], parts[1]]
	return requested_table

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
		var first_seg := path.split("/")[0]
		var subtable_target: String = _prefix_routes[requested_table].get(first_seg, "")
		if not subtable_target.is_empty():
			route.resolved_table = subtable_target
			route.resolution_mode = ConfigRouteDTO.RouteResolutionMode.SUBTABLE_FALLBACK
			var sub_parts := subtable_target.split(".")
			if sub_parts.size() >= 3:
				route.sub_table_id = sub_parts[2]
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
