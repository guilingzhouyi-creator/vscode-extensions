# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Error Governance)
# 文件路径: res://backend/infrastructure/error_reporter.gd
# 架构定位: Error Code Registry / Reporter
# 跨域依赖: 上游: 全域后端与前端边界 | 下游: UnifiedLoggerService | 配置: config/infrastructure/errors.json | 信号: 严重错误上报信号
# 职责说明: 统一全域运行时异常与错误上报入口，将存量 push_error/push_warning 散落 收敛至 EventBus 结构化日志底座，执行错误码登记校验与 i18n 解析（Inv-LG-1, Inv-LG-2）。
# 设计依据: Phase 75 错误码统一与可证伪契约
# ==============================================================================

class_name ErrorReporter extends RefCounted

# ==============================================================================
# 一、统一错误上报入口
# ==============================================================================

## 统一错误上报入口：构造带 error_code 的 LogRecordDTO 并走统一通道广播
## error_code 必须为 errors_catalog.json 已登记常量（未登记回退 ERR_UNKNOWN 并遥测计数）；
## message 语义（Inv-LG-2）：已登记码经 i18n 解析，未登记码回退调用方文本（保留诊断信息）
static func emit_error(
	channel: String,
	error_code: String,
	message: String = "",
	context: Dictionary = {}
) -> void:
	var entry := ErrorCodeRegistry.lookup(error_code)
	var final_code := error_code
	var final_message := message
	if entry == null:
		# 未登记错误码：回退 ERR_UNKNOWN 并遥测计数；message 回退调用方文本，空则保留原始码本体
		ErrorCodeRegistry.report_unregistered(error_code)
		final_code = "ERR_UNKNOWN"
		if final_message.is_empty():
			final_message = error_code
	else:
		# 已登记码：i18n 解析（message_key → 直查表 → 调用方文本 → 码本体）
		final_message = _resolve_message(final_code, message)

	var record := LogRecordDTO.new()
	record.level = entry.severity if entry != null else "error"
	record.channel = channel
	record.error_code = final_code
	record.message = final_message
	# 所有权隔离 + 构造期脱敏（Phase 87 · Inv-LS-2 安全红线）：
	# 本路径不经 LogCollector，若仅依赖规范链路脱敏，context 中的 token/secret
	# 会经 EventBus → LogFileExporter 明文落盘（Phase 87 审查发现的脱敏接线缺口）。
	var redacted := RedactionRule.apply(context)
	record.context = redacted["dict"]

	EventBusCore.get_instance().emit_log_record(record)

# ==============================================================================
# 二、消息本地化解析
# ==============================================================================

## message 本地化解析：优先按 ErrorCodeRegistry.message_key（"errors/<key>" → 表 narratives.errors 路径 <key>）
## 取表，未命中回退调用方文案，最终回退 code 本体（逻辑判断严禁依赖返回值）
static func _resolve_message(error_code: String, fallback: String) -> String:
	var entry := ErrorCodeRegistry.lookup(error_code)
	if entry != null and not entry.message_key.is_empty():
		var hit := _resolve_message_key(entry.message_key)
		if not hit.is_empty():
			return hit
	# 兼容直查：按 error_code 本体查 narratives.errors 表
	var direct := GameConfig.get_string("narratives.errors", error_code, "")
	if not direct.is_empty():
		return direct
	if not fallback.is_empty():
		return fallback
	return error_code

## message_key 形态 "errors/<key>" 按 GameConfig 表约定解析：表 narratives.errors + 路径 <key>；
## 无斜杠形态视为 narratives.errors 表内路径
static func _resolve_message_key(message_key: String) -> String:
	var parts := message_key.split("/")
	if parts.size() >= 2:
		var table := "narratives." + parts[0]
		var path := "/".join(parts.slice(1))
		return GameConfig.get_string(table, path, "")
	return GameConfig.get_string("narratives.errors", message_key, "")

## 存量 push_error / push_warning 零阻断收敛包装：保持原调用点失败关闭语义，仅收敛通道
static func migrate_push_error(channel: String, msg: String) -> void:
	emit_error(channel, "ERR_UNKNOWN", msg, {})

## 便捷错误/告警广播入口（默认通道 infrastructure）
static func emit(error_code: String, context: Dictionary = {}, message: String = "") -> void:
	emit_error("infrastructure", error_code, message, context)

