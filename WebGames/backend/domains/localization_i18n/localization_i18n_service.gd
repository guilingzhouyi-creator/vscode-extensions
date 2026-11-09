# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/localization_i18n_service.gd
# 架构定位: Domain Service / Application Facade
# 依赖与触发: 上游: GameBootstrap, WorldGateway, SettingsCenter | 下游: LocalizationRegistryCatalog, LocalizationSolver, I18nHotReloadPipeline | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 承接 CT-LOCA-SETT-11 契约门面，统一提供全域多语言状态快照、翻译检索与语言热切换服务
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## LocalizationI18nService：Domain Service / Application Facade
class_name LocalizationI18nService
extends RefCounted

const LocalizationRegistryCatalog = preload("res://backend/domains/localization_i18n/localization_registry_catalog.gd")
const LocalizationSolver = preload("res://backend/domains/localization_i18n/localization_solver.gd")
const I18nHotReloadPipeline = preload("res://backend/domains/localization_i18n/i18n_hot_reload_pipeline.gd")
const LocalizationI18nDTO = preload("res://backend/domains/localization_i18n/dto/localization_i18n_dto.gd")

static var _instance: LocalizationI18nService = null

## 获取多语言领域服务全局单例
static func get_instance() -> LocalizationI18nService:
    if _instance == null:
        _instance = LocalizationI18nService.new()
    return _instance

## 重置服务单例（测试隔离）
static func reset_instance() -> void:
    _instance = null

var _catalog: LocalizationRegistryCatalog = null

func _init(custom_catalog: LocalizationRegistryCatalog = null) -> void:
    if custom_catalog != null:
        _catalog = custom_catalog
    else:
        _catalog = LocalizationRegistryCatalog.get_shared()

## 获取关联的词库目录
func get_catalog() -> LocalizationRegistryCatalog:
    if _catalog == null:
        _catalog = LocalizationRegistryCatalog.get_shared()
    return _catalog

## 获取当前多语言系统只读状态快照 (CT-LOCA-SETT-11 核心方法)
func get_state() -> LocalizationI18nDTO:
    return get_catalog().export_state_dto()

## 执行多语言文本翻译与参数插值
func translate(loc_key: String, params: Dictionary = {}, locale_override: String = "") -> String:
    return LocalizationSolver.translate(get_catalog(), loc_key, params, locale_override)

## 执行统一名称键解析
func resolve_name_key(key: String, locale_override: String = "", params: Dictionary = {}) -> String:
    return LocalizationSolver.resolve_name_key(get_catalog(), key, locale_override, params)

## 检查指定词条是否存在
func has_translation(loc_key: String, locale_override: String = "") -> bool:
    return LocalizationSolver.has_translation(get_catalog(), loc_key, locale_override)

## 切换全局运行语言
func switch_language(new_locale: String) -> Dictionary:
    return I18nHotReloadPipeline.switch_language(get_catalog(), new_locale)

## 注入 MOD 多语言词条
func merge_mod_translations(
    mod_id: String,
    locale: String,
    translations: Dictionary,
    allow_override: bool = false
) -> Dictionary:
    return get_catalog().merge_mod_translations(mod_id, locale, translations, allow_override)

## 卸载 MOD 多语言词条
func unload_mod_translations(mod_id: String) -> int:
    return get_catalog().unload_mod_translations(mod_id)
