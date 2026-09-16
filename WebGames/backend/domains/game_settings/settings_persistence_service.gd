# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/game_settings/settings_persistence_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/game_settings.json | 信号: EventBus 领域广播
# 职责说明: 独立于游戏角色存档的 settings.kalar_cfg 序列化与反序列化落盘
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name SettingsPersistenceService
extends RefCounted

const DEFAULT_SETTINGS_PATH: String = "user://settings.kalar_cfg"

static func save_to_memory_string(settings: GameSettingsAggregate) -> String:
	return JSON.stringify(settings.serialize(), "\t")

static func load_from_memory_string(settings: GameSettingsAggregate, json_str: String) -> bool:
	var parsed = JSON.parse_string(json_str)
	if typeof(parsed) == TYPE_DICTIONARY:
		settings.deserialize(parsed)
		return true
	return false

## 真实文件落盘（Phase 31 S2）：固定路径 user://settings.kalar_cfg，写后 flush/close。
## 返回 { "success": bool, "path": String [, "error_code"] }
static func save_to_file(settings: GameSettingsAggregate) -> Dictionary:
	var file := FileAccess.open(DEFAULT_SETTINGS_PATH, FileAccess.WRITE)
	if not file:
		return { "success": false, "error_code": "OPEN_WRITE_FAIL", "path": DEFAULT_SETTINGS_PATH }
	file.store_string(save_to_memory_string(settings))
	file.flush()
	file.close()
	return { "success": true, "path": DEFAULT_SETTINGS_PATH }

## 真实文件读取并应用（Phase 31 S2）：缺失/解析失败返回受控错误码，不抛 Fatal。
static func load_from_file(settings: GameSettingsAggregate) -> Dictionary:
	if not FileAccess.file_exists(DEFAULT_SETTINGS_PATH):
		return { "success": false, "error_code": "FILE_NOT_EXIST", "path": DEFAULT_SETTINGS_PATH }
	var file := FileAccess.open(DEFAULT_SETTINGS_PATH, FileAccess.READ)
	if not file:
		return { "success": false, "error_code": "OPEN_READ_FAIL", "path": DEFAULT_SETTINGS_PATH }
	var json_str := file.get_as_text()
	file.close()
	var ok := load_from_memory_string(settings, json_str)
	return { "success": ok, "error_code": "" if ok else "PARSE_FAIL", "path": DEFAULT_SETTINGS_PATH }
