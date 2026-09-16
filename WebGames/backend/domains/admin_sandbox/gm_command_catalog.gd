# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/gm_command_catalog.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 将 GM 沙盒作弊能力注册为聊天斜杠命令（min_admin_level = LEVEL_GAME_MASTER）， 具名静态 handler 桥接 SandboxCheatSolver；context 契约： { admin, inventory, wallet, sheet, clock, catalog(物品注册表，必填) }
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GmCommandCatalog
extends RefCounted

const BUILTIN_COMMANDS: Array[String] = ["give", "gold", "god", "time"]

## 注册内置 GM 命令（启动装配时调用；具名静态 handler，防静态注册表悬垂 Callable）
static func register_default_commands() -> void:
	var gm_level: int = AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER
	CommandRegistryEngine.register_command(
		"give", _give_handler, gm_level,
		"发放注册表物品", "用法: /give <统一英文名> [数量]（如 /give mithril_longsword 3）"
	)
	CommandRegistryEngine.register_command(
		"gold", _gold_handler, gm_level,
		"发放金币", "用法: /gold <数量>"
	)
	CommandRegistryEngine.register_command(
		"god", _god_handler, gm_level,
		"上帝模式", "用法: /god"
	)
	CommandRegistryEngine.register_command(
		"time", _time_handler, gm_level,
		"世界时钟快进", "用法: /time <月数>"
	)

## 注销内置 GM 命令（测试隔离与热重载场景调用）
static func unregister_default_commands() -> void:
	for cmd in BUILTIN_COMMANDS:
		CommandRegistryEngine.unregister_command(str(cmd))

## 具名静态 handler（禁 lambda）：从 context 取 admin 与领域对象，桥接沙盒求解器。
## 参数规范（唯一合法形态）：/give <统一英文名> [数量]；不接受 "id" 前缀、中文名或数字 ID。
static func _give_handler(ast: Variant, context: Dictionary) -> Dictionary:
	var admin: AdminPermissionAggregate = context.get("admin", null)
	if admin == null:
		return { "success": false, "reason": "NO_ADMIN_CONTEXT" }
	return SandboxCheatSolver.execute_cheat_command(admin, "GIVE_ITEM", ast.raw_arguments, context)

static func _gold_handler(ast: Variant, context: Dictionary) -> Dictionary:
	var admin: AdminPermissionAggregate = context.get("admin", null)
	if admin == null:
		return { "success": false, "reason": "NO_ADMIN_CONTEXT" }
	return SandboxCheatSolver.execute_cheat_command(admin, "GIVE_GOLD", ast.raw_arguments, context)

static func _god_handler(ast: Variant, context: Dictionary) -> Dictionary:
	var admin: AdminPermissionAggregate = context.get("admin", null)
	if admin == null:
		return { "success": false, "reason": "NO_ADMIN_CONTEXT" }
	return SandboxCheatSolver.execute_cheat_command(admin, "GOD_MODE", ast.raw_arguments, context)

static func _time_handler(ast: Variant, context: Dictionary) -> Dictionary:
	var admin: AdminPermissionAggregate = context.get("admin", null)
	if admin == null:
		return { "success": false, "reason": "NO_ADMIN_CONTEXT" }
	return SandboxCheatSolver.execute_cheat_command(admin, "ADVANCE_TIME", ast.raw_arguments, context)
