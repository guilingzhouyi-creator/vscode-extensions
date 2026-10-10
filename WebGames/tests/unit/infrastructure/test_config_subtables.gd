# ==============================================================================
# 模块归属: 单元测试 (Tests · Infrastructure · Configuration Core)
# 文件路径: res://tests/unit/infrastructure/test_config_subtables.gd
# 架构定位: Multi-table Subdomain Routing & Resolution Test Suite
# 跨域依赖: 上游: TestRegistry | 下游: GameConfig, ConfigRouterEngine, ConfigRouteDTO, StorageResourceCatalog
# 职责说明: 演进 01 多配置表路由架构验收测试套件：验证点分命名空间解析、
#           兼容别名智能重定向、跨子表键寻址、get_many 分流聚合与细粒度热重载。
# 设计依据: 演进 01 超大型子域多配置表目录拆分与泛化路由架构阶段4验收指标
# ==============================================================================

class_name TestConfigSubtablesDomain extends RefCounted

const ConfigRouteDTO = preload("res://backend/infrastructure/config_route_dto.gd")
const ConfigRouterEngine = preload("res://backend/infrastructure/config_router_engine.gd")
const StorageResourceCatalog = preload("res://backend/domains/persistence_protocol/storage_resource_catalog.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_subtable_resolution_and_alias())
	results.append(test_subtable_value_access())
	results.append(test_subtable_get_many())
	results.append(test_subtable_has_key())
	results.append(test_subtable_hot_reload())
	results.append(test_subtable_key_builder())
	results.append(test_storage_catalog_subtables())
	results.append(test_table_path_multi_level())
	results.append(test_generic_alias_resolution_without_primary_map())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break

	return {
		"domain": "Infrastructure: 多配置表路由与动态子表解析",
		"all_passed": all_passed,
		"results": results
	}

static func test_subtable_resolution_and_alias() -> Dictionary:
	var resolved := ConfigRouterEngine.resolve_table_name("domains.combat")
	var ok_alias: bool = (resolved == "domains.combat.mechanics")

	var r_kinetic = ConfigRouterEngine.resolve_route("domains.combat", "kinetic/energy_coef")
	var ok_kinetic: bool = (r_kinetic.resolved_table == "domains.combat.damage_formulas")

	var r_buff = ConfigRouterEngine.resolve_route("domains.combat", "buff_types/bleed")
	var ok_buff: bool = (r_buff.resolved_table == "domains.combat.buff_definitions")

	var r_mech = ConfigRouterEngine.resolve_route("domains.combat", "participant_defaults/hp")
	var ok_mech: bool = (r_mech.resolved_table == "domains.combat.mechanics")

	var passed: bool = ok_alias and ok_kinetic and ok_buff and ok_mech
	return { "test": "TC-SUB-01: 子表向后兼容别名与键前缀动态路由解析", "passed": passed }

static func test_subtable_value_access() -> Dictionary:
	var direct_coef: float = GameConfig.get_float("domains.combat.damage_formulas", "kinetic/energy_coef", 0.0)
	var compat_coef: float = GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.0)
	var direct_hp: float = GameConfig.get_float("domains.combat.mechanics", "participant_defaults/hp", 0.0)
	var compat_hp: float = GameConfig.get_float("domains.combat", "participant_defaults/hp", 0.0)

	var ok_kinetic: bool = (absf(direct_coef - 0.5) < 0.0001 and absf(compat_coef - 0.5) < 0.0001)
	var ok_hp: bool = (absf(direct_hp - 100.0) < 0.0001 and absf(compat_hp - 100.0) < 0.0001)
	var passed: bool = ok_kinetic and ok_hp
	return { "test": "TC-SUB-02: 子表全名直读与旧表名兼容路由读取等价", "passed": passed }

static func test_subtable_get_many() -> Dictionary:
	var paths := PackedStringArray([
		"participant_defaults/hp",
		"kinetic/energy_coef",
		"nonexistent/deep/path"
	])
	var many := GameConfig.get_many("domains.combat", paths)
	var count_ok: bool = (many.size() == 2)
	var hp_ok: bool = (absf(float(many.get("participant_defaults/hp", 0.0)) - 100.0) < 0.0001)
	var kinetic_ok: bool = (absf(float(many.get("kinetic/energy_coef", 0.0)) - 0.5) < 0.0001)
	var passed: bool = count_ok and hp_ok and kinetic_ok
	return { "test": "TC-SUB-03: get_many 跨子表智能分流聚合与缺失键过滤", "passed": passed }

static func test_subtable_has_key() -> Dictionary:
	var has_mech: bool = GameConfig.has("domains.combat", "participant_defaults/hp")
	var has_dmg: bool = GameConfig.has("domains.combat", "kinetic/energy_coef")
	var has_buff: bool = GameConfig.has("domains.combat", "buff_types/bleed/name")
	var has_none: bool = not GameConfig.has("domains.combat", "nonexistent/impossible/path")
	var passed: bool = has_mech and has_dmg and has_buff and has_none
	return { "test": "TC-SUB-04: has 跨子表存在性探测与默认兜底", "passed": passed }

static func test_subtable_hot_reload() -> Dictionary:
	var res := GameConfig.reload_subtable("domains.combat.damage_formulas")
	var ok_res: bool = bool(res.get("success", false))
	var ok_name: bool = (str(res.get("subtable", "")) == "domains.combat.damage_formulas")
	var ok_ver: bool = (int(res.get("version", -1)) > 0)
	var passed: bool = ok_res and ok_name and ok_ver
	return { "test": "TC-SUB-05: 单子表原子置换与细粒度热重载广播", "passed": passed }

static func test_subtable_key_builder() -> Dictionary:
	var key := ConfigRouterEngine.build_subtable_key("domains", "combat", "damage_formulas")
	var passed: bool = (key == "domains.combat.damage_formulas")
	return { "test": "TC-SUB-06: 点分子表命名空间键构建自洽", "passed": passed }

static func test_storage_catalog_subtables() -> Dictionary:
	var catalog = StorageResourceCatalog.get_instance()
	var entry = catalog.resolve_config_table_entry("domains.combat.damage_formulas")
	var entry_ok: bool = (entry != null)
	var path_ok: bool = false
	if entry != null:
		path_ok = (str(entry.physical_path) == "res://config/domains/combat/damage_formulas.json")
	var passed: bool = entry_ok and path_ok
	return { "test": "TC-SUB-07: 统一存储目录中心对子表索引与物理寻址自洽", "passed": passed }

static func test_table_path_multi_level() -> Dictionary:
	var is_sub: bool = ConfigRouterEngine.is_subtable("domains.combat.mechanics")
	var not_sub: bool = not ConfigRouterEngine.is_subtable("domains.inventory")
	var passed: bool = is_sub and not_sub
	return { "test": "TC-SUB-08: 多级子表分段判定与单表直通识别", "passed": passed }

static func test_generic_alias_resolution_without_primary_map() -> Dictionary:
	var resolved_inv := ConfigRouterEngine.resolve_table_name("domains.inventory")
	var resolved_acc := ConfigRouterEngine.resolve_table_name("domains.account")
	var resolved_cbt := ConfigRouterEngine.resolve_table_name("domains.combat")
	var ok_inv: bool = (resolved_inv == "domains.inventory.core")
	var ok_acc: bool = (resolved_acc == "domains.account.core")
	var ok_cbt: bool = (resolved_cbt == "domains.combat.mechanics")
	var passed: bool = ok_inv and ok_acc and ok_cbt
	return {
		"test": "TC-SUB-09: 通用别名规则自然承接子表解析（52条冗余别名消融断言 Inv-BC2-1）",
		"passed": passed
	}

