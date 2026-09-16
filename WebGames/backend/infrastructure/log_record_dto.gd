# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_record_dto.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 承载全域单调递增序号的结构化日志与错误记录，实现 error_code 与 message 分离， 支持原子落盘导出、前端渲染与调试追踪对账（Inv-LG-1, Inv-LG-2, Inv-LG-3）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogRecordDTO extends RefCounted

# ==============================================================================
# 一、记录字段
# ==============================================================================

## 全局单调递增序号（跨通道唯一，由 EventBus/LogFileExporter 签发，供导出排序与对账）
var sequence: int = 0

## 事件发生绝对时刻（UNIX 时间戳，单位：秒）
var timestamp_utc: int = 0

## 日志级别键（debug / info / warn / error，映射 log.json levels）
var level: String = "INFO"

## 来源域/模块标识（如 "contract_registry_index", "game_config" 等）
var channel: String = ""

## 英文错误码（可选；无错误时为空串，必须为 errors_catalog.json 已登记协议常量）
var error_code: String = ""

## 人读消息（经 i18n 可本地化；业务与逻辑判断严禁依赖该展示文本）
var message: String = ""

## 结构化上下文（域/关键参数，深拷贝入档）
var context: Dictionary = {}

# ==============================================================================
# 二、生命周期与转换
# ==============================================================================

## 池化复位（ADV-POOL-001）：归还/借出时彻底清零，供演进 03 对象池复用
func reset_state() -> void:
	sequence = 0
	timestamp_utc = 0
	level = "INFO"
	channel = ""
	error_code = ""
	message = ""
	context = {}

## 序列化为字典（timestamp 缺省时落当前系统时间；context 深拷贝隔离调用方改写）
func to_dto() -> Dictionary:
	var ts := timestamp_utc
	if ts <= 0:
		ts = int(Time.get_unix_time_from_system())
	return {
		"sequence": sequence,
		"timestamp_utc": ts,
		"level": level,
		"channel": channel,
		"error_code": error_code,
		"message": message,
		"context": context.duplicate(true),
	}

## 从字典反序列化还原记录（字段缺省用默认值；context 仅接受 Dictionary 并深拷贝）
static func from_dto(data: Dictionary) -> LogRecordDTO:
	var dto := LogRecordDTO.new()
	if data.is_empty():
		return dto
	dto.sequence = int(data.get("sequence", 0))
	dto.timestamp_utc = int(data.get("timestamp_utc", 0))
	dto.level = str(data.get("level", "INFO"))
	dto.channel = str(data.get("channel", ""))
	dto.error_code = str(data.get("error_code", ""))
	dto.message = str(data.get("message", ""))
	var ctx = data.get("context", {})
	if ctx is Dictionary:
		dto.context = ctx.duplicate(true)
	return dto
