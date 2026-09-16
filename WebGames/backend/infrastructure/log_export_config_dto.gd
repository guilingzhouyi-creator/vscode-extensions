# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_export_config_dto.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 映射 config/infrastructure/log.json 中 export 段配置，驱动文件落盘、 轮转与过滤策略，支持热重载自愈（Inv-LG-4）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogExportConfigDTO extends RefCounted

# ==============================================================================
# 一、导出策略字段
# ==============================================================================

## 导出总开关（false 时导出器以零开销旁路快速跳过）
var enabled: bool = false

## 导出目标目录（禁止盘符/机器绝对路径硬编码，默认采用 "user://logs"）
var directory: String = ""

## 导出的主文件名前缀（如 "kalar"，生成 kalar.log）
var file_prefix: String = "kalar"

## 单文件轮转字节阈值（0 表示不进行容量轮转，默认 5MB: 5242880）
var max_bytes: int = 0

## 轮转归档文件最大保留份数（0 表示不自动清理，默认 5 份）
var max_files: int = 0

## 最低落盘级别（debug < info < warn < error，低于此级别的日志被丢弃）
var min_level: String = "info"

## 通道白名单（为空表示全部通道均允许落盘）
var include_channels: Array[String] = []

# ==============================================================================
# 二、配置解析
# ==============================================================================

## 从 GameConfig 中解析 export 段（缺省安全回退）
static func from_config() -> LogExportConfigDTO:
	var dto := LogExportConfigDTO.new()
	var export_dict: Dictionary = GameConfig.get_dict("infrastructure.log", "export", {})
	if export_dict.is_empty():
		return dto
	dto.enabled = bool(export_dict.get("enabled", false))
	dto.directory = str(export_dict.get("directory", "user://logs"))
	dto.file_prefix = str(export_dict.get("file_prefix", "kalar"))
	dto.max_bytes = int(export_dict.get("max_bytes", 5242880))
	dto.max_files = int(export_dict.get("max_files", 5))
	dto.min_level = str(export_dict.get("min_level", "info"))
	var channels = export_dict.get("include_channels", [])
	if channels is Array:
		dto.include_channels.clear()
		for ch in channels:
			dto.include_channels.append(str(ch))
	return dto
