# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/chat_command/chat_command_parser.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/chat_command.json | 信号: EventBus 领域广播
# 职责说明: 斜杠前缀 (/cmd arg1 arg2) 词法分析、参数类型推导与命令 AST 语法树生成
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name ChatCommandParser extends RefCounted

class CommandAST extends RefCounted:
	var is_command: bool = false
	var command_name: String = ""
	var raw_arguments: Array = []
	var named_arguments: Dictionary = {}
	var raw_text: String = ""

## 指令行解析：斜杠前缀判定 → 分词 → 位置/命名参数类型推导（CommandAST）
static func parse_input_line(input_text: String) -> CommandAST:
	var ast := CommandAST.new()
	ast.raw_text = input_text
	var trimmed = input_text.strip_edges()

	if not trimmed.begins_with("/"):
		ast.is_command = false
		return ast

	ast.is_command = true
	var tokens = trimmed.substr(1).split(" ", false)
	if tokens.is_empty():
		return ast

	ast.command_name = tokens[0].to_lower()
	for i in range(1, tokens.size()):
		var token = tokens[i]
		if token.contains("="):
			var kv = token.split("=", false, 1)
			if kv.size() == 2:
				ast.named_arguments[kv[0]] = _infer_token_type(kv[1])
		else:
			ast.raw_arguments.append(_infer_token_type(token))

	return ast

## 参数类型推导：int/float/bool 逐级试探，兜底字符串
static func _infer_token_type(token: String) -> Variant:
	if token.is_valid_int():
		return token.to_int()
	if token.is_valid_float():
		return token.to_float()
	if token.to_lower() == "true":
		return true
	if token.to_lower() == "false":
		return false
	return token
