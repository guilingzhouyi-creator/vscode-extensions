# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/chat_command/command_registry_engine.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/chat_command.json | 信号: EventBus 领域广播
# 职责说明: 注册全域聊天指令、权限拦截、执行分发与前缀自动补全 错误文案由 config/narratives/chat_command.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CommandRegistryEngine extends RefCounted

## 注意：本表为静态持有，其中的 Callable 生命周期必须与脚本一致。
## 切勿注册 lambda / 闭包——它们捕获的 GDScript 实例会在脚本卸载时先于本表释放，
## 导致进程退出阶段访问悬垂 Callable 而 SIGSEGV（退出码 139，测试全过但 CI 判失败）。
## 请注册具名静态函数，并在不再需要时调用 unregister_command / clear_registry。
static var registered_commands: Dictionary = {}

## 注册指令（小写归一键；必须传具名静态函数，禁 lambda 防悬垂 Callable）
static func register_command(
	cmd_name: String,
	handler: Callable,
	min_admin_level: int = 0,
	description: String = "",
	usage_hint: String = ""
) -> void:
	registered_commands[cmd_name.to_lower()] = {
		"handler": handler,
		"min_level": min_admin_level,
		"desc": description,
		"usage": usage_hint
	}

## 注销单条指令（测试隔离与热重载场景必须调用）
static func unregister_command(cmd_name: String) -> bool:
	return registered_commands.erase(cmd_name.to_lower())

## 清空全部注册（退出前或测试套件收尾调用，避免静态表持留 Callable）
static func clear_registry() -> void:
	registered_commands.clear()

## 指令是否已注册（小写匹配）
static func has_command(cmd_name: String) -> bool:
	return registered_commands.has(cmd_name.to_lower())

## 已注册指令总数
static func registered_count() -> int:
	return registered_commands.size()

## 指令分发：非指令/未知/权限不足逐级拦截后调用处理器
static func dispatch_command(ast: ChatCommandParser.CommandAST, admin: AdminPermissionAggregate, context: Dictionary) -> Dictionary:
	if not ast.is_command:
		var msg := GameConfig.get_string("narratives.chat_command", "not_a_command", "Not a command")
		return { "success": false, "reason": msg }

	var cmd = registered_commands.get(ast.command_name, null)
	if cmd == null:
		var template := GameConfig.get_string("narratives.chat_command", "unknown_chat_command", "Unknown command: /%s")
		return { "success": false, "reason": template % ast.command_name }

	if not admin.has_permission(cmd.min_level):
		var tmpl2 := GameConfig.get_string("narratives.chat_command", "permission_denied", "Permission denied for command: /%s")
		return { "success": false, "reason": tmpl2 % ast.command_name }

	var handler: Callable = cmd.handler
	return handler.call(ast, context)

## 前缀自动补全建议（去 / 前缀 + 小写化，返回 /cmd 形式数组）
static func get_autocomplete_suggestions(prefix: String) -> Array[String]:
	var clean = prefix.strip_edges().to_lower()
	if clean.begins_with("/"): clean = clean.substr(1)
	var matches: Array[String] = []
	for k in registered_commands:
		if k.begins_with(clean):
			matches.append("/" + k)
	return matches
