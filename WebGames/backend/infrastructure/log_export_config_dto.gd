# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_export_config_dto.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/log.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 映射 config/infrastructure/log.json 中 export 段配置，驱动文件落盘、 轮转与过滤策略，支持热重载自愈（Inv-LG-4）。
# 退出语义与设计依据: 统一结构化日志规范 / 性能基准审计
# ==============================================================================

## LogExportConfigDTO：Log Collector & Stream Processor
class_name LogExportConfigDTO extends RefCounted

# ==============================================================================
# 一、导出策略字段
# ==============================================================================

## 导出总开关（false 时导出器以零开销旁路快速跳过）
var enabled: bool = false

## 导出目标目录（禁止盘符/机器绝对路径硬编码，默认采用 "user://logs"）
var directory: String = ""

## 导出的主文件名前缀（如 "kalar"，生成 kalar.log）
var file_prefix: String = LogConstants.DEFAULT_LOG_PREFIX

## 单文件轮转字节阈值（0 表示不进行容量轮转，默认 5MB: 5242880）
var max_bytes: int = 0

## 轮转归档文件最大保留份数（0 表示不自动清理，默认 5 份）
var max_files: int = 0

## 最低落盘级别（debug < info < warn < error，低于此级别的日志被丢弃）
var min_level: String = LogConstants.LEVEL_LOWER_INFO

## 批处理攒批写入阈值（1 表示即刻同步落盘）
var batch_size: int = LogConstants.DEFAULT_BATCH_THRESHOLD

## 是否启用导出日志 AES-256-CBC Encrypt-then-MAC 加密密封
var encryption_enabled: bool = false

## 加密密钥环境变量名（受控密钥提供器，禁明文硬编码）
var encryption_seal_key_env: String = LogConstants.ENC_DEFAULT_SEAL_ENV

## 是否启用防篡改审计哈希链
var hmac_chain_enabled: bool = true

## 通道白名单（为空表示全部通道均允许落盘）
var include_channels: Array[String] = []

# ==============================================================================
# 二、配置解析
# ==============================================================================

## 从 GameConfig 中解析 export 段（缺省安全回退）
static func from_config() -> LogExportConfigDTO:
	var config_dto := LogExportConfigDTO.new()
	var export_map: Dictionary = GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_EXPORT, {})
	if export_map.is_empty():
		return config_dto
	config_dto.enabled = bool(export_map.get("enabled", false))
	config_dto.directory = str(export_map.get("directory", LogConstants.DEFAULT_LOG_DIR))
	config_dto.file_prefix = str(export_map.get("file_prefix", LogConstants.DEFAULT_LOG_PREFIX))
	config_dto.max_bytes = int(export_map.get("max_bytes", LogConstants.DEFAULT_MAX_LOG_BYTES))
	config_dto.max_files = int(export_map.get("max_files", LogConstants.DEFAULT_MAX_LOG_FILES))
	config_dto.min_level = str(export_map.get("min_level", LogConstants.LEVEL_LOWER_INFO))
	config_dto.batch_size = maxi(1, int(export_map.get("batch_size", LogConstants.DEFAULT_BATCH_THRESHOLD)))
	var encryption_raw: Variant = export_map.get("encryption", {})
	if encryption_raw is Dictionary:
		var encryption_map: Dictionary = encryption_raw
		config_dto.encryption_enabled = bool(encryption_map.get("enabled", false))
		config_dto.encryption_seal_key_env = str(encryption_map.get("seal_key_env", LogConstants.ENC_DEFAULT_SEAL_ENV))
		config_dto.hmac_chain_enabled = bool(encryption_map.get("hmac_chain", true))
	var channels: Variant = export_map.get("include_channels", [])
	if channels is Array:
		config_dto.include_channels.clear()
		for channel_name in channels:
			config_dto.include_channels.append(str(channel_name))
	return config_dto
