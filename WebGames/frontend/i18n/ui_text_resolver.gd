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

	var parsed_json: Variant = JSON.parse_string(content)
	if parsed_json is Dictionary:
		_dictionaries[locale] = parsed_json

## 核心翻译函数: resolve(key, params) → 翻译后模板字符串（已填充参数）
## 单引擎模板解析收敛：本函数只负责提取模板，参数填充唯一由 PlaceholderFiller 承担，
## 防止先裸替换再填充造成的二次消费与格式化空转。
static func resolve(key: String, params: Dictionary = {}) -> String:
	var resolver := get_instance()
	var template := resolver._get_raw_text(key)
	if template.is_empty():
		# 尝试从 frontend.views 配置回退检索模板
		var fallback_views := GameConfig.get_string("frontend.views", key, "")
		if not fallback_views.is_empty():
			return PlaceholderFiller.fill(fallback_views, params)
		# 若 key 自身已是包含空格或大括号的英文底座模板/人读消息，直接填充参数输出，避免被包装成 [key]
		if key.contains(" ") or key.contains("{"):
			return PlaceholderFiller.fill(key, params)
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
	var loc := get_current_locale().to_lower()
	return loc.begins_with("zh") or loc.begins_with("ja") or loc.begins_with("ko")

## 检查指定 i18n 键在当前语言或回退词库中是否存在有效词条
static func has_key(key: String) -> bool:
	var resolver := get_instance()
	return not resolver._get_raw_text(key).is_empty()
