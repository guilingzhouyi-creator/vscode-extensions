# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第14卷: 通知与公告系统视图控制器
# 文件路径: res://frontend/views/notification_bulletin/notification_bulletin_view.gd
# 职责: 气泡Toast堆叠调度、二次确认Modal弹窗、全服跑马灯与红点树角标同步；
#       3 个 Tab 子界面由 MainTabContainer 承载，右下角返回按钮调 BaseScreen.back()。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name NotificationBulletinView
extends BaseScreen

const NotificationBulletinTabsClass = preload("res://frontend/views/notification_bulletin/notification_bulletin_tabs.gd")

## i18n 所属卷（第14卷：通知与公告系统）
const FE := "fe14"

const RedDotTreeManagerClass = preload("res://frontend/ui_infrastructure/red_dot_tree_manager.gd")

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
@onready var _btn_back: Button = $%BtnBack

# --- 主 TabContainer ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 1: 通知中心 ---
@onready var _notif_category_list: ItemList = $%NotifCategoryList
@onready var _label_notif_unread_count: Label = $%LabelNotifUnreadCount
@onready var _notif_item_list: ItemList = $%NotifItemList
@onready var _label_notif_detail_title: Label = $%LabelNotifDetailTitle
@onready var _label_notif_detail_category: Label = $%LabelNotifDetailCategory
@onready var _label_notif_detail_time: Label = $%LabelNotifDetailTime
@onready var _rich_text_notif_detail: RichTextLabel = $%RichTextNotifDetail
@onready var _btn_jump_target: Button = $%BtnJumpTarget
@onready var _btn_mark_all_read: Button = $%BtnMarkAllRead
@onready var _btn_clear_notif: Button = $%BtnClearNotif

# --- Tab 2: 公告板 ---
@onready var _bulletin_tab_bar: TabBar = $%BulletinTabBar
@onready var _bulletin_item_list: ItemList = $%BulletinItemList
@onready var _label_bulletin_detail_title: Label = $%LabelBulletinDetailTitle
@onready var _label_bulletin_detail_priority: Label = $%LabelBulletinDetailPriority
@onready var _label_bulletin_detail_time: Label = $%LabelBulletinDetailTime
@onready var _rich_text_bulletin_detail: RichTextLabel = $%RichTextBulletinDetail

# --- Tab 3: 红点树管理 ---
@onready var _label_red_dot_total: Label = $%LabelRedDotTotal
@onready var _btn_clear_all_red_dots: Button = $%BtnClearAllRedDots
@onready var _red_dot_tree: Tree = $%RedDotTree
@onready var _btn_toast_info: Button = $%BtnToastInfo
@onready var _btn_toast_success: Button = $%BtnToastSuccess
@onready var _btn_toast_warning: Button = $%BtnToastWarning
@onready var _btn_toast_error: Button = $%BtnToastError
@onready var _btn_modal_confirm: Button = $%BtnModalConfirm
@onready var _btn_modal_yes_no: Button = $%BtnModalYesNo
@onready var _btn_modal_input: Button = $%BtnModalInput
@onready var _label_test_status: Label = $%LabelTestStatus

# ==============================================================================
# 常量
# ==============================================================================

## 通知分类 i18n key（与 NotifCategory 枚举顺序一致）
const NOTIF_CATEGORY_KEYS := [
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

## 通知列表 Mock 数据
var _notif_data: Array = []
## 当前选中的通知索引
var _selected_notif_idx: int = -1
## 当前选中的通知分类筛选（-1 = 全部）
var _notif_category_filter: int = -1

## 公告列表 Mock 数据
var _bulletin_data: Array = []
## 当前选中的公告索引
var _selected_bulletin_idx: int = -1
## 当前选中的公告分类筛选（TabBar 索引）
var _bulletin_filter_idx: int = 0

## 红点树 Mock 数据
var _red_dot_root: TreeItem = null
## Toast 队列
var toast_queue: Array = []
## 活跃的 Modal 对话框
var active_modal_dialog: Dictionary = {}
## 红点角标计数
var red_dot_badges: Dictionary = {}
var _tabs = null

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/文案/三 Tab 装配/信号绑定/视觉适配（骨架零接线）
func _get_tabs():
	if _tabs == null:
		_tabs = NotificationBulletinTabsClass.new()
		_tabs.setup(self)
	return _tabs

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

	# 6. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 7. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# 主题应用
# ==============================================================================

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# 静态文案初始化（i18n 注入）
# ==============================================================================

## 初始化全部静态文案：顶栏/三 Tab 标题/分类与提示/详情占位/Toast·Modal 测试台（i18n 全驱动）
func _init_static_text() -> void:
	_get_tabs().init_static_text()

# ==============================================================================

## 初始化通知中心：分类列表 + 6 条 Mock 通知 + 列表/未读计数首刷
func _init_notification_center() -> void:
	# 填充分类列表（使用 i18n key，显示时翻译）
	_notif_category_list.clear()
	UIIntermediary.resolve_item(_notif_category_list, "ui.fe14.notification.category_all")
	for cat_key in NOTIF_CATEGORY_KEYS:
		UIIntermediary.resolve_item(_notif_category_list, cat_key)
	_notif_category_list.select(0)

	# Mock 通知数据（标题和内容使用 i18n key）
	_notif_data = [
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
	_notif_item_list.clear()
	for i in _notif_data.size():
		var item: Dictionary = _notif_data[i]
		# 分类筛选：-1 = 全部
		if _notif_category_filter >= 0 and int(item.get("category", 0)) != _notif_category_filter:
			continue
		var read_marker := "" if item.get("read", false) else "[新] "
		var title_text: String = UIIntermediary.text(item.get("title_key", ""))
		var idx: int = _notif_item_list.add_item("%s%s" % [read_marker, title_text])
		# 未读项加粗标记
		if not item.get("read", false):
			_notif_item_list.set_item_custom_fg_color(idx, DesignTokens.COLOR_ACCENT_DEFAULT)

## 刷新未读计数
func _refresh_notif_unread_count() -> void:
	var unread := 0
	var total := 0
	for item in _notif_data:
		total += 1
		if not item.get("read", false):
			unread += 1
	UIIntermediary.resolve(_label_notif_unread_count, "ui.fe14.notification.unread_count", {"unread": unread, "total": total})

## 选中通知后刷新详情面板
func _refresh_notif_detail() -> void:
	if _selected_notif_idx < 0 or _selected_notif_idx >= _notif_data.size():
		UIIntermediary.resolve(_label_notif_detail_title, "ui.fe14.notification.select_hint")
		UIIntermediary.resolve(_label_notif_detail_category, "ui.fe14.notification.category_label", {"name": "-"})
		UIIntermediary.resolve(_label_notif_detail_time, "ui.fe14.notification.time_label", {"time": "-"})
		_rich_text_notif_detail.text = ""
		_btn_jump_target.disabled = true
		return
	var item: Dictionary = _notif_data[_selected_notif_idx]
	var cat_idx: int = int(item.get("category", 0))
	var cat_key: String = NOTIF_CATEGORY_KEYS[cat_idx] if cat_idx < NOTIF_CATEGORY_KEYS.size() else "ui.fe14.common.unknown"
	var cat_name: String = UIIntermediary.text(cat_key)
	_label_notif_detail_title.text = UIIntermediary.text(item.get("title_key", ""))
	UIIntermediary.resolve(_label_notif_detail_category, "ui.fe14.notification.category_label", {"name": cat_name})
	UIIntermediary.resolve(_label_notif_detail_time, "ui.fe14.notification.time_label", {"time": item.get("time", "-")})
	_rich_text_notif_detail.text = UIIntermediary.text(item.get("content_key", ""))
	# 如果有跳转目标则启用按钮
	var jump: String = item.get("jump_target", "")
	_btn_jump_target.disabled = jump.is_empty()

# ==============================================================================
# Tab 2: 公告板
# ==============================================================================
# Tab 1 & 2 委托给 NotificationBulletinTabs
# ==============================================================================

func _init_bulletin_board() -> void:
	_get_tabs().init_bulletin_tab()

func _refresh_bulletin_list() -> void:
	_get_tabs().refresh_bulletin_list()

func _refresh_bulletin_detail() -> void:
	_get_tabs().refresh_bulletin_detail()

func _priority_name(prio: int) -> String:
	return _get_tabs().priority_name(prio)

func _init_red_dot_tree() -> void:
	_get_tabs().init_red_dot_tree()

func _refresh_red_dot_total() -> void:
	_get_tabs().refresh_red_dot_total()

func _show_toast(type: String, message: String) -> void:
	_get_tabs().show_toast(type, message)

func _show_modal(type: String, message: String) -> void:
	_get_tabs().show_modal(type, message)

# ==============================================================================

## 绑定本地 UI 交互信号（零接线：通知/公告/红点树/Toast·Modal 测试台本地闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_btn_pressed)

	# Tab 切换
	_main_tab_container.tab_changed.connect(_on_tab_changed)

	# 通知中心
	_notif_category_list.item_selected.connect(_on_notif_category_selected)
	_notif_item_list.item_selected.connect(_on_notif_item_selected)
	_btn_jump_target.pressed.connect(_on_jump_target_pressed)
	_btn_mark_all_read.pressed.connect(_on_mark_all_read_pressed)
	_btn_clear_notif.pressed.connect(_on_clear_notif_pressed)

	# 公告板
	_bulletin_tab_bar.tab_changed.connect(_on_bulletin_tab_changed)
	_bulletin_item_list.item_selected.connect(_on_bulletin_item_selected)

	# 红点树
	_btn_clear_all_red_dots.pressed.connect(_on_clear_all_red_dots_pressed)
	_red_dot_tree.item_activated.connect(_on_red_dot_item_activated)

	# Toast 测试
	_btn_toast_info.pressed.connect(func(): _show_toast("INFO", UIIntermediary.text("ui.fe14.toast.test.info")))
	_btn_toast_success.pressed.connect(func(): _show_toast("SUCCESS", UIIntermediary.text("ui.fe14.toast.test.success")))
	_btn_toast_warning.pressed.connect(func(): _show_toast("WARNING", UIIntermediary.text("ui.fe14.toast.test.warning")))
	_btn_toast_error.pressed.connect(func(): _show_toast("ERROR", UIIntermediary.text("ui.fe14.toast.test.error")))

	# Modal 测试
	_btn_modal_confirm.pressed.connect(func(): _show_modal("CONFIRM", UIIntermediary.text("ui.fe14.modal.test.confirm")))
	_btn_modal_yes_no.pressed.connect(func(): _show_modal("YES_NO", UIIntermediary.text("ui.fe14.modal.test.yes_no")))
	_btn_modal_input.pressed.connect(func(): _show_modal("INPUT", UIIntermediary.text("ui.fe14.modal.test.input")))

# ==============================================================================
# 信号回调
# ==============================================================================

## 返回按钮：经 BaseScreen.back 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	self.back()

## 主 Tab 切换：骨架阶段占位
func _on_tab_changed(_tab_idx: int) -> void:
	NavManager.get_instance().show_toast("切换公告分类", NavTypes.ToastLevel.INFO, 1.0)

# --- 通知中心 ---

## 通知分类选中：更新筛选（0=全部→-1）并刷新列表与详情
func _on_notif_category_selected(idx: int) -> void:
	_notif_category_filter = idx - 1 # 0 = 全部(-1)，1~6 = 各分类
	_selected_notif_idx = -1
	_refresh_notif_list()
	_refresh_notif_detail()

## 通知条目选中：过滤后反查实际索引、标记已读并刷新列表/未读/详情
func _on_notif_item_selected(idx: int) -> void:
	# 将 ItemList 索引映射回 _notif_data 的实际索引
	var filtered_idx := 0
	for i in _notif_data.size():
		var item: Dictionary = _notif_data[i]
		if _notif_category_filter >= 0 and int(item.get("category", 0)) != _notif_category_filter:
			continue
		if filtered_idx == idx:
			_selected_notif_idx = i
			# 标记为已读
			item["read"] = true
			_refresh_notif_list()
			_refresh_notif_unread_count()
			_refresh_notif_detail()
			return
		filtered_idx += 1

## 跳转目标按钮：非空跳转目标经 NavManager 推入目标视图
func _on_jump_target_pressed() -> void:
	if _selected_notif_idx < 0 or _selected_notif_idx >= _notif_data.size():
		return
	var jump: String = _notif_data[_selected_notif_idx].get("jump_target", "")
	if not jump.is_empty():
		NavManager.get_instance().push_screen(jump)

## 全部已读按钮：批量标记并刷新列表/未读计数与状态文案
func _on_mark_all_read_pressed() -> void:
	for item in _notif_data:
		item["read"] = true
	_refresh_notif_list()
	_refresh_notif_unread_count()
	UIIntermediary.resolve(_label_test_status, "ui.fe14.notification.mark_all_read_status")

## 清除已读按钮：过滤保留未读通知并刷新列表/未读/详情与状态文案
func _on_clear_notif_pressed() -> void:
	_notif_data = _notif_data.filter(func(item): return not item.get("read", false))
	_selected_notif_idx = -1
	_refresh_notif_list()
	_refresh_notif_unread_count()
	_refresh_notif_detail()
	UIIntermediary.resolve(_label_test_status, "ui.fe14.notification.clear_read_status")

# --- 公告板与红点树（委托给 NotificationBulletinTabs）---

func _on_bulletin_tab_changed(idx: int) -> void:
	_get_tabs().on_bulletin_tab_changed(idx)

func _on_bulletin_item_selected(idx: int) -> void:
	_get_tabs().on_bulletin_item_selected(idx)

func _on_clear_all_red_dots_pressed() -> void:
	_get_tabs().on_clear_all_red_dots_pressed()

func _clear_red_dot_recursive(item: TreeItem) -> void:
	_get_tabs().clear_red_dot_recursive(item)

func _on_red_dot_item_activated() -> void:
	_get_tabs().on_red_dot_item_activated()

# ==============================================================================
# 外部 API（保留数据桩接口供测试与未来接线）
# ==============================================================================

func push_toast(text: String, duration: float) -> Dictionary:
	var item = {"text": text, "duration": duration}
	toast_queue.append(item)
	return {"success": true, "toast": item}

func show_modal_dialog(title: String, content: String, on_confirm_tag: String) -> void:
	active_modal_dialog = {"title": title, "content": content, "confirm_tag": on_confirm_tag}

func close_modal_dialog() -> void:
	active_modal_dialog.clear()

func set_red_dot_badge(node_path: String, count: int) -> void:
	apply_snapshot({"red_dot_path": node_path, "red_dot_count": count})

func _render_from_snapshot() -> void:
	if snapshot.has("red_dot_path"):
		var path := str(snapshot.get("red_dot_path", ""))
		var count := int(snapshot.get("red_dot_count", 0))
		red_dot_badges[path] = count
		RedDotTreeManagerClass.get_instance().set_count(path, count)
