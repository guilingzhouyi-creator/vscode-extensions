# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 标签栏 (KTabBar)
# 文件路径: res://frontend/components/k_tab_bar.gd
# 职责: 统一封装 TabContainer 的 i18n 驱动标题注入与动态 Tab 注册
# ==============================================================================
class_name KTabBar
extends TabContainer

# tab_changed 信号继承自 TabContainer：切换标签时原生派发当前索引 (int)，
# 无需重新声明；语言切换时 Tab 标题不自动刷新，需外部重新调用 init_all_titles。

@export var tab_keys: PackedStringArray = PackedStringArray()

func _ready() -> void:
	if tab_keys.size() > 0:
		init_all_titles(tab_keys)
	tab_changed.connect(_on_tab_changed)

## 注册单个 Tab 标题（i18n key 驱动，不注册语言切换绑定）
func register_tab(index: int, title_key: String) -> void:
	UIIntermediary.resolve_tab(self, index, title_key)

## 批量初始化所有 Tab 标题（语言切换时需外部重新调用刷新）
func init_all_titles(keys: PackedStringArray) -> void:
	for i in range(keys.size()):
		UIIntermediary.resolve_tab(self, i, keys[i])

## 获取当前选中 Tab 索引
func get_current_tab_index() -> int:
	return current_tab

## Tab 切换钩子（tab_changed 信号由 TabContainer 原生派发，子类可覆写此方法响应切换）
func _on_tab_changed(tab: int) -> void:
	pass

## 静态方法：为任意 TabContainer 批量初始化 i18n 标题（无需替换为 KTabBar 节点即可使用）
static func init_titles(container: TabContainer, keys: PackedStringArray) -> void:
	for i in range(keys.size()):
		if i < container.get_tab_count():
			UIIntermediary.resolve_tab(container, i, keys[i])
