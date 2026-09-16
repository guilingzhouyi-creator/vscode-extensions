# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_migration_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 负责三级版本模型（Domain/Schema/Save）检测、链式演进调度、 迁移后校验与原子回滚机制，严格不破坏旧档（Inv-SV-4/7）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name SaveMigrationEngine extends RefCounted

const SaveValidationService = preload("res://backend/domains/persistence_protocol/save_validation_service.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")

static var _domain_migrations: Dictionary = {} # key = "domain:ver" -> { "to": int, "fn": Callable }

## 注册域级数据迁移（单域独立演进，Inv-SV-4）
static func register_domain_migration(domain_id: String, from_ver: int, to_ver: int, migrate_fn: Callable) -> void:
	var key := "%s:%d" % [domain_id, from_ver]
	_domain_migrations[key] = { "to": to_ver, "fn": migrate_fn }

## 检查是否存在域级迁移
static func has_domain_migration(mig_key: String) -> bool:
	return _domain_migrations.has(mig_key)

## 获取域级迁移条目
static func get_domain_migration(mig_key: String) -> Dictionary:
	return _domain_migrations.get(mig_key, {})

## 域级独立迁移算法：单域版本演进，不触碰整档 Save Version（Inv-SV-4）
static func migrate_domain(domain_id: String, domain_data: Dictionary, from_ver: int) -> Dictionary:
	var contract: Variant = SaveDataAccessLayer.get_contract(domain_id)
	var target_ver: int = int(contract.domain_version) if contract != null else from_ver
	var working := domain_data.duplicate(true)
	var ver: int = from_ver

	while ver < target_ver:
		var mig_key := "%s:%d" % [domain_id, ver]
		if not has_domain_migration(mig_key):
			return {
				"success": false,
				"error_code": "DOMAIN_MIGRATION_PATH_BROKEN",
				"domain_id": domain_id,
				"at_version": ver,
				"target_version": target_ver
			}
		var step: Dictionary = get_domain_migration(mig_key)
		var fn: Callable = step.get("fn", Callable())
		if not fn.is_valid():
			return {
				"success": false,
				"error_code": "DOMAIN_MIGRATION_PATH_BROKEN",
				"domain_id": domain_id
			}
		var step_result: Variant = fn.call(working)
		if step_result is Dictionary:
			working = step_result as Dictionary
		ver = int(step.get("to", ver + 1))

	return { "success": true, "data": working, "final_version": ver }

## 整档迁移执行：复制 -> 链式迁移 -> 校验 -> 提交/回滚（Inv-SV-7）
static func migrate(data: Dictionary, detected_version: String) -> Dictionary:
	var target_version: String = GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	if detected_version.is_empty() or detected_version == target_version:
		return { "success": true, "data": data.duplicate(true), "steps": [] }

	# 1. 深度复制工作副本，绝不原地污染（Inv-SV-7）
	var working: Dictionary = data.duplicate(true)
	var result: Dictionary = GameSaveAssembler.migrate_save_data(working, detected_version)
	if not bool(result.get("compatible", false)):
		return {
			"success": false,
			"error_code": "MIGRATION_PATH_BROKEN",
			"at_version": result.get("version", detected_version),
			"partial": result.get("data", working)
		}

	var migrated_data: Dictionary = result.get("data", working)

	# 2. 迁移后校验（缺失字段补充默认值，格式不符丢弃/报错）
	var validation: Dictionary = SaveValidationService.validate_domains(migrated_data)
	if not bool(validation.get("is_valid", true)):
		return {
			"success": false,
			"error_code": "MIGRATION_VALIDATION_FAIL",
			"issues": validation.get("issues", []),
			"partial": migrated_data
		}

	var steps: Array = [detected_version]
	return {
		"success": true,
		"data": validation.get("sanitized", migrated_data),
		"steps": steps
	}

## 从配置加载迁移链规则（Inv-SV-13）：解析 migration_rules 段并静态校验链连续性
## 返回 { "success": bool, "chain": Array[String], "issues": Array[String] }
static func load_rules_from_config() -> Dictionary:
	var rules: Dictionary = GameConfig.get_dict("infrastructure.persistence", "migration_rules", {})
	if not bool(rules.get("enabled", true)):
		return { "success": true, "chain": [], "issues": [] }
	var chain: Array = rules.get("save_version_chain", [])
	var issues: Array[String] = []
	var current := GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	if chain.is_empty():
		issues.append("CHAIN_EMPTY")
	if not chain.has(current):
		issues.append("CHAIN_MISSING_CURRENT_%s" % current)
	# 静态校验：整档迁移链相邻版本间必须已注册迁移函数（GameSaveAssembler 注册表）
	for i in range(chain.size() - 1):
		var from_v := String(chain[i])
		if not GameSaveAssembler.has_migration(from_v):
			issues.append("MISSING_MIGRATION_%s" % from_v)
	if issues.is_empty():
		EventBusCore.get_instance().emit_log("info", "SaveMigrationEngine: 迁移配置驱动加载完毕（chain=%s）" % str(chain))
	else:
		ErrorReporter.emit_error("save_migration_engine", "MIGRATION_PATH_BROKEN", "迁移链静态校验发现断链", {
			"issues": issues
		})
	return { "success": issues.is_empty(), "chain": chain, "issues": issues }

## 测试重置
static func reset_for_tests() -> void:
	_domain_migrations.clear()
