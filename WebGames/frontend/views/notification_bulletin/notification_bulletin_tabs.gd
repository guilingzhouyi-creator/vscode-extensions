# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第14卷: 通知与公告系统子页面委托
# 文件路径: res://frontend/views/notification_bulletin/notification_bulletin_tabs.gd
# 职责: 承担 NotificationBulletinView 的公告板、红点树管理与测试台逻辑
# ==============================================================================
class_name NotificationBulletinTabs
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")

var page_header: KPageHeader = null

var _view = null

const BULLETIN_TAB_KEYS := [
	"ui.fe14.bulletin.tab.all",
	"ui.fe14.bulletin.tab.event",
	"ui.fe14.bulletin.tab.maintenance",
	"ui.fe14.bulletin.tab.version",
]

const BULLETIN_PRIORITY_KEYS := [
	"ui.fe14.bulletin.priority.normal",
	"ui.fe14.bulletin.priority.important",
	"ui.fe14.bulletin.priority.urgent",
	"ui.fe14.bulletin.priority.critical",
]

var bulletin_data: Array = []
var selected_bulletin_idx: int = -1
var bulletin_filter_idx: int = 0
var red_dot_root: TreeItem = null

func setup(view: BaseScreen) -> void:
	_view = view

func init_static_text() -> void:
	var view: NotificationBulletinView = _view
	var bindings := [
		[view.get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel"), "ui.fe14.common.header_title"],
		[view._btn_back, "ui.fe14.common.back"],
		[view.get_node_or_null("MainLayout/MainTabContainer/通知中心/ContentSplit/LeftPanel/LeftVBox/LabelCategoryTitle"), "ui.fe14.notification.category_title"],
		[view.get_node_or_null("MainLayout/MainTabContainer/通知中心/ContentSplit/LeftPanel/LeftVBox/LabelCategoryHint"), "ui.fe14.notification.category_hint"],
		[view._label_notif_detail_title, "ui.fe14.notification.select_hint"],
		[view._btn_jump_target, "ui.fe14.notification.jump_btn"],
		[view._btn_mark_all_read, "ui.fe14.notification.mark_all_read_btn"],
		[view._btn_clear_notif, "ui.fe14.notification.clear_read_btn"],
		[view._label_bulletin_detail_title, "ui.fe14.bulletin.select_hint"],
		[view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/RedDotHeaderRow/LabelRedDotTitle"), "ui.fe14.red_dot.tab_title"],
		[view._btn_clear_all_red_dots, "ui.fe14.red_dot.clear_all_btn"],
		[view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/RulesPanel/LabelRules"), "ui.fe14.red_dot.rules"],
		[view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/LabelTestPanelTitle"), "ui.fe14.common.test_panel_title"],
		[view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/LabelToastSubtitle"), "ui.fe14.toast.test_title"],
		[view._btn_toast_info, "ui.fe14.toast.btn_info"],
		[view._btn_toast_success, "ui.fe14.toast.btn_success"],
		[view._btn_toast_warning, "ui.fe14.toast.btn_warning"],
		[view._btn_toast_error, "ui.fe14.toast.btn_error"],
		[view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/LabelModalSubtitle"), "ui.fe14.modal.test_title"],
		[view._btn_modal_confirm, "ui.fe14.modal.btn_confirm"],
		[view._btn_modal_yes_no, "ui.fe14.modal.btn_yes_no"],
		[view._btn_modal_input, "ui.fe14.modal.btn_input"],
		[view._label_test_status, "ui.fe14.common.test_status_waiting"]
	]
	for b in bindings:
		if b[0] != null:
			UIIntermediary.resolve(b[0], b[1])

	KTabBar.init_titles(view._main_tab_container, PackedStringArray([
		"ui.fe14.notification.tab_title",
		"ui.fe14.bulletin.tab_title",
		"ui.fe14.red_dot.tab_title",
	]))

	if view._label_notif_detail_category != null:
		UIIntermediary.resolve(view._label_notif_detail_category, "ui.fe14.notification.category_label", {"name": "-"})
	if view._label_notif_detail_time != null:
		UIIntermediary.resolve(view._label_notif_detail_time, "ui.fe14.notification.time_label", {"time": "-"})
	if view._label_bulletin_detail_priority != null:
		UIIntermediary.resolve(view._label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": "-"})
	if view._label_bulletin_detail_time != null:
		UIIntermediary.resolve(view._label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": "-"})
	if view._label_red_dot_total != null:
		UIIntermediary.resolve(view._label_red_dot_total, "ui.fe14.red_dot.total_label", {"total": 0})

func init_bulletin_board() -> void:
	var view: NotificationBulletinView = _view
	view._bulletin_tab_bar.clear_tabs()
	for tab_key in BULLETIN_TAB_KEYS:
		view._bulletin_tab_bar.add_tab(UIIntermediary.text(tab_key))

	bulletin_data = [
		{"id": "B001", "category": 0, "title_key": "ui.fe14.bulletin.mock.b001.title", "priority": 1, "time": "09-01 00:00", "content_key": "ui.fe14.bulletin.mock.b001.content"},
		{"id": "B002", "category": 1, "title_key": "ui.fe14.bulletin.mock.b002.title", "priority": 0, "time": "08-31 18:00", "content_key": "ui.fe14.bulletin.mock.b002.content"},
		{"id": "B003", "category": 2, "title_key": "ui.fe14.bulletin.mock.b003.title", "priority": 2, "time": "08-30 14:00", "content_key": "ui.fe14.bulletin.mock.b003.content"},
		{"id": "B004", "category": 3, "title_key": "ui.fe14.bulletin.mock.b004.title", "priority": 1, "time": "08-28 10:00", "content_key": "ui.fe14.bulletin.mock.b004.content"},
	]
	refresh_bulletin_list()

func refresh_bulletin_list() -> void:
	var view: NotificationBulletinView = _view
	view._bulletin_item_list.clear()
	for item in bulletin_data:
		if bulletin_filter_idx > 0 and int(item.get("category", 0)) != bulletin_filter_idx:
			continue
		UIIntermediary.resolve_item(view._bulletin_item_list, str(item.get("title_key", "")))

func refresh_bulletin_detail() -> void:
	var view: NotificationBulletinView = _view
	if selected_bulletin_idx < 0 or selected_bulletin_idx >= bulletin_data.size():
		UIIntermediary.resolve(view._label_bulletin_detail_title, "ui.fe14.bulletin.select_hint")
		UIIntermediary.resolve(view._label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": "-"})
		UIIntermediary.resolve(view._label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": "-"})
		view._rich_text_bulletin_detail.text = ""
		return
	var item: Dictionary = bulletin_data[selected_bulletin_idx]
	var prio_idx: int = int(item.get("priority", 0))
	var prio_name: String = priority_name(prio_idx)
	view._label_bulletin_detail_title.text = UIIntermediary.text(str(item.get("title_key", "")))
	UIIntermediary.resolve(view._label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": prio_name})
	UIIntermediary.resolve(view._label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": str(item.get("time", "-"))})
	view._rich_text_bulletin_detail.text = UIIntermediary.text(str(item.get("content_key", "")))

func priority_name(prio: int) -> String:
	if prio >= 0 and prio < BULLETIN_PRIORITY_KEYS.size():
		return UIIntermediary.text(BULLETIN_PRIORITY_KEYS[prio])
	return UIIntermediary.text(BULLETIN_PRIORITY_KEYS[0])

func on_bulletin_tab_changed(idx: int) -> void:
	bulletin_filter_idx = idx
	selected_bulletin_idx = -1
	refresh_bulletin_list()
	refresh_bulletin_detail()

func on_bulletin_item_selected(idx: int) -> void:
	var filtered_idx: int = 0
	for i in bulletin_data.size():
		var item: Dictionary = bulletin_data[i]
		if bulletin_filter_idx > 0 and int(item.get("category", 0)) != bulletin_filter_idx:
			continue
		if filtered_idx == idx:
			selected_bulletin_idx = i
			refresh_bulletin_detail()
			return
		filtered_idx += 1

func init_red_dot_tree() -> void:
	var view: NotificationBulletinView = _view
	view._red_dot_tree.clear()
	view._red_dot_tree.set_column_title(0, UIIntermediary.text("ui.fe14.red_dot.col_node_path"))
	view._red_dot_tree.set_column_title(1, UIIntermediary.text("ui.fe14.red_dot.col_count"))

	red_dot_root = view._red_dot_tree.create_item()
	red_dot_root.set_text(0, "Root")
	red_dot_root.set_text(1, "12")

	var sys_item: TreeItem = view._red_dot_tree.create_item(red_dot_root)
	sys_item.set_text(0, "menu")
	sys_item.set_text(1, "5")

	var mail_item: TreeItem = view._red_dot_tree.create_item(sys_item)
	mail_item.set_text(0, "menu.mail")
	mail_item.set_text(1, "3")

	var bag_item: TreeItem = view._red_dot_tree.create_item(sys_item)
	bag_item.set_text(0, "menu.bag")
	bag_item.set_text(1, "2")

	var module_item: TreeItem = view._red_dot_tree.create_item(red_dot_root)
	module_item.set_text(0, "module")
	module_item.set_text(1, "7")

	var quest_item: TreeItem = view._red_dot_tree.create_item(module_item)
	quest_item.set_text(0, "module.quest")
	quest_item.set_text(1, "4")

	var skill_item: TreeItem = view._red_dot_tree.create_item(module_item)
	skill_item.set_text(0, "module.skill")
	skill_item.set_text(1, "3")

	refresh_red_dot_total()

func refresh_red_dot_total() -> void:
	var view: NotificationBulletinView = _view
	var total: int = 0
	if red_dot_root != null:
		total = int(red_dot_root.get_text(1))
	if view._label_red_dot_total != null:
		UIIntermediary.resolve(view._label_red_dot_total, "ui.fe14.red_dot.total_label", {"total": total})

func show_toast(type: String, message: String) -> void:
	var view: NotificationBulletinView = _view
	view.toast_queue.append({"type": type, "msg": message})
	if view._label_test_status != null:
		UIIntermediary.resolve(view._label_test_status, "ui.fe14.toast.status_format", {"type": type, "msg": message})

func show_modal(type: String, message: String) -> void:
	var view: NotificationBulletinView = _view
	view.active_modal_dialog = {"type": type, "content": message}
	if view._label_test_status != null:
		UIIntermediary.resolve(view._label_test_status, "ui.fe14.modal.status_format", {"type": type, "msg": message})

func on_clear_all_red_dots_pressed() -> void:
	var view: NotificationBulletinView = _view
	if red_dot_root != null:
		clear_red_dot_recursive(red_dot_root)
	refresh_red_dot_total()
	if view._label_test_status != null:
		UIIntermediary.resolve(view._label_test_status, "ui.fe14.red_dot.clear_status")

func clear_red_dot_recursive(item: TreeItem) -> void:
	item.set_text(1, "0")
	var child: TreeItem = item.get_first_child()
	while child != null:
		clear_red_dot_recursive(child)
		child = child.get_next()

func on_red_dot_item_activated() -> void:
	var view: NotificationBulletinView = _view
	var selected: TreeItem = view._red_dot_tree.get_selected()
	if selected != null and view._label_test_status != null:
		var path: String = selected.get_text(0)
		var count: String = selected.get_text(1)
		UIIntermediary.resolve(view._label_test_status, "ui.fe14.red_dot.node_info", {"path": path, "count": count})

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header
