# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/logging/log_constants.gd
# 架构定位: Centralized Logging Constants & Severity Taxonomy
# 依赖与触发: 上游: 全域日志、脱敏与遥测基础设施 | 下游: 无外部依赖 | 配置: config/infrastructure/log.json | 信号: 无
# 职责说明: 全源码统一日志、安全加密、脱敏模式与配置键值常量库，彻底消除散落魔法字符串与数字硬编码。
# 退出语义与设计依据: 零硬编码契约 / 单一真源常量化规范
# ==============================================================================

## LogConstants：Centralized Logging Constants & Severity Taxonomy
class_name LogConstants extends RefCounted

# ==============================================================================
# 一、日志级别与权重常量
# ==============================================================================

const LEVEL_TRACE: String = "TRACE"
const LEVEL_DEBUG: String = "DEBUG"
const LEVEL_INFO: String = "INFO"
const LEVEL_WARN: String = "WARN"
const LEVEL_WARNING: String = "WARNING"
const LEVEL_ERROR: String = "ERROR"
const LEVEL_CRITICAL: String = "CRITICAL"
const LEVEL_FATAL: String = "FATAL"
const LEVEL_CRIT: String = "CRIT"
const LEVEL_UNKNOWN: String = "UNKNOWN"

const LEVEL_LOWER_DEBUG: String = "debug"
const LEVEL_LOWER_INFO: String = "info"
const LEVEL_LOWER_WARN: String = "warn"
const LEVEL_LOWER_ERROR: String = "error"

const TRACE_PREFIX_DEFAULT: String = "TRACE"
const CHAIN_GENESIS_HASH: String = "GENESIS"

# ==============================================================================
# 二、标准化频道与配置路径常量
# ==============================================================================

const CHANNEL_SYSTEM: String = "system"
const CHANNEL_INFRASTRUCTURE: String = "infrastructure"
const CHANNEL_GAME_CONFIG: String = "game_config"
const CHANNEL_GM_AUDIT: String = "gm_audit_service"
const CHANNEL_ENTITLEMENT: String = "entitlement_service"
const CHANNEL_GLOBAL: String = "global"
const CHANNEL_SYS_SHORT: String = "SYS"
const CATEGORY_DEFAULT: String = "default"
const CATEGORY_LOG_VOLUME: String = "LOG_VOLUME"
const METRIC_LOG_EVENT_COUNT: String = "log_event_count"
const KEY_SEVERITY: String = "severity"

const CFG_LOG_TABLE: String = "infrastructure.log"
const CFG_ERRORS_CATALOG: String = "infrastructure.errors_catalog"
const CFG_NARRATIVES_PREFIX: String = "narratives."
const CFG_NARRATIVES_ERRORS: String = "narratives.errors"
const CFG_ADMIN_TABLE: String = "infrastructure.admin"
const CFG_PERSISTENCE_TABLE: String = "infrastructure.persistence"

const CFG_PATH_CONSOLE: String = "console"
const CFG_PATH_EXPORT: String = "export"
const CFG_PATH_EXPORT_DIR: String = "export/directory"
const CFG_PATH_EXPORT_PREFIX: String = "export/file_prefix"
const CFG_PATH_EXPORT_BATCH_SIZE: String = "export/batch_size"
const CFG_PATH_EXPORT_ENCRYPTION: String = "export/encryption"
const CFG_PATH_RING_CAPACITY: String = "structured/ring_buffer_capacity"
const CFG_PATH_REDACTION: String = "redaction"
const CFG_PATH_TELEMETRY: String = "telemetry"
const CFG_PATH_RETENTION: String = "retention"
const CFG_PATH_EVENTS: String = "events"
const CFG_PATH_UNIFIED_EVENTS: String = "unified_events"
const CFG_PATH_SECURITY_SEAL_ENV: String = "security/seal_key_env"
const CFG_PATH_SECURITY_SEAL_ID: String = "security/seal_key_id"

# ==============================================================================
# 三、记录字段、脱敏与加密信封键常量
# ==============================================================================

const KEY_SEQUENCE: String = "sequence"
const KEY_TIMESTAMP_UTC: String = "timestamp_utc"
const KEY_LEVEL: String = "level"
const KEY_CHANNEL: String = "channel"
const KEY_ERROR_CODE: String = "error_code"
const KEY_MESSAGE: String = "message"
const KEY_CONTEXT: String = "context"
const KEY_TRACE_ID: String = "trace_id"
const KEY_PARENT_SPAN_ID: String = "parent_span_id"
const KEY_EVENT_CATEGORY: String = "event_category"
const KEY_DURATION_MS: String = "duration_ms"
const KEY_SOURCE_FILE: String = "source_file"
const KEY_SOURCE_LINE: String = "source_line"
const KEY_REDACTED_KEYS: String = "redacted_keys"
const KEY_DIAGNOSTIC_DETAIL: String = "diagnostic_detail"
const KEY_UNREGISTERED_CODE: String = "unregistered_error_code"
const KEY_MUTE_CONSOLE: String = "_mute_console"
const KEY_CODE: String = "code"
const KEY_DOMAIN: String = "domain"

const ERR_CODE_UNKNOWN: String = "ERR_UNKNOWN"

const REDACT_MODE_MASK: String = "mask"
const REDACT_MODE_DROP: String = "drop"
const REDACT_MODE_HASH: String = "hash"
const REDACT_MODE_SALTED_HASH: String = "salted_hash"
const DEFAULT_MASK_REPLACEMENT: String = "****"
const DEFAULT_MASK_PREFIX_LEN: int = 4
const DEFAULT_MASK_SUFFIX_LEN: int = 4
const DEFAULT_SALT_DOMAIN: String = "kalar_redaction_salt_v1"

const ENC_VERSION_V1: int = 1
const ENC_ALGO_AES_256_CBC: String = "aes-256-cbc"
const ENC_KEY_VERSION: String = "v"
const ENC_KEY_ALGO: String = "enc"
const ENC_KEY_IV: String = "iv"
const ENC_KEY_CIPHERTEXT: String = "ct"
const ENC_KEY_MAC: String = "mac"
const ENC_KEY_CHAIN_HASH: String = "chain_hash"
const ENC_KEY_SEQUENCE: String = "seq"
const ENC_DOMAIN_CONTEXT: String = "KALAR_LOG_AES_HMAC_V1"
const ENC_SUBKEY_AES_CONTEXT: String = "KALAR_LOG_SUBKEY_AES_V1"
const ENC_SUBKEY_HMAC_CONTEXT: String = "KALAR_LOG_SUBKEY_HMAC_V1"
const ENC_DEFAULT_SEAL_ENV: String = "KALAR_LOG_SEAL_KEY"
const ENC_KEY_SEAL_ENV_CFG: String = "seal_key_env"

const LOG_ERR_FILE_NOT_FOUND: String = "FILE_NOT_FOUND"
const LOG_ERR_FILE_OPEN_FAILED: String = "FILE_OPEN_FAILED"
const LOG_ERR_JSON_CORRUPT: String = "JSON_CORRUPT"
const LOG_ERR_CHAIN_BROKEN: String = "CHAIN_BROKEN"
const LOG_ERR_MAC_MISMATCH: String = "MAC_MISMATCH"
const LOG_ERR_SEQ_NON_MONOTONIC: String = "SEQUENCE_NON_MONOTONIC"
const LOG_ERR_PLAINTEXT_INJECTION: String = "PLAINTEXT_INJECTION_DETECTED"
const LOG_ERR_TRUNCATED_EMPTY: String = "LOG_FILE_EMPTY_OR_TRUNCATED"
const LOG_ERR_SCAN_LIMIT: String = "SCAN_LINE_LIMIT_EXCEEDED"
const EVENT_LOG_TAMPER_DETECTED: String = "LOG_TAMPER_DETECTED"
const EVENT_LOG_ENCRYPTION_FALLBACK: String = "LOG_ENCRYPTION_FALLBACK"
const UNSEQ_RING_KEY_FMT: String = "unseq_ring_%d_%d"
const UNSEQ_DISK_KEY_FMT: String = "unseq_disk_%d_%d"
const DISK_CACHE_UNINIT_SIG: String = "__UNINIT__"
const DEFAULT_FAIL_POLICY_ABORT: String = "abort"

# ==============================================================================
# 四、边界与数值阈值常量
# ==============================================================================

const DEFAULT_LOG_DIR: String = "user://logs"
const DEFAULT_LOG_PREFIX: String = "kalar"
const LOG_FILE_EXTENSION: String = ".log"
const DEFAULT_RING_BUFFER_CAPACITY: int = 1000
const DEFAULT_MAX_LOG_BYTES: int = 5242880
const DEFAULT_MAX_LOG_FILES: int = 5
const DEFAULT_BATCH_THRESHOLD: int = 1
const DEFAULT_RETENTION_DAYS: int = 7
const DEFAULT_CLEANUP_INTERVAL_SEC: int = 3600
const SECONDS_PER_DAY: int = 86400

const MAX_QUERY_RESULTS: int = 5000
const MAX_QUERY_PAGE_SIZE: int = 500
const DEFAULT_QUERY_PAGE_SIZE: int = 100
const MAX_DISK_SCAN_LINES: int = 100000
const MAX_UNREGISTERED_TRACKED: int = 512

const DEFAULT_TELEMETRY_WINDOW_SEC: int = 60
const DEFAULT_TELEMETRY_SAMPLE_SIZE: int = 256
const MIN_TELEMETRY_SAMPLE_SIZE: int = 16
const PERCENTILE_P50_RATIO: float = 0.50
const PERCENTILE_P95_RATIO: float = 0.95

const AES_BLOCK_SIZE: int = 16
const AES_KEY_SIZE: int = 32
const SHA256_HEX_LEN: int = 64

# ==============================================================================
# 五、级别归一与语义判定算子
# ==============================================================================

## 归一化日志级别权重（用于导出门槛过滤：0=debug .. 3=error）
static func level_weight(level: String) -> int:
	match level.to_upper():
		LEVEL_TRACE, LEVEL_DEBUG:
			return 0
		LEVEL_INFO:
			return 1
		LEVEL_WARN, LEVEL_WARNING:
			return 2
		LEVEL_ERROR, LEVEL_CRITICAL, LEVEL_FATAL:
			return 3
		_:
			return 1

## 归一化控制台输出等级分值（10=debug .. 50=critical）
static func level_rank(level: String) -> int:
	match level.to_lower():
		"trace", "debug":
			return 10
		"info":
			return 20
		"warn", "warning":
			return 30
		"error":
			return 40
		"fatal", "critical":
			return 50
		_:
			return 20

## 判断是否为需触发紧急同步落盘的高危严重级别
static func is_critical_level(level: String) -> bool:
	var upper := level.to_upper()
	return upper == LEVEL_ERROR or upper == LEVEL_CRITICAL or upper == LEVEL_FATAL

## 判断文件是否为指定前缀的轮转归档日志文件（保护主文件）
static func is_rotated_archive_filename(file_name: String, prefix: String) -> bool:
	var main_file := prefix + LOG_FILE_EXTENSION
	return file_name != main_file \
		and file_name.begins_with(prefix + ".") \
		and file_name.ends_with(LOG_FILE_EXTENSION)
