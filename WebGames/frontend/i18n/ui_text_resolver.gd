# ==============================================================================
# 卡拉尔世界引擎 - 前端 i18n 文本解析器 (独立解耦词库)
# 文件路径: res://frontend/i18n/ui_text_resolver.gd
# 职责: 统一解析 i18n key 并填充参数，直接读取配置词典，解耦后端反射依赖
# ==============================================================================
class_name UITextResolver
extends RefCounted

static var _instance: UITextResolver
static func get_instance() -> UITextResolver:
	if _instance == null:
		_instance = UITextResolver.new()
	return _instance

var current_locale: String = "zh_CN"
var fallback_locale: String = "en_US"
var _dictionaries: Dictionary = {} # locale -> { key -> text }

func _init() -> void:
	_load_locale_dict("zh_CN", "res://config/i18n/zh_CN.json")
	_load_locale_dict("en_US", "res://config/i18n/en_US.json")

## 加载本地化 JSON 文件
func _load_locale_dict(locale: String, path: String) -> void:
	if not FileAccess.file_exists(path):
		return
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return
	var content := file.get_as_text()
	file.close()

	var json_res: Variant = JSON.parse_string(content)
	if json_res is Dictionary:
		_dictionaries[locale] = json_res

## 核心翻译函数: resolve(key, params) → 翻译后模板字符串（已填充参数）
## R-02 单引擎收敛：本函数只负责「取模板」，参数填充唯一由 PlaceholderFiller 承担，
## 杜绝「resolve 裸替换 → PlaceholderFiller 再填充」的双引擎重复消费导致格式化空转。
static func resolve(key: String, params: Dictionary = {}) -> String:
	var inst := get_instance()
	var template := inst._get_raw_text(key)
	if template.is_empty():
		# 尝试从 frontend.views 配置兜底
		var fallback_views := GameConfig.get_string("frontend.views", key, "")
		if not fallback_views.is_empty():
			return PlaceholderFiller.fill(fallback_views, params)
		return "[" + key + "]"

	return PlaceholderFiller.fill(template, params)

## 原始文案检索 (当前语言 ➔ 回退语言)
func _get_raw_text(key: String) -> String:
	var dict: Dictionary = _dictionaries.get(current_locale, {})
	if dict.has(key):
		return str(dict[key])

	var fb_dict: Dictionary = _dictionaries.get(fallback_locale, {})
	if fb_dict.has(key):
		return str(fb_dict[key])

	return ""

static func set_locale(locale: String) -> void:
	var inst := get_instance()
	inst.current_locale = locale

static func get_current_locale() -> String:
	return get_instance().current_locale

static func get_fallback_locale() -> String:
	return get_instance().fallback_locale

static func is_cjk_locale() -> bool:
	var loc := get_current_locale().to_lower()
	return loc.begins_with("zh") or loc.begins_with("ja") or loc.begins_with("ko")

static func has_key(key: String) -> bool:
	var inst := get_instance()
	return not inst._get_raw_text(key).is_empty()
