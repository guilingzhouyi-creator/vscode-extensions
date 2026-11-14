# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Diagnostics Base Text)
# 文件路径: res://backend/infrastructure/logging/system_base_messages.gd
# 架构定位: Compliant Standard English Base Text Library
# 依赖与触发: 上游: GameBootstrap, GameConfig, ObjectPool, LogFileExporter, ContractRegistryIndex | 下游: TemplateFormatter, GameConfig | 配置: config/infrastructure/log.json | 信号: 无
# 职责说明: 集中收口底层内核与基础设施合规标准英文底座诊断文本库（均以 {param} 命名占位符格式化），与配置驱动前端/业务多语言文案严格解耦。
# 退出语义与设计依据: 英文底座文本纯洁性契约 (TC-ARCH-12) / 动态占位符统一注入规范
# ==============================================================================

## SystemBaseMessages：Compliant Standard English Base Text Library
class_name SystemBaseMessages extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")

# ==============================================================================
# 一、事件回退与控制台格式模板（Standard English Base Templates）
# ==============================================================================

const MSG_FALLBACK_EVENT: String = "[{code}] Event occurred in domain {domain}."
const MSG_BOOT_TEARDOWN_COMPLETED: String = "GameBootstrap teardown completed: global singletons and session subsystems symmetrically reset."

const MSG_GAME_CONFIG_REQUIRED_MISSING: String = "GameConfig: required config tables missing: {tables}"
const MSG_GAME_CONFIG_DIR_MISSING: String = "GameConfig: configuration directory does not exist: {path}"
const MSG_GAME_CONFIG_KDAT_FAIL: String = "{path}: .kdat parse or validation failed"
const MSG_GAME_CONFIG_KDAT_WARN: String = "GameConfig: .kdat parse or validation failed [{path}]"
const MSG_GAME_CONFIG_JSON_FAIL: String = "{path}: JSON parse failed (line {line})"
const MSG_GAME_CONFIG_JSON_WARN: String = "GameConfig: JSON parse failed [{path}]: {error} (line {line})"
const MSG_GAME_CONFIG_ROOT_OBJECT: String = "{path}: top-level must be a JSON object"
const MSG_GAME_CONFIG_ROOT_WARN: String = "GameConfig: [{path}] top-level must be a JSON object"

const MSG_AUDIT_KEY_MISSING: String = "Audit signing key missing; seal_key_env unconfigured (fail-closed)."
const MSG_SEAL_KEY_MISSING: String = "EntitlementService: Seal key missing; sealed output unavailable (fail-closed)."
const MSG_GM_AUDIT_FALLBACK: String = "GM Audit: Admin [{admin_id}] executed [{action}]"
const MSG_SNAPSHOT_PROD_BLOCKED: String = "Snapshot test mode is permitted in Debug/Test builds only."
const MSG_NULL_REQUEST: String = "Snapshot object cannot be null."
const MSG_SAVE_TOPLEVEL_NOT_OBJECT: String = "top-level is not an object"
const MSG_SAVE_NO_VALID_PAYLOAD: String = "no valid payload"
const MSG_SAVE_UNVERIFIED_BACKUP: String = "unverified or signature-mismatched backup"
const MSG_SAVE_MISSING_FORMAT_VERSION: String = "Invalid save envelope structure: missing format_version."

const MSG_POOL_OVERFLOW_WARN: String = "ObjectPool[{pool_name}] active allocation reached overflow warning threshold ({allocated} >= {threshold})."
const MSG_POOL_HARD_LIMIT_ERR: String = "ObjectPool[{pool_name}] reached hard limit with overflow allocation forbidden."
const MSG_POOL_DOUBLE_RELEASE: String = "ObjectPool[{pool_name}] illegal release intercepted: object was not acquired or already released."

const MSG_CONTRACT_CONFIG_NOT_FOUND: String = "ContractRegistryIndex: config file not found: {path}"
const MSG_CONTRACT_CONFIG_READ_FAIL: String = "ContractRegistryIndex: failed to read config file: {path}"
const MSG_CONTRACT_JSON_PARSE_FAIL: String = "ContractRegistryIndex: JSON parse failed: {error}"
const MSG_CONTRACT_ROOT_NOT_DICT: String = "ContractRegistryIndex: config root must be a Dictionary object."
const MSG_CONTRACT_SCHEMA_UNSUPPORTED: String = "ContractRegistryIndex: unsupported schema_version {version} (expected {expected})"
const MSG_CONTRACT_VALIDATION_FAILED: String = "ContractRegistryIndex: contract structure validation failed: {errors}"

const MSG_LOG_ENCRYPTION_UNAVAILABLE: String = "Log encryption enabled without seal key; fallback to fail-safe plain audit mode."
const MSG_LOG_DECRYPT_FAILED: String = "Encrypted log record verification or decryption failed at line {line}: {reason}"

# ==============================================================================
# 二、底座英文文本库格式化算子
# ==============================================================================

## 使用合规 {param} 命名占位符格式化底座标准英文文本
static func format(template_text: String, parameters: Dictionary = {}) -> String:
	if template_text.is_empty():
		return ""
	if parameters.is_empty():
		return template_text
	return TemplateFormatter.format(template_text, parameters)

## 优先从 config/infrastructure/log.json events 读取配置文案模板，缺省回退合规标准英文底座文本
static func resolve_event_or_base(event_code: String, base_template: String, parameters: Dictionary = {}) -> String:
	var config_template: String = GameConfig.get_string(
		LogConstants.CFG_LOG_TABLE,
		"%s/%s" % [LogConstants.CFG_PATH_EVENTS, event_code],
		""
	)
	var chosen := config_template if not config_template.is_empty() else base_template
	return format(chosen, parameters)

## 统一格式化标准控制台输出行（消除多处格式串散落拼接）
static func format_console_line(
	level: String,
	channel: String,
	message: String,
	error_code: String = "",
	diagnostic_detail: String = ""
) -> String:
	var resolved_channel := channel if not channel.is_empty() else LogConstants.CHANNEL_SYSTEM
	var formatted := "[%s][%s] %s" % [level.to_upper(), resolved_channel, message]
	if not diagnostic_detail.is_empty():
		formatted += " | detail: %s" % diagnostic_detail
	if not error_code.is_empty():
		formatted += " (code: %s)" % error_code
	return formatted

## 格式化 UnifiedLoggerService 独立应急控制台输出行
static func format_unified_console_line(
	severity_name: String,
	domain: String,
	event_code: String,
	message: String
) -> String:
	return "[%s][%s][%s] %s" % [severity_name, domain, event_code, message]
