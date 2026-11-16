# ==============================================================================
# 模块归属: 前端通知视图域 (fe14 通知与公告页签委托)
# 文件路径: res://frontend/views/notification_bulletin/notification_bulletin_tabs.gd
# 架构定位: BaseScreen 附属页签委托控制器；承接公告板、红点树管理与弹窗测试台
# 依赖与触发: 依赖 NotificationBulletinView、UIIntermediary 与 KTabBar/KPageHeader
# 职责说明: 初始化公告板与红点树结构，维护公告筛选、红点重置与测试状态提示
# 退出语义与设计依据: 随 NotificationBulletinView 生命周期由 _register_owned_subcontroller 清理
# ==============================================================================
## 通知与公告页签委托控制器，负责公告列表筛选、红点树递归清零及测试面板回调。
class_name NotificationBulletinTabs
extends BaseScreen

const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")

var page_header: KPageHeader = null

var _view: Variant = null

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
var selected_bulletin_index: int = -1
var bulletin_filter_index: int = 0
var red_dot_root: TreeItem = null

## 绑定宿主通知与公告视图实例。
func setup(host_view: BaseScreen) -> void:
	_view = host_view

## 初始化主窗口及通知中心、公告板、红点树管理页签全部静态文案。
func init_static_text() -> void:
	var host_view: NotificationBulletinView = _view
	var bindings := [
		[host_view.get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel"), "ui.fe14.common.header_title"],
		[host_view._back_button, "ui.fe14.common.back"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/通知中心/ContentSplit/LeftPanel/LeftVBox/LabelCategoryTitle"), "ui.fe14.notification.category_title"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/通知中心/ContentSplit/LeftPanel/LeftVBox/LabelCategoryHint"), "ui.fe14.notification.category_hint"],
		[host_view._label_notification_detail_title, "ui.fe14.notification.select_hint"],
		[host_view._jump_target_button, "ui.fe14.notification.jump_btn"],
		[host_view._mark_all_read_button, "ui.fe14.notification.mark_all_read_btn"],
		[host_view._clear_notifications_button, "ui.fe14.notification.clear_read_btn"],
		[host_view.label_bulletin_detail_title, "ui.fe14.bulletin.select_hint"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/RedDotHeaderRow/LabelRedDotTitle"), "ui.fe14.red_dot.tab_title"],
		[host_view._clear_all_red_dots_button, "ui.fe14.red_dot.clear_all_btn"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/RulesPanel/LabelRules"), "ui.fe14.red_dot.rules"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/LabelTestPanelTitle"), "ui.fe14.common.test_panel_title"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/LabelToastSubtitle"), "ui.fe14.toast.test_title"],
		[host_view._toast_info_button, "ui.fe14.toast.btn_info"],
		[host_view._toast_success_button, "ui.fe14.toast.btn_success"],
		[host_view._toast_warning_button, "ui.fe14.toast.btn_warning"],
		[host_view._toast_error_button, "ui.fe14.toast.btn_error"],
		[host_view.get_node_or_null("MainLayout/MainTabContainer/红点树管理/LabelModalSubtitle"), "ui.fe14.modal.test_title"],
		[host_view._modal_confirm_button, "ui.fe14.modal.btn_confirm"],
		[host_view._modal_yes_no_button, "ui.fe14.modal.btn_yes_no"],
		[host_view._modal_input_button, "ui.fe14.modal.btn_input"],
		[host_view._label_test_status, "ui.fe14.common.test_status_waiting"]
	]
	for binding_entry in bindings:
		if binding_entry[0] != null:
			UIIntermediary.resolve(binding_entry[0], binding_entry[1])

	KTabBar.init_titles(host_view._main_tab_container, PackedStringArray([
		"ui.fe14.notification.tab_title",
		"ui.fe14.bulletin.tab_title",
		"ui.fe14.red_dot.tab_title",
	]))

	if host_view._label_notification_detail_category != null:
		UIIntermediary.resolve(host_view._label_notification_detail_category, "ui.fe14.notification.category_label", {"name": "-"})
	if host_view._label_notification_detail_time != null:
		UIIntermediary.resolve(host_view._label_notification_detail_time, "ui.fe14.notification.time_label", {"time": "-"})
	if host_view.label_bulletin_detail_priority != null:
		UIIntermediary.resolve(host_view.label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": "-"})
	if host_view.label_bulletin_detail_time != null:
		UIIntermediary.resolve(host_view.label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": "-"})
	if host_view.label_red_dot_total != null:
		UIIntermediary.resolve(host_view.label_red_dot_total, "ui.fe14.red_dot.total_label", {"total": 0})

## 初始化公告板分类页签、预设公告列表并首刷展示。
func init_bulletin_board() -> void:
	var host_view: NotificationBulletinView = _view
	host_view._bulletin_tab_bar.clear_tabs()
	for tab_key in BULLETIN_TAB_KEYS:
		host_view._bulletin_tab_bar.add_tab(UIIntermediary.text(tab_key))

	bulletin_data = [
		{"id": "B001", "category": 0, "title_key": "ui.fe14.bulletin.mock.b001.title", "priority": 1, "time": "09-01 00:00", "content_key": "ui.fe14.bulletin.mock.b001.content"},
		{"id": "B002", "category": 1, "title_key": "ui.fe14.bulletin.mock.b002.title", "priority": 0, "time": "08-31 18:00", "content_key": "ui.fe14.bulletin.mock.b002.content"},
		{"id": "B003", "category": 2, "title_key": "ui.fe14.bulletin.mock.b003.title", "priority": 2, "time": "08-30 14:00", "content_key": "ui.fe14.bulletin.mock.b003.content"},
		{"id": "B004", "category": 3, "title_key": "ui.fe14.bulletin.mock.b004.title", "priority": 1, "time": "08-28 10:00", "content_key": "ui.fe14.bulletin.mock.b004.content"},
	]
	refresh_bulletin_list()

## 按当前分类筛选重新填充公告板列表项。
func refresh_bulletin_list() -> void:
	var host_view: NotificationBulletinView = _view
	host_view._bulletin_item_list.clear()
	for bulletin_entry in bulletin_data:
		if bulletin_filter_index > 0 and int(bulletin_entry.get("category", 0)) != bulletin_filter_index:
			continue
		UIIntermediary.resolve_item(host_view._bulletin_item_list, str(bulletin_entry.get("title_key", "")))

## 根据当前选中的公告索引刷新右侧公告正文与优先级详情。
func refresh_bulletin_detail() -> void:
	var host_view: NotificationBulletinView = _view
	if selected_bulletin_index < 0 or selected_bulletin_index >= bulletin_data.size():
		UIIntermediary.resolve(host_view.label_bulletin_detail_title, "ui.fe14.bulletin.select_hint")
		UIIntermediary.resolve(host_view.label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": "-"})
		UIIntermediary.resolve(host_view.label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": "-"})
		host_view.rich_text_bulletin_detail.text = ""
		return
	var bulletin_entry: Dictionary = bulletin_data[selected_bulletin_index]
	var priority_index: int = int(bulletin_entry.get("priority", 0))
	var priority_label_text: String = priority_name(priority_index)
	host_view.label_bulletin_detail_title.text = UIIntermediary.text(str(bulletin_entry.get("title_key", "")))
	UIIntermediary.resolve(host_view.label_bulletin_detail_priority, "ui.fe14.bulletin.priority_label", {"name": priority_label_text})
	UIIntermediary.resolve(host_view.label_bulletin_detail_time, "ui.fe14.bulletin.time_label", {"time": str(bulletin_entry.get("time", "-"))})
	host_view.rich_text_bulletin_detail.text = UIIntermediary.text(str(bulletin_entry.get("content_key", "")))

## 将公告优先级枚举索引解析为本地化名称。
func priority_name(priority_value: int) -> String:
	if priority_value >= 0 and priority_value < BULLETIN_PRIORITY_KEYS.size():
		return UIIntermediary.text(BULLETIN_PRIORITY_KEYS[priority_value])
	return UIIntermediary.text(BULLETIN_PRIORITY_KEYS[0])

## 处理公告板分类页签切换，清空选中项并刷新列表与详情。
func on_bulletin_tab_changed(tab_index: int) -> void:
	bulletin_filter_index = tab_index
	selected_bulletin_index = -1
	refresh_bulletin_list()
	refresh_bulletin_detail()

## 处理公告列表条目选中，反查真实公告索引并刷新详情。
func on_bulletin_item_selected(item_index: int) -> void:
	var filtered_index: int = 0
	for bulletin_index in bulletin_data.size():
		var bulletin_entry: Dictionary = bulletin_data[bulletin_index]
		if bulletin_filter_index > 0 and int(bulletin_entry.get("category", 0)) != bulletin_filter_index:
			continue
		if filtered_index == item_index:
			selected_bulletin_index = bulletin_index
			refresh_bulletin_detail()
			return
		filtered_index += 1

## 构建红点树层级结构并刷新红点总数显示。
func init_red_dot_tree() -> void:
	var host_view: NotificationBulletinView = _view
	host_view._red_dot_tree.clear()
	host_view._red_dot_tree.set_column_title(0, UIIntermediary.text("ui.fe14.red_dot.col_node_path"))
	host_view._red_dot_tree.set_column_title(1, UIIntermediary.text("ui.fe14.red_dot.col_count"))

	red_dot_root = host_view._red_dot_tree.create_item()
	red_dot_root.set_text(0, "Root")
	red_dot_root.set_text(1, "12")

	var menu_item: TreeItem = host_view._red_dot_tree.create_item(red_dot_root)
	menu_item.set_text(0, "menu")
	menu_item.set_text(1, "5")

	var mail_item: TreeItem = host_view._red_dot_tree.create_item(menu_item)
	mail_item.set_text(0, "menu.mail")
	mail_item.set_text(1, "3")

	var bag_item: TreeItem = host_view._red_dot_tree.create_item(menu_item)
	bag_item.set_text(0, "menu.bag")
	bag_item.set_text(1, "2")

	var module_item: TreeItem = host_view._red_dot_tree.create_item(red_dot_root)
	module_item.set_text(0, "module")
	module_item.set_text(1, "7")

	var quest_item: TreeItem = host_view._red_dot_tree.create_item(module_item)
	quest_item.set_text(0, "module.quest")
	quest_item.set_text(1, "4")

	var skill_item: TreeItem = host_view._red_dot_tree.create_item(module_item)
	skill_item.set_text(0, "module.skill")
	skill_item.set_text(1, "3")

	refresh_red_dot_total()

## 读取红点根节点聚合计数并更新总计文本标签。
func refresh_red_dot_total() -> void:
	var host_view: NotificationBulletinView = _view
	var total_count: int = 0
	if red_dot_root != null:
		total_count = int(red_dot_root.get_text(1))
	if host_view.label_red_dot_total != null:
		UIIntermediary.resolve(host_view.label_red_dot_total, "ui.fe14.red_dot.total_label", {"total": total_count})

## 向 Toast 测试队列追加提示记录并更新状态反馈文本。
func show_toast(toast_type: String, message: String) -> void:
	var host_view: NotificationBulletinView = _view
	host_view.toast_queue.append({"type": toast_type, "msg": message})
	if host_view._label_test_status != null:
		UIIntermediary.resolve(host_view._label_test_status, "ui.fe14.toast.status_format", {"type": toast_type, "msg": message})

## 记录活跃 Modal 弹窗状态并更新状态反馈文本。
func show_modal(modal_type: String, message: String) -> void:
	var host_view: NotificationBulletinView = _view
	host_view.active_modal_dialog = {"type": modal_type, "content": message}
	if host_view._label_test_status != null:
		UIIntermediary.resolve(host_view._label_test_status, "ui.fe14.modal.status_format", {"type": modal_type, "msg": message})

## 递归清零全部红点树节点计数并刷新总数与反馈提示。
func on_clear_all_red_dots_pressed() -> void:
	var host_view: NotificationBulletinView = _view
	if red_dot_root != null:
		clear_red_dot_recursive(red_dot_root)
	refresh_red_dot_total()
	if host_view._label_test_status != null:
		UIIntermediary.resolve(host_view._label_test_status, "ui.fe14.red_dot.clear_status")

## 递归将目标树节点及全部后代节点的红点计数置零。
func clear_red_dot_recursive(tree_item: TreeItem) -> void:
	tree_item.set_text(1, "0")
	var child_item: TreeItem = tree_item.get_first_child()
	while child_item != null:
		clear_red_dot_recursive(child_item)
		child_item = child_item.get_next()

## 处理红点树节点激活事件，在状态栏展示选中路径与计数。
func on_red_dot_item_activated() -> void:
	var host_view: NotificationBulletinView = _view
	var selected_item: TreeItem = host_view._red_dot_tree.get_selected()
	if selected_item != null and host_view._label_test_status != null:
		var node_path_text: String = selected_item.get_text(0)
		var count_text: String = selected_item.get_text(1)
		UIIntermediary.resolve(host_view._label_test_status, "ui.fe14.red_dot.node_info", {"path": node_path_text, "count": count_text})

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header
