# ==============================================================================
# 模块归属: 前端通知视图域 (fe14 通知与公告系统)
# 文件路径: res://frontend/views/notification_bulletin/notification_bulletin_view.gd
# 架构定位: BaseScreen 视图控制器；承载通知中心、公告板与红点树及 Toast/Modal 测试台
# 依赖与触发: 依赖 ThemeManager、UIIntermediary、RedDotTreeManager 与 Tabs 委托
# 职责说明: 维护通知分类筛选、已读状态与红点快照同步，公告与红点树委派 Tabs 管理
# 退出语义与设计依据: 返回操作调用 self.back()；公开测试接口经 apply_snapshot 驱动
# ==============================================================================
## 通知与公告系统主视图控制器，协调消息筛选、公告板展示与红点角标测试台。
class_name NotificationBulletinView
extends BaseScreen

const NotificationBulletinTabsClass = preload("res://frontend/views/notification_bulletin/notification_bulletin_tabs.gd")
const RedDotTreeManagerClass = preload("res://frontend/ui_infrastructure/red_dot_tree_manager.gd")

## i18n 所属卷（第14卷：通知与公告系统）
const FRONTEND_VOLUME_CODE := "fe14"

# ==============================================================================
# 枚举
# ==============================================================================

## 3 个 Tab 索引（与 MainTabContainer 子节点顺序一致）
enum TabType {NOTIFICATION_CENTER, BULLETIN_BOARD, RED_DOT_TREE}

## 通知分类
enum NotifCategory {SYSTEM, COMBAT, SOCIAL, QUEST, REWARD, WARNING}

## 公告优先级
enum BulletinPriority {NORMAL, IMPORTANT, URGENT, CRITICAL}

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 顶部标题栏 ---
@onready var _back_button: Button = $%BtnBack

# --- 主 TabContainer ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 1: 通知中心 ---
@onready var _notification_category_list: ItemList = $%NotifCategoryList
@onready var _label_notification_unread_count: Label = $%LabelNotifUnreadCount
@onready var _notification_item_list: ItemList = $%NotifItemList
@onready var _label_notification_detail_title: Label = $%LabelNotifDetailTitle
@onready var _label_notification_detail_category: Label = $%LabelNotifDetailCategory
@onready var _label_notification_detail_time: Label = $%LabelNotifDetailTime
@onready var _rich_text_notification_detail: RichTextLabel = $%RichTextNotifDetail
@onready var _jump_target_button: Button = $%BtnJumpTarget
@onready var _mark_all_read_button: Button = $%BtnMarkAllRead
@onready var _clear_notifications_button: Button = $%BtnClearNotif

# --- Tab 2: 公告板 ---
@onready var _bulletin_tab_bar: TabBar = $%BulletinTabBar
@onready var _bulletin_item_list: ItemList = $%BulletinItemList
@onready var label_bulletin_detail_title: Label = $%LabelBulletinDetailTitle
@onready var label_bulletin_detail_priority: Label = $%LabelBulletinDetailPriority
@onready var label_bulletin_detail_time: Label = $%LabelBulletinDetailTime
@onready var rich_text_bulletin_detail: RichTextLabel = $%RichTextBulletinDetail

# --- Tab 3: 红点树管理 ---
@onready var label_red_dot_total: Label = $%LabelRedDotTotal
@onready var _clear_all_red_dots_button: Button = $%BtnClearAllRedDots
@onready var _red_dot_tree: Tree = $%RedDotTree
@onready var _toast_info_button: Button = $%BtnToastInfo
@onready var _toast_success_button: Button = $%BtnToastSuccess
@onready var _toast_warning_button: Button = $%BtnToastWarning
@onready var _toast_error_button: Button = $%BtnToastError
@onready var _modal_confirm_button: Button = $%BtnModalConfirm
@onready var _modal_yes_no_button: Button = $%BtnModalYesNo
@onready var _modal_input_button: Button = $%BtnModalInput
@onready var _label_test_status: Label = $%LabelTestStatus

# ==============================================================================
# 常量
# ==============================================================================

## 通知分类 i18n key（与 NotifCategory 枚举顺序一致）
const NOTIFICATION_CATEGORY_KEYS := [
	"ui.fe14.notification.category.system",
	"ui.fe14.notification.category.combat",
	"ui.fe14.notification.category.social",
	"ui.fe14.notification.category.quest",
	"ui.fe14.notification.category.reward",
	"ui.fe14.notification.category.warning",
]
## 公告分类 Tab i18n key（与 BulletinTabBar 索引一致，0=全部）
const BULLETIN_TAB_KEYS := [
	"ui.fe14.bulletin.tab.all",
	"ui.fe14.bulletin.tab.event",
	"ui.fe14.bulletin.tab.maintenance",
	"ui.fe14.bulletin.tab.version",
]
## 公告优先级 i18n key（与 BulletinPriority 枚举顺序一致）
const BULLETIN_PRIORITY_KEYS := [
	"ui.fe14.bulletin.priority.normal",
	"ui.fe14.bulletin.priority.important",
	"ui.fe14.bulletin.priority.urgent",
	"ui.fe14.bulletin.priority.critical",
]

# ==============================================================================
# 状态数据
# ==============================================================================

## 通知列表预设数据
var _notification_entries: Array = []
## 当前选中的通知索引
var _selected_notification_index: int = -1
## 当前选中的通知分类筛选（-1 = 全部）
var _notification_category_filter: int = -1


## Toast 队列
var toast_queue: Array = []
## 活跃的 Modal 对话框
var active_modal_dialog: Dictionary = {}
## 红点角标计数
var red_dot_badges: Dictionary = {}
var _tabs: Variant = null

# ==============================================================================
# 生命周期
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(NotificationBulletinTabsClass.new())
		_tabs.setup(self)
	return _tabs

## 生命周期初始化：应用主题、注入静态文案、装配三页签数据并绑定交互信号。
func _ready() -> void:
	# 1. 应用主题
	_apply_theme()

	# 2. 初始化静态文案（i18n 注入）
	_init_static_text()

	# 3. 初始化通知中心
	_init_notification_center()

	# 4. 初始化公告板
	_init_bulletin_board()

	# 5. 初始化红点树
	_init_red_dot_tree()

	# 6. 绑定信号（仅本地 UI 交互反馈）
	_connect_signals()

	# 7. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

# ==============================================================================
# 主题应用
# ==============================================================================

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

# ==============================================================================
# 静态文案初始化（i18n 注入）
# ==============================================================================

## 初始化全部静态文案：顶栏/三 Tab 标题/分类与提示/详情空态/Toast·Modal 测试台（i18n 全驱动）
func _init_static_text() -> void:
	_get_tabs().init_static_text()

# ==============================================================================

## 初始化通知中心：分类列表 + 6 条预设通知 + 列表/未读计数首刷
func _init_notification_center() -> void:
	# 填充分类列表（使用 i18n key，显示时翻译）
	_notification_category_list.clear()
	UIIntermediary.resolve_item(_notification_category_list, "ui.fe14.notification.category_all")
	for category_key in NOTIFICATION_CATEGORY_KEYS:
		UIIntermediary.resolve_item(_notification_category_list, category_key)
	_notification_category_list.select(0)

	# 预设通知数据（标题和内容使用 i18n key）
	_notification_entries = [
		{"id": "N001", "category": 0, "title_key": "ui.fe14.notification.mock.n001.title", "content_key": "ui.fe14.notification.mock.n001.content", "time": "09-01 10:00", "read": false, "jump_target": ""},
		{"id": "N002", "category": 1, "title_key": "ui.fe14.notification.mock.n002.title", "content_key": "ui.fe14.notification.mock.n002.content", "time": "09-01 09:32", "read": false, "jump_target": "world_map"},
		{"id": "N003", "category": 2, "title_key": "ui.fe14.notification.mock.n003.title", "content_key": "ui.fe14.notification.mock.n003.content", "time": "09-01 08:15", "read": false, "jump_target": "guild_social"},
		{"id": "N004", "category": 3, "title_key": "ui.fe14.notification.mock.n004.title", "content_key": "ui.fe14.notification.mock.n004.content", "time": "09-01 06:00", "read": true, "jump_target": "quest_causality"},
		{"id": "N005", "category": 4, "title_key": "ui.fe14.notification.mock.n005.title", "content_key": "ui.fe14.notification.mock.n005.content", "time": "08-31 23:59", "read": true, "jump_target": ""},
		{"id": "N006", "category": 5, "title_key": "ui.fe14.notification.mock.n006.title", "content_key": "ui.fe14.notification.mock.n006.content", "time": "08-31 20:30", "read": true, "jump_target": "character_progression"},
	]
	_refresh_notif_list()
	_refresh_notif_unread_count()

## 刷新通知列表（按分类筛选）
func _refresh_notif_list() -> void:
	_notification_item_list.clear()
	for notification_index in _notification_entries.size():
		var notification_entry: Dictionary = _notification_entries[notification_index]
		# 分类筛选：-1 = 全部
		if _notification_category_filter >= 0 and int(notification_entry.get("category", 0)) != _notification_category_filter:
			continue
		var read_marker := "" if notification_entry.get("read", false) else UIIntermediary.text("ui.fe14.notification.new_marker")
		var title_text: String = UIIntermediary.text(notification_entry.get("title_key", ""))
		var item_index: int = _notification_item_list.add_item("%s%s" % [read_marker, title_text])
		# 未读项加粗标记
		if not notification_entry.get("read", false):
			_notification_item_list.set_item_custom_fg_color(item_index, DesignTokens.COLOR_ACCENT_DEFAULT)

## 刷新未读计数
func _refresh_notif_unread_count() -> void:
	var unread_count := 0
	var total_count := 0
	for notification_entry in _notification_entries:
		total_count += 1
		if not notification_entry.get("read", false):
			unread_count += 1
	UIIntermediary.resolve(_label_notification_unread_count, "ui.fe14.notification.unread_count", {"unread": unread_count, "total": total_count})

## 选中通知后刷新详情面板
func _refresh_notif_detail() -> void:
	if _selected_notification_index < 0 or _selected_notification_index >= _notification_entries.size():
		UIIntermediary.resolve(_label_notification_detail_title, "ui.fe14.notification.select_hint")
		UIIntermediary.resolve(_label_notification_detail_category, "ui.fe14.notification.category_label", {"name": "-"})
		UIIntermediary.resolve(_label_notification_detail_time, "ui.fe14.notification.time_label", {"time": "-"})
		_rich_text_notification_detail.text = ""
		_jump_target_button.disabled = true
		return
	var notification_entry: Dictionary = _notification_entries[_selected_notification_index]
	var category_index: int = int(notification_entry.get("category", 0))
	var category_key: String = NOTIFICATION_CATEGORY_KEYS[category_index] if category_index < NOTIFICATION_CATEGORY_KEYS.size() else "ui.fe14.common.unknown"
	var category_name: String = UIIntermediary.text(category_key)
	_label_notification_detail_title.text = UIIntermediary.text(notification_entry.get("title_key", ""))
	UIIntermediary.resolve(_label_notification_detail_category, "ui.fe14.notification.category_label", {"name": category_name})
	UIIntermediary.resolve(_label_notification_detail_time, "ui.fe14.notification.time_label", {"time": notification_entry.get("time", "-")})
	_rich_text_notification_detail.text = UIIntermediary.text(notification_entry.get("content_key", ""))
	# 如果有跳转目标则启用按钮
	var jump_target: String = notification_entry.get("jump_target", "")
	_jump_target_button.disabled = jump_target.is_empty()

# ==============================================================================
# Tab 2: 公告板
# ==============================================================================
# Tab 1 & 2 委托给 NotificationBulletinTabs
# ==============================================================================

func _init_bulletin_board() -> void:
	_get_tabs().init_bulletin_board()

func _refresh_bulletin_list() -> void:
	_get_tabs().refresh_bulletin_list()

func _refresh_bulletin_detail() -> void:
	_get_tabs().refresh_bulletin_detail()

func _priority_name(priority_value: int) -> String:
	return _get_tabs().priority_name(priority_value)

func _init_red_dot_tree() -> void:
	_get_tabs().init_red_dot_tree()

func _refresh_red_dot_total() -> void:
	_get_tabs().refresh_red_dot_total()

func _show_toast(toast_type: String, message: String) -> void:
	_get_tabs().show_toast(toast_type, message)

func _show_modal(modal_type: String, message: String) -> void:
	_get_tabs().show_modal(modal_type, message)

# ==============================================================================

## 绑定本地 UI 交互信号（通知/公告/红点树/Toast·Modal 测试台的本地响应）
func _connect_signals() -> void:
	# 返回按钮
	connect_managed(_back_button.pressed, _on_back_btn_pressed)

	# Tab 切换
	connect_managed(_main_tab_container.tab_changed, _on_tab_changed)

	# 通知中心
	connect_managed(_notification_category_list.item_selected, _on_notif_category_selected)
	connect_managed(_notification_item_list.item_selected, _on_notif_item_selected)
	connect_managed(_jump_target_button.pressed, _on_jump_target_pressed)
	connect_managed(_mark_all_read_button.pressed, _on_mark_all_read_pressed)
	connect_managed(_clear_notifications_button.pressed, _on_clear_notif_pressed)

	# 公告板
	connect_managed(_bulletin_tab_bar.tab_changed, _on_bulletin_tab_changed)
	connect_managed(_bulletin_item_list.item_selected, _on_bulletin_item_selected)

	# 红点树
	connect_managed(_clear_all_red_dots_button.pressed, _on_clear_all_red_dots_pressed)
	connect_managed(_red_dot_tree.item_activated, _on_red_dot_item_activated)

	# Toast 测试
	connect_managed(_toast_info_button.pressed, func(): _show_toast("INFO", UIIntermediary.text("ui.fe14.toast.test.info")))
	connect_managed(_toast_success_button.pressed, func(): _show_toast("SUCCESS", UIIntermediary.text("ui.fe14.toast.test.success")))
	connect_managed(_toast_warning_button.pressed, func(): _show_toast("WARNING", UIIntermediary.text("ui.fe14.toast.test.warning")))
	connect_managed(_toast_error_button.pressed, func(): _show_toast("ERROR", UIIntermediary.text("ui.fe14.toast.test.error")))

	# Modal 测试
	connect_managed(_modal_confirm_button.pressed, func(): _show_modal("CONFIRM", UIIntermediary.text("ui.fe14.modal.test.confirm")))
	connect_managed(_modal_yes_no_button.pressed, func(): _show_modal("YES_NO", UIIntermediary.text("ui.fe14.modal.test.yes_no")))
	connect_managed(_modal_input_button.pressed, func(): _show_modal("INPUT", UIIntermediary.text("ui.fe14.modal.test.input")))

# ==============================================================================
# 信号回调
# ==============================================================================

## 返回按钮：经 BaseScreen.back 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	self.back()

## 主 Tab 切换：切换至公告或红点树时同步刷新对应统计展示
func _on_tab_changed(tab_index: int) -> void:
	if tab_index == 0:
		_refresh_notif_list()
	elif tab_index == 2 and _tabs != null:
		_tabs.refresh_red_dot_total()

# --- 通知中心 ---

## 通知分类选中：更新筛选（0=全部→-1）并刷新列表与详情
func _on_notif_category_selected(category_index: int) -> void:
	_notification_category_filter = category_index - 1 # 0 = 全部(-1)，1~6 = 各分类
	_selected_notification_index = -1
	_refresh_notif_list()
	_refresh_notif_detail()

## 通知条目选中：过滤后反查实际索引、标记已读并刷新列表/未读/详情
func _on_notif_item_selected(item_index: int) -> void:
	# 将 ItemList 索引映射回 _notification_entries 的实际索引
	var filtered_index := 0
	for notification_index in _notification_entries.size():
		var notification_entry: Dictionary = _notification_entries[notification_index]
		if _notification_category_filter >= 0 and int(notification_entry.get("category", 0)) != _notification_category_filter:
			continue
		if filtered_index == item_index:
			_selected_notification_index = notification_index
			# 标记为已读
			notification_entry["read"] = true
			_refresh_notif_list()
			_refresh_notif_unread_count()
			_refresh_notif_detail()
			return
		filtered_index += 1

## 跳转目标按钮：非空跳转目标经 NavManager 推入目标视图
func _on_jump_target_pressed() -> void:
	if _selected_notification_index < 0 or _selected_notification_index >= _notification_entries.size():
		return
	var jump_target: String = _notification_entries[_selected_notification_index].get("jump_target", "")
	if not jump_target.is_empty():
		NavManager.get_instance().push_screen(jump_target)

## 全部已读按钮：批量标记并刷新列表/未读计数与状态文案
func _on_mark_all_read_pressed() -> void:
	for notification_entry in _notification_entries:
		notification_entry["read"] = true
	_refresh_notif_list()
	_refresh_notif_unread_count()
	UIIntermediary.resolve(_label_test_status, "ui.fe14.notification.mark_all_read_status")

## 清除已读按钮：过滤保留未读通知并刷新列表/未读/详情与状态文案
func _on_clear_notif_pressed() -> void:
	_notification_entries = _notification_entries.filter(func(notification_entry): return not notification_entry.get("read", false))
	_selected_notification_index = -1
	_refresh_notif_list()
	_refresh_notif_unread_count()
	_refresh_notif_detail()
	UIIntermediary.resolve(_label_test_status, "ui.fe14.notification.clear_read_status")

# --- 公告板与红点树（委托给 NotificationBulletinTabs）---

func _on_bulletin_tab_changed(tab_index: int) -> void:
	_get_tabs().on_bulletin_tab_changed(tab_index)

func _on_bulletin_item_selected(item_index: int) -> void:
	_get_tabs().on_bulletin_item_selected(item_index)

func _on_clear_all_red_dots_pressed() -> void:
	_get_tabs().on_clear_all_red_dots_pressed()

func _clear_red_dot_recursive(tree_item: TreeItem) -> void:
	_get_tabs().clear_red_dot_recursive(tree_item)

func _on_red_dot_item_activated() -> void:
	_get_tabs().on_red_dot_item_activated()

# ==============================================================================
# 外部接口（供测试与上层消息驱动）
# ==============================================================================

## 将一条提示消息压入测试队列并在树内挂载时透传全局 Toast。
func push_toast(text: String, duration: float) -> Dictionary:
	var toast_entry: Dictionary = {"text": text, "duration": duration}
	toast_queue.append(toast_entry)
	if is_inside_tree():
		NavManager.get_instance().show_toast(text, NavTypes.ToastLevel.INFO, duration)
	return {"success": true, "toast": toast_entry}

## 打开并记录当前活跃的模态确认对话框状态。
func show_modal_dialog(title: String, content: String, on_confirm_tag: String) -> void:
	active_modal_dialog = {"title": title, "content": content, "confirm_tag": on_confirm_tag}

## 清空并关闭当前活跃的模态对话框状态。
func close_modal_dialog() -> void:
	active_modal_dialog.clear()

## 通过快照入口设置指定节点路径的红点角标计数。
func set_red_dot_badge(node_path: String, count: int) -> void:
	apply_snapshot({"red_dot_path": node_path, "red_dot_count": count})

func _render_from_snapshot() -> void:
	if snapshot.has("red_dot_path"):
		var node_path_text := str(snapshot.get("red_dot_path", ""))
		var badge_count := int(snapshot.get("red_dot_count", 0))
		red_dot_badges[node_path_text] = badge_count
		RedDotTreeManagerClass.get_instance().set_count(node_path_text, badge_count)
