# ==============================================================================
# 模块归属: 前端国际化渲染层 (Frontend · i18n Text Resolver)
# 文件路径: res://frontend/i18n/ui_text_resolver.gd
# 架构定位: Decoupled Localization Dictionary Resolver
# 依赖与触发: 上游: UIIntermediary, UIBindingRegistry | 下游: PlaceholderFiller, GameConfig, config/i18n/*.json
# 职责说明: 加载并缓存多语言 JSON 词库，统一检索 i18n 键并委派 PlaceholderFiller 完成单次参数填充。
# 退出语义与设计依据: 独立解耦词库与单引擎参数填充防重复加工契约
# ==============================================================================

## UITextResolver：前端多语言词库加载与文本模板解析器
class_name UITextResolver
extends RefCounted

static var _instance: UITextResolver

## 获取多语言文本解析器全局单例
static func get_instance() -> UITextResolver:
	if _instance == null:
		_instance = UITextResolver.new()
	return _instance

## 重置多语言文本解析器静态单例并清空词库缓存
static func reset_instance() -> void:
	if _instance != null:
		_instance._dictionaries.clear()
		_instance._mod_dictionaries.clear()
	_instance = null

var current_locale: String = "zh_CN"
var fallback_locale: String = "en_US"
var _dictionaries: Dictionary = {} # locale -> { key -> text }
var _mod_dictionaries: Dictionary = {} # locale -> { key -> text }
var _synced_mod_i18n_version: int = -1

func _init() -> void:
	_load_locale_dict("zh_CN", "res://config/i18n/zh_CN.json")
	_load_locale_dict("en_US", "res://config/i18n/en_US.json")
	sync_mod_dictionaries_from_config()

## 从 GameConfig 模组本地化覆盖层全量同步各语言字典（不污染静态基座词典）
func sync_mod_dictionaries_from_config() -> void:
	_mod_dictionaries = GameConfig.get_mod_i18n_dictionaries()
	_synced_mod_i18n_version = GameConfig.get_mod_i18n_version()

func _sync_mod_dictionaries_if_stale() -> void:
	var latest_version := GameConfig.get_mod_i18n_version()
	if _synced_mod_i18n_version != latest_version:
		sync_mod_dictionaries_from_config()

## 注入 MOD 分语言本地化词条覆盖（按 locale 分桶，不污染磁盘原始基座词库）
func apply_mod_translations(locale: String, translations: Dictionary) -> void:
	if locale.is_empty() or translations.is_empty():
		return
	if not _mod_dictionaries.has(locale):
		_mod_dictionaries[locale] = {}
	var bucket: Dictionary = _mod_dictionaries[locale]
	for raw_key in translations.keys():
		bucket[str(raw_key)] = str(translations[raw_key])

## 清空全部 MOD 前端运行时多语言覆写并复原基础词库解析
func clear_mod_translations() -> void:
	_mod_dictionaries.clear()

## 加载本地化 JSON 文件
func _load_locale_dict(locale: String, path: String) -> void:
	if not FileAccess.file_exists(path):
		return
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var raw_json_text := file.get_as_text()
	file.close()

	var parsed_json: Variant = JSON.parse_string(raw_json_text)
	if parsed_json is Dictionary:
		_dictionaries[locale] = parsed_json

## 核心翻译函数: resolve(i18n_key, template_payload) → 翻译后模板字符串（已填充参数）
## 单引擎模板解析收敛：本函数只负责提取模板，参数填充唯一由 PlaceholderFiller 承担，
## 防止先裸替换再填充造成的二次消费与格式化空转。
static func resolve(i18n_key: String, template_payload: Dictionary = {}) -> String:
	var resolver := get_instance()
	var template_text := resolver._get_raw_text(i18n_key)
	if template_text.is_empty():
		# 尝试从 frontend.views 配置回退检索模板
		var fallback_views := GameConfig.get_string("frontend.views", i18n_key, "")
		if not fallback_views.is_empty():
			return PlaceholderFiller.fill(fallback_views, template_payload)
		# 若 key 自身已是包含空格或大括号的英文底座模板/人读消息，直接填充参数输出，避免被包装成 [key]
		if i18n_key.contains(" ") or i18n_key.contains("{"):
			return PlaceholderFiller.fill(i18n_key, template_payload)
		return "[" + i18n_key + "]"

	return PlaceholderFiller.fill(template_text, template_payload)

## 原始文案检索 (当前语言 MOD -> 基础 -> 回退语言 MOD -> 基础)
func _get_raw_text(i18n_key: String) -> String:
	_sync_mod_dictionaries_if_stale()
	var mod_locale_table: Dictionary = _mod_dictionaries.get(current_locale, {})
	if mod_locale_table.has(i18n_key):
		return str(mod_locale_table[i18n_key])

	var locale_dictionary: Dictionary = _dictionaries.get(current_locale, {})
	if locale_dictionary.has(i18n_key):
		return str(locale_dictionary[i18n_key])

	var mod_fallback_table: Dictionary = _mod_dictionaries.get(fallback_locale, {})
	if mod_fallback_table.has(i18n_key):
		return str(mod_fallback_table[i18n_key])

	var fallback_dictionary: Dictionary = _dictionaries.get(fallback_locale, {})
	if fallback_dictionary.has(i18n_key):
		return str(fallback_dictionary[i18n_key])

	return ""

## 切换当前生效的目标语言代码（如 "zh_CN" / "en_US"）
static func set_locale(locale: String) -> void:
	var resolver := get_instance()
	resolver.current_locale = locale

## 获取当前生效的语言代码
static func get_current_locale() -> String:
	return get_instance().current_locale

## 获取词条缺失时的回退默认语言代码
static func get_fallback_locale() -> String:
	return get_instance().fallback_locale

## 判断当前语言是否属于全角中日韩（CJK）字符体系，用于字号与宽度估算适配
static func is_cjk_locale() -> bool:
	var normalized_locale := get_current_locale().to_lower()
	return normalized_locale.begins_with("zh") or normalized_locale.begins_with("ja") or normalized_locale.begins_with("ko")

## 检查指定 i18n 键在当前语言或回退词库中是否存在有效词条
static func has_key(i18n_key: String) -> bool:
	var resolver := get_instance()
	return not resolver._get_raw_text(i18n_key).is_empty()
