# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第14卷: 通知与公告系统视图控制器
# 文件路径: res://frontend/views/notification_bulletin/notification_bulletin_view.gd
# 职责: 气泡Toast堆叠调度、二次确认Modal弹窗、全服跑马灯与红点树角标同步；
#       3 个 Tab 子界面由 MainTabContainer 承载，右下角返回按钮调 ViewRouter.pop_view()。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name NotificationBulletinView
extends BaseScreen

## i18n 所属卷（第14卷：通知与公告系统）
const FE := "fe14"

const RedDotTreeManagerClass = preload("res://frontend/ui_infrastructure/red_dot_tree_manager.gd")

# ==============================================================================
# 枚举
# ==============================================================================

## 3 个 Tab 索引（与 MainTabContainer 子节点顺序一致）
enum TabType { NOTIFICATION_CENTER, BULLETIN_BOARD, RED_DOT_TREE }

## 通知分类
enum NotifCategory { SYSTEM, COMBAT, SOCIAL, QUEST, REWARD, WARNING }

## 公告优先级
enum BulletinPriority { NORMAL, IMPORTANT, URGENT, CRITICAL }

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

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/文案/三 Tab 装配/信号绑定/视觉适配（骨架零接线）
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
	# --- 顶栏 ---
	var title_label: Label = $MainLayout/HeaderPanel/HeaderHBox/TitleLabel
	UIIntermediary.resolve(title_label, "ui.fe14.common.header_title")
	UIIntermediary.resolve(_btn_back, "ui.fe14.common.back")

	# --- 主 Tab 标题 ---
	UIIntermediary.resolve_tab(_main_tab_container, 0, "ui.fe14.notification.tab_title")
	UIIntermediary.resolve_tab(_main_tab_container, 1, "ui.fe14.bulletin.tab_title")
	UIIntermediary.resolve_tab(_main_tab_container, 2, "ui.fe14.red_dot.tab_title")

	# --- Tab 1: 通知中心 ---
	var cat_title: Label = $MainLayout/MainTabContainer/通知中心/ContentSplit/LeftPanel/LeftVBox/LabelCategoryTitle
	UIIntermediary.resolve(cat_title, "ui.fe14.notification.category_title")
	var cat_hint: Label = $MainLayout/MainTabContainer/通知中心/ContentSplit/LeftPanel/LeftVBox/LabelCategoryHint
	UIIntermediary.resolve(cat_hint, "ui.fe14.notification.category_hint")
	UIIntermediary.resolve(_label_notif_detail_title, "ui.fe14.notification.select_hint")
	UIIntermediary.resolve(_label_notif_detail_category, "ui.fe14.notification.category_label", {"name": "-"})
	UIIntermediary.resolve(_label_notif_detail_time, "ui.fe14.notification.time_label", {"time": "-"})
	UIIntermediary.resolve(_btn_jump_target, "ui.fe14.notification.jump_btn")
	UIIntermediary.resolve(_btn_mark_all_read, "ui.fe14.notification.mark_all_read_btn")
	UIIntermediary.resolve(_btn_clear_notif, "ui.fe14.notification.clear_read_btn")

	# --- Tab 2: 公告板 ---
	UIIntermediary.resolve(_label_bulletin_detail_title, "ui.fe14.bulletin.select_hint")
	UIIntermediary.resolve(_label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": "-"})
	UIIntermediary.resolve(_label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": "-"})

	# --- Tab 3: 红点树管理 ---
	var rd_title: Label = $MainLayout/MainTabContainer/红点树管理/RedDotHeaderRow/LabelRedDotTitle
	UIIntermediary.resolve(rd_title, "ui.fe14.red_dot.tab_title")
	UIIntermediary.resolve(_label_red_dot_total, "ui.fe14.red_dot.total_label", {"total": 0})
	UIIntermediary.resolve(_btn_clear_all_red_dots, "ui.fe14.red_dot.clear_all_btn")
	var rules_label: Label = $MainLayout/MainTabContainer/红点树管理/RulesPanel/LabelRules
	UIIntermediary.resolve(rules_label, "ui.fe14.red_dot.rules")

	# --- Toast / Modal 测试台 ---
	var test_panel_title: Label = $MainLayout/MainTabContainer/红点树管理/LabelTestPanelTitle
	UIIntermediary.resolve(test_panel_title, "ui.fe14.common.test_panel_title")
	var toast_subtitle: Label = $MainLayout/MainTabContainer/红点树管理/LabelToastSubtitle
	UIIntermediary.resolve(toast_subtitle, "ui.fe14.toast.test_title")
	UIIntermediary.resolve(_btn_toast_info, "ui.fe14.toast.btn_info")
	UIIntermediary.resolve(_btn_toast_success, "ui.fe14.toast.btn_success")
	UIIntermediary.resolve(_btn_toast_warning, "ui.fe14.toast.btn_warning")
	UIIntermediary.resolve(_btn_toast_error, "ui.fe14.toast.btn_error")
	var modal_subtitle: Label = $MainLayout/MainTabContainer/红点树管理/LabelModalSubtitle
	UIIntermediary.resolve(modal_subtitle, "ui.fe14.modal.test_title")
	UIIntermediary.resolve(_btn_modal_confirm, "ui.fe14.modal.btn_confirm")
	UIIntermediary.resolve(_btn_modal_yes_no, "ui.fe14.modal.btn_yes_no")
	UIIntermediary.resolve(_btn_modal_input, "ui.fe14.modal.btn_input")
	UIIntermediary.resolve(_label_test_status, "ui.fe14.common.test_status_waiting")

# ==============================================================================
# Tab 1: 通知中心
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
		{ "id": "N001", "category": 0, "title_key": "ui.fe14.notification.mock.n001.title", "content_key": "ui.fe14.notification.mock.n001.content", "time": "09-01 10:00", "read": false, "jump_target": "" },
		{ "id": "N002", "category": 1, "title_key": "ui.fe14.notification.mock.n002.title", "content_key": "ui.fe14.notification.mock.n002.content", "time": "09-01 09:32", "read": false, "jump_target": "world_map" },
		{ "id": "N003", "category": 2, "title_key": "ui.fe14.notification.mock.n003.title", "content_key": "ui.fe14.notification.mock.n003.content", "time": "09-01 08:15", "read": false, "jump_target": "guild_social" },
		{ "id": "N004", "category": 3, "title_key": "ui.fe14.notification.mock.n004.title", "content_key": "ui.fe14.notification.mock.n004.content", "time": "09-01 06:00", "read": true, "jump_target": "quest_causality" },
		{ "id": "N005", "category": 4, "title_key": "ui.fe14.notification.mock.n005.title", "content_key": "ui.fe14.notification.mock.n005.content", "time": "08-31 23:59", "read": true, "jump_target": "" },
		{ "id": "N006", "category": 5, "title_key": "ui.fe14.notification.mock.n006.title", "content_key": "ui.fe14.notification.mock.n006.content", "time": "08-31 20:30", "read": true, "jump_target": "character_progression" },
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

## 初始化公告板：分类 TabBar + 4 条 Mock 公告 + 列表首刷
func _init_bulletin_board() -> void:
	# 设置 TabBar 标签（使用 i18n key）
	_bulletin_tab_bar.clear_tabs()
	for tab_key in BULLETIN_TAB_KEYS:
		_bulletin_tab_bar.add_tab(UIIntermediary.text(tab_key))

	# Mock 公告数据（标题和内容使用 i18n key）
	_bulletin_data = [
		{ "id": "B001", "category": 0, "title_key": "ui.fe14.bulletin.mock.b001.title", "priority": 1, "time": "09-01 00:00", "content_key": "ui.fe14.bulletin.mock.b001.content" },
		{ "id": "B002", "category": 1, "title_key": "ui.fe14.bulletin.mock.b002.title", "priority": 0, "time": "08-31 18:00", "content_key": "ui.fe14.bulletin.mock.b002.content" },
		{ "id": "B003", "category": 2, "title_key": "ui.fe14.bulletin.mock.b003.title", "priority": 2, "time": "08-30 14:00", "content_key": "ui.fe14.bulletin.mock.b003.content" },
		{ "id": "B004", "category": 3, "title_key": "ui.fe14.bulletin.mock.b004.title", "priority": 1, "time": "08-28 10:00", "content_key": "ui.fe14.bulletin.mock.b004.content" },
	]
	_refresh_bulletin_list()

## 刷新公告列表（按分类筛选）
func _refresh_bulletin_list() -> void:
	_bulletin_item_list.clear()
	for item in _bulletin_data:
		# category 0 = 全部，否则按分类索引筛选
		if _bulletin_filter_idx > 0 and int(item.get("category", 0)) != _bulletin_filter_idx:
			continue
		UIIntermediary.resolve_item(_bulletin_item_list, item.get("title_key", ""))

## 选中公告后刷新详情面板
func _refresh_bulletin_detail() -> void:
	if _selected_bulletin_idx < 0 or _selected_bulletin_idx >= _bulletin_data.size():
		UIIntermediary.resolve(_label_bulletin_detail_title, "ui.fe14.bulletin.select_hint")
		UIIntermediary.resolve(_label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": "-"})
		UIIntermediary.resolve(_label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": "-"})
		_rich_text_bulletin_detail.text = ""
		return
	var item: Dictionary = _bulletin_data[_selected_bulletin_idx]
	var prio_idx: int = int(item.get("priority", 0))
	var prio_name: String = _priority_name(prio_idx)
	_label_bulletin_detail_title.text = UIIntermediary.text(item.get("title_key", ""))
	UIIntermediary.resolve(_label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": prio_name})
	UIIntermediary.resolve(_label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": item.get("time", "-")})
	_rich_text_bulletin_detail.text = UIIntermediary.text(item.get("content_key", ""))

## 优先级码 → i18n 优先级名（越界回退 NORMAL）
func _priority_name(prio: int) -> String:
	if prio >= 0 and prio < BULLETIN_PRIORITY_KEYS.size():
		return UIIntermediary.text(BULLETIN_PRIORITY_KEYS[prio])
	return UIIntermediary.text(BULLETIN_PRIORITY_KEYS[BulletinPriority.NORMAL])

# ==============================================================================
# Tab 3: 红点树管理
# ==============================================================================

## 初始化红点树：列标题 + Mock 系统/模块两级树 + 总数首刷
func _init_red_dot_tree() -> void:
	_red_dot_tree.clear()
	# 设置列标题
	_red_dot_tree.set_column_title(0, UIIntermediary.text("ui.fe14.red_dot.col_node_path"))
	_red_dot_tree.set_column_title(1, UIIntermediary.text("ui.fe14.red_dot.col_count"))

	# 创建红点树 Mock 数据
	_red_dot_root = _red_dot_tree.create_item()
	_red_dot_root.set_text(0, "Root")
	_red_dot_root.set_text(1, "12")

	# 系统级节点
	var sys_item: TreeItem = _red_dot_tree.create_item(_red_dot_root)
	sys_item.set_text(0, "menu")
	sys_item.set_text(1, "5")

	var mail_item: TreeItem = _red_dot_tree.create_item(sys_item)
	mail_item.set_text(0, "menu.mail")
	mail_item.set_text(1, "3")

	var bag_item: TreeItem = _red_dot_tree.create_item(sys_item)
	bag_item.set_text(0, "menu.bag")
	bag_item.set_text(1, "2")

	# 模块级节点
	var module_item: TreeItem = _red_dot_tree.create_item(_red_dot_root)
	module_item.set_text(0, "module")
	module_item.set_text(1, "7")

	var quest_item: TreeItem = _red_dot_tree.create_item(module_item)
	quest_item.set_text(0, "module.quest")
	quest_item.set_text(1, "4")

	var skill_item: TreeItem = _red_dot_tree.create_item(module_item)
	skill_item.set_text(0, "module.skill")
	skill_item.set_text(1, "3")

	_refresh_red_dot_total()

## 刷新红点总数
func _refresh_red_dot_total() -> void:
	var total := 0
	if _red_dot_root:
		total = int(_red_dot_root.get_text(1))
	UIIntermediary.resolve(_label_red_dot_total, "ui.fe14.red_dot.total_label", {"total": total})

# ==============================================================================
# Toast / Modal 测试台
# ==============================================================================

## 展示 Toast：入队并刷新测试台状态文案
func _show_toast(type: String, message: String) -> void:
	toast_queue.append({ "type": type, "msg": message })
	UIIntermediary.resolve(_label_test_status, "ui.fe14.toast.status_format", {"type": type, "msg": message})

## 展示 Modal：记录活动对话框并刷新测试台状态文案
func _show_modal(type: String, message: String) -> void:
	active_modal_dialog = { "type": type, "content": message }
	UIIntermediary.resolve(_label_test_status, "ui.fe14.modal.status_format", {"type": type, "msg": message})

# ==============================================================================
# 信号绑定
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

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_btn_pressed() -> void:
	ViewRouter.get_instance().pop_view()

## 主 Tab 切换：骨架阶段占位
func _on_tab_changed(_tab_idx: int) -> void:
	NavManager.get_instance().show_toast("切换公告分类", NavTypes.ToastLevel.INFO, 1.0)

# --- 通知中心 ---

## 通知分类选中：更新筛选（0=全部→-1）并刷新列表与详情
func _on_notif_category_selected(idx: int) -> void:
	_notif_category_filter = idx - 1  # 0 = 全部(-1)，1~6 = 各分类
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

## 跳转目标按钮：非空跳转目标经 ViewRouter 推入目标视图
func _on_jump_target_pressed() -> void:
	if _selected_notif_idx < 0 or _selected_notif_idx >= _notif_data.size():
		return
	var jump: String = _notif_data[_selected_notif_idx].get("jump_target", "")
	if not jump.is_empty():
		ViewRouter.get_instance().push_view(jump)

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

# --- 公告板 ---

## 公告分类 Tab 切换：更新筛选并刷新列表与详情
func _on_bulletin_tab_changed(idx: int) -> void:
	_bulletin_filter_idx = idx
	_selected_bulletin_idx = -1
	_refresh_bulletin_list()
	_refresh_bulletin_detail()

## 公告条目选中：过滤后反查实际索引并刷新详情
func _on_bulletin_item_selected(idx: int) -> void:
	# 映射回实际索引
	var filtered_idx := 0
	for i in _bulletin_data.size():
		var item: Dictionary = _bulletin_data[i]
		if _bulletin_filter_idx > 0 and int(item.get("category", 0)) != _bulletin_filter_idx:
			continue
		if filtered_idx == idx:
			_selected_bulletin_idx = i
			_refresh_bulletin_detail()
			return
		filtered_idx += 1

# --- 红点树 ---

## 清除全部红点按钮：递归清零计数并刷新总数/状态文案
func _on_clear_all_red_dots_pressed() -> void:
	# 清除所有红点计数
	if _red_dot_root:
		_clear_red_dot_recursive(_red_dot_root)
	_refresh_red_dot_total()
	UIIntermediary.resolve(_label_test_status, "ui.fe14.red_dot.clear_status")

## 递归清零红点计数（树遍历）
func _clear_red_dot_recursive(item: TreeItem) -> void:
	item.set_text(1, "0")
	var child: TreeItem = item.get_first_child()
	while child != null:
		_clear_red_dot_recursive(child)
		child = child.get_next()

## 红点节点激活：渲染节点路径与计数到状态文案
func _on_red_dot_item_activated() -> void:
	var selected: TreeItem = _red_dot_tree.get_selected()
	if selected:
		var path: String = selected.get_text(0)
		var count: String = selected.get_text(1)
		UIIntermediary.resolve(_label_test_status, "ui.fe14.red_dot.node_info", {"path": path, "count": count})

# ==============================================================================
# 外部 API（保留数据桩接口供未来接线）
# ==============================================================================

## 外部 API 桩：推送 Toast（时长负值取配置默认 3s）
func push_toast(message: String, duration: float = -1.0) -> Dictionary:
	var default_dur: float = GameConfig.get_float("frontend.views", "fe14_notification_bulletin/default_toast_duration", 3.0)
	var final_dur: float = duration if duration > 0.0 else default_dur
	var item = { "msg": message, "duration": final_dur }
	toast_queue.append(item)
	return { "success": true, "toast": item }

## 外部 API 桩：展示 Modal 对话框（记录标题/内容/确认标签）
func show_modal_dialog(title: String, content: String, on_confirm_tag: String) -> void:
	active_modal_dialog = { "title": title, "content": content, "confirm_tag": on_confirm_tag }

## 外部 API 桩：关闭当前 Modal 对话框
func close_modal_dialog() -> void:
	active_modal_dialog.clear()

## 外部 API 桩：设置红点角标计数（经统一快照入口，同步 RedDotTreeManager 供 KBadge 消费）
func set_red_dot_badge(node_path: String, count: int) -> void:
	apply_snapshot({"red_dot_path": node_path, "red_dot_count": count})

## 统一快照渲染映射（P81）：红点角标 → 视图状态与红点树
func _render_from_snapshot() -> void:
	if snapshot.has("red_dot_path"):
		var path := str(snapshot.get("red_dot_path", ""))
		var count := int(snapshot.get("red_dot_count", 0))
		red_dot_badges[path] = count
		RedDotTreeManagerClass.get_instance().set_count(path, count)
