# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/config_route_dto.gd
# 架构定位: Configuration Routing DTO
# 职责说明: 封装多配置表点分命名空间解析、别名重定向与路由模式元数据。
# 设计依据: 演进 01 超大型子域多配置表目录拆分与泛化路由架构
# ==============================================================================

class_name ConfigRouteDTO extends RefCounted

## 路由解析模式枚举
enum RouteResolutionMode {
	EXACT_SUBTABLE,      # 精确子表匹配 (如 "domains.combat.damage_formulas")
	LEGACY_COMPAT_ALIAS, # 向后兼容单表别名重定向 (如 "domains.combat" -> "domains.combat.mechanics")
	SUBTABLE_FALLBACK,   # 子表跨表路径回退 (如 "domains.combat" 下寻址 "kinetic/energy_coef" 回退到 damage_formulas)
	DIRECT_PASSTHROUGH   # 未拆分子表直通（适用于未分级的通用基础设施表）
}

var root_layer: String = ""              # infrastructure / domains / frontend / narratives
var domain_id: String = ""               # 领域标识 (如 "combat")
var sub_table_id: String = ""            # 子表标识 (如 "damage_formulas" / "mechanics")
var requested_table: String = ""         # 原始调用请求表名 (如 "domains.combat")
var resolved_table: String = ""          # 解析后物理表名 (如 "domains.combat.damage_formulas")
var resolved_path: String = ""           # 解析后目标键路径
var resolution_mode: int = RouteResolutionMode.DIRECT_PASSTHROUGH

func _init(p_requested: String = "", p_resolved: String = "", p_mode: int = RouteResolutionMode.DIRECT_PASSTHROUGH) -> void:
	requested_table = p_requested
	resolved_table = p_resolved
	resolution_mode = p_mode

## 序列化为纯字典
func to_dict() -> Dictionary:
	return {
		"root_layer": root_layer,
		"domain_id": domain_id,
		"sub_table_id": sub_table_id,
		"requested_table": requested_table,
		"resolved_table": resolved_table,
		"resolved_path": resolved_path,
		"resolution_mode": resolution_mode
	}

## 从字典安全反序列化（使用 RefCounted 动态实例化，防御未注册类缓存）
static func from_dict(data: Dictionary) -> RefCounted:
	var route: RefCounted = new()
	route.set("root_layer", str(data.get("root_layer", "")))
	route.set("domain_id", str(data.get("domain_id", "")))
	route.set("sub_table_id", str(data.get("sub_table_id", "")))
	route.set("requested_table", str(data.get("requested_table", "")))
	route.set("resolved_table", str(data.get("resolved_table", "")))
	route.set("resolved_path", str(data.get("resolved_path", "")))
	route.set("resolution_mode", int(data.get("resolution_mode", RouteResolutionMode.DIRECT_PASSTHROUGH)))
	return route
