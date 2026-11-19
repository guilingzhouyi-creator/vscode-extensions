# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第12卷 制造与工坊 Tab 子面板控制器)
# 文件路径: res://frontend/views/crafting_workshop/crafting_workshop_tabs.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: CraftingWorkshopView
#           下游: KButtonClass, KRarityTag, KVirtualListClass, KPageHeaderClass
# 职责说明: 承接配方图鉴与材料仓库的网格对象池构建、分类过滤、详情联动与事件响应；
#           节点引用与状态均经 _view 访问，保持单一数据源。
# 退出语义与设计依据: 表现层多页签委托解耦与网格对象池零堆分配规约 (ADV-PRF-002)
# ==============================================================================
## CraftingWorkshopTabs：第12卷配方图鉴与材料仓库子面板控制器
class_name CraftingWorkshopTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KVirtualListClass = preload("res://frontend/components/k_virtual_list.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")
const CATEGORY_BUTTON_MIN_EXTENTS := Vector2(72, DesignTokens.SPACING_ZERO)

var recipe_virtual_list: KVirtualList = null
var page_header: KPageHeader = null

var _view: Variant = null

## 绑定视图引用
func setup(view: BaseScreen) -> void:
	_view = view

# ==============================================================================
# Tab 2: 配方图鉴 (RECIPES) 初始化
# ==============================================================================

## 初始化配方图鉴 Tab：分类 TabBar/网格/进度首刷
func _init_recipes_tab() -> void:
	if _view == null or _view._tab_container == null:
		return
	var recipes_tab: Control = _view._tab_container.get_child(1)
	if recipes_tab != null:
		var section_label: Label = recipes_tab.get_node_or_null("TopRow/SectionLabel")
		if section_label != null:
			UIIntermediary.resolve(section_label, "ui.fe12.recipes.section")
		var material_label: Label = recipes_tab.get_node_or_null("DetailPanel/DetailVBox/MaterialLabel")
		if material_label != null:
			UIIntermediary.resolve(material_label, "ui.fe12.recipes.section_materials")

	if _view.recipe_tab_bar.tab_count > 0:
		_view.recipe_tab_bar.clear_tabs()
	for category_key in _view._recipe_categories:
		_view.recipe_tab_bar.add_tab(UIIntermediary.text("ui.fe12.category." + str(category_key)))
	_view.recipe_tab_bar.current_tab = 0
	_view.recipe_current_category = 0
	_populate_recipe_grid()
	_refresh_recipe_progress()

## 重建配方网格：按分类过滤复用网格细胞（零 queue_free 抖动与零重复信号绑定），重置选中并清详情
func _populate_recipe_grid() -> void:
	if _view == null or _view.recipe_grid == null:
		return
	var grid: Container = _view.recipe_grid
	var category: String = _view._recipe_categories[_view.recipe_current_category] if _view.recipe_current_category < _view._recipe_categories.size() else ""
	var active_cell_index: int = 0
	for catalog_index in range(_view._recipe_catalog.size()):
		var recipe: Dictionary = _view._recipe_catalog[catalog_index]
		if not category.is_empty() and str(recipe.get("category", "")) != category:
			continue
		var learned: bool = bool(recipe.get("learned", false))
		var border_color := KRarityTag.get_rarity_color(_rarity_str_to_level(str(recipe.get("rarity", "COMMON")))) if learned else DesignTokens.COLOR_TEXT_MUTED_DEFAULT
		var cell := _acquire_pooled_grid_cell(grid, active_cell_index, Vector2(96, 96), border_color, 2, _on_recipe_cell_meta_clicked)
		cell.set_meta("_item_idx", catalog_index)
		var status_key := "ui.fe12.recipes.status_learned" if learned else "ui.fe12.recipes.status_not_learned"
		var status_color := DesignTokens.COLOR_SUCCESS_DEFAULT if learned else DesignTokens.COLOR_DANGER_DEFAULT
		_configure_cell_labels(
			cell,
			UIIntermediary.text(str(recipe.get("name", ""))),
			11,
			DesignTokens.COLOR_TEXT_DEFAULT if learned else DesignTokens.COLOR_TEXT_MUTED_DEFAULT,
			true,
			UIIntermediary.text(status_key),
			10,
			status_color
		)
		active_cell_index += 1
	for child_index in range(active_cell_index, grid.get_child_count()):
		(grid.get_child(child_index) as Control).visible = false
	_view.recipe_selected_index = -1
	_clear_recipe_detail()

func _on_recipe_cell_meta_clicked(panel: PanelContainer) -> void:
	_on_recipe_cell_selected(int(panel.get_meta("_item_idx", -1)))

func _on_material_cell_meta_clicked(panel: PanelContainer) -> void:
	_on_material_cell_selected(int(panel.get_meta("_item_idx", -1)))

func _acquire_pooled_grid_cell(
	grid: Container,
	active_cell_index: int,
	cell_size: Vector2,
	border_color: Color,
	border_width: int,
	on_panel_clicked: Callable
) -> PanelContainer:
	var panel: PanelContainer = null
	if active_cell_index < grid.get_child_count():
		panel = grid.get_child(active_cell_index) as PanelContainer
		panel.visible = true
		var existing_style := panel.get_theme_stylebox("panel") as StyleBoxFlat
		if existing_style != null:
			existing_style.border_color = border_color
		return panel
	panel = _build_cell_panel(cell_size, border_color, border_width, on_panel_clicked)
	var cell_box := panel.get_child(0) as VBoxContainer
	cell_box.add_child(_make_centered_cell_label("", 11))
	cell_box.add_child(_make_centered_cell_label("", 10))
	grid.add_child(panel)
	return panel

func _configure_cell_labels(
	panel: PanelContainer,
	title_text: String,
	title_size: int,
	title_color: Color,
	apply_title_color: bool,
	subtitle_text: String,
	subtitle_size: int,
	subtitle_color: Color
) -> void:
	var cell_box := panel.get_child(0) as VBoxContainer
	var top_label := cell_box.get_child(0) as Label
	top_label.text = title_text
	top_label.add_theme_font_size_override("font_size", title_size)
	if apply_title_color:
		top_label.add_theme_color_override("font_color", title_color)
	else:
		top_label.remove_theme_color_override("font_color")
	var subtitle_label := cell_box.get_child(1) as Label
	subtitle_label.text = subtitle_text
	subtitle_label.add_theme_font_size_override("font_size", subtitle_size)
	subtitle_label.add_theme_color_override("font_color", subtitle_color)

func _build_cell_panel(cell_size: Vector2, border_color: Color, border_width: int, on_selected: Callable) -> PanelContainer:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = cell_size
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.border_color = border_color
	style.set_border_width_all(border_width)
	style.set_corner_radius_all(6)
	panel.add_theme_stylebox_override("panel", style)
	var cell_box := VBoxContainer.new()
	cell_box.alignment = BoxContainer.ALIGNMENT_CENTER
	panel.add_child(cell_box)
	connect_managed(panel.gui_input, func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			on_selected.call(panel))
	return panel

func _make_centered_cell_label(text_value: String, font_size: int, font_color: Color = Color.WHITE, apply_color: bool = false) -> Label:
	var label_node := Label.new()
	label_node.text = text_value
	label_node.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label_node.add_theme_font_size_override("font_size", font_size)
	if apply_color:
		label_node.add_theme_color_override("font_color", font_color)
	return label_node

## 清空配方详情为空态
func _clear_recipe_detail() -> void:
	if _view == null:
		return
	UIIntermediary.resolve(_view.label_recipe_name, "ui.fe12.recipes.select_prompt")
	UIIntermediary.resolve(_view.label_recipe_rarity, "ui.fe12.recipes.rarity_none")
	UIIntermediary.resolve(_view.label_recipe_status, "ui.fe12.recipes.status_none")
	UIIntermediary.resolve(_view.label_recipe_unlock_condition, "ui.fe12.recipes.unlock_none")
	_view.recipe_material_list.clear()

## 刷新配方详情：名称/稀有度/习得态/解锁条件/材料清单（越界重置空态）
func _refresh_recipe_detail() -> void:
	if _view == null:
		return
	if _view.recipe_selected_index < 0 or _view.recipe_selected_index >= _view._recipe_catalog.size():
		_clear_recipe_detail()
		return
	var recipe: Dictionary = _view._recipe_catalog[_view.recipe_selected_index]
	UIIntermediary.resolve(_view.label_recipe_name, str(recipe.get("name", "")))
	UIIntermediary.resolve(_view.label_recipe_rarity, "ui.fe12.recipes.rarity", {"rarity": str(recipe.get("rarity", "--"))})
	var learned: bool = bool(recipe.get("learned", false))
	var status_text: String = UIIntermediary.text("ui.fe12.recipes.status_learned") if learned else UIIntermediary.text("ui.fe12.recipes.status_not_learned")
	UIIntermediary.resolve(_view.label_recipe_status, "ui.fe12.recipes.status", {"status": status_text})
	var condition_raw: String = str(recipe.get("unlock_condition", "ui.fe12.recipes.unlock_default"))
	UIIntermediary.resolve(_view.label_recipe_unlock_condition, "ui.fe12.recipes.unlock", {"condition": UIIntermediary.text(condition_raw)})
	_view.recipe_material_list.clear()
	for material_entry in recipe.get("materials", []):
		UIIntermediary.resolve_item(_view.recipe_material_list, "ui.fe12.recipe.material", {
			"name": UIIntermediary.text(str(material_entry.get("name", ""))), "count": int(material_entry.get("qty", 0))
		})

## 刷新图鉴习得进度（已习得/总数）
func _refresh_recipe_progress() -> void:
	if _view == null or _view.label_recipe_progress == null:
		return
	var learned_count: int = 0
	for recipe in _view._recipe_catalog:
		if bool(recipe.get("learned", false)):
			learned_count += 1
	UIIntermediary.resolve(_view.label_recipe_progress, "ui.fe12.recipes.progress", {"learned": learned_count, "total": _view._recipe_catalog.size()})

func _on_recipe_cell_selected(catalog_index: int) -> void:
	if _view != null:
		_view.recipe_selected_index = catalog_index
	_refresh_recipe_detail()

func _on_recipe_category_changed(tab_index: int) -> void:
	if _view != null:
		_view.recipe_current_category = tab_index
	_populate_recipe_grid()

# ==============================================================================
# Tab 4: 材料仓库 (MATERIALS) 初始化
# ==============================================================================

## 初始化材料仓库 Tab：六分类按钮动态生成 + 默认选中首类 + 网格/详情空态
func _init_materials_tab() -> void:
	if _view == null or _view._tab_container == null:
		return
	var materials_tab: Control = _view._tab_container.get_child(3)
	if materials_tab != null:
		var section_label: Label = materials_tab.get_node_or_null("SectionLabel")
		if section_label != null:
			UIIntermediary.resolve(section_label, "ui.fe12.materials.section")
	var active_count: int = _view.material_categories.size()
	for category_index in range(active_count):
		var category_button: Button = _acquire_material_category_button(category_index)
		category_button.visible = true
		category_button.text = UIIntermediary.text("ui.fe12.mat_category." + str(_view.material_categories[category_index]))
	for extra_index in range(active_count, _view.material_category_box.get_child_count()):
		_view.material_category_box.get_child(extra_index).visible = false
	_view.material_current_category = 0
	_refresh_material_category_buttons()
	_populate_material_grid()
	_clear_material_detail()

## 获取或创建材料分类按钮（池化复用，绑定按索引触发，避免循环内瞬态分配）
func _acquire_material_category_button(category_index: int) -> Button:
	if category_index < _view.material_category_box.get_child_count():
		return _view.material_category_box.get_child(category_index) as Button
	var category_button := KButtonClass.new()
	category_button.variant = KButtonClass.StyleVariant.SECONDARY
	category_button.toggle_mode = true
	category_button.custom_minimum_size = CATEGORY_BUTTON_MIN_EXTENTS
	connect_managed(category_button.pressed, func(): _on_material_category_pressed(category_index))
	_view.material_category_box.add_child(category_button)
	return category_button

## 刷新分类按钮选中态（唯一高亮当前分类）
func _refresh_material_category_buttons() -> void:
	if _view == null or _view.material_category_box == null:
		return
	for button_index in _view.material_category_box.get_child_count():
		var category_button: Button = _view.material_category_box.get_child(button_index)
		category_button.button_pressed = (button_index == _view.material_current_category)

## 重建材料网格：按分类过滤复用网格细胞（零 queue_free 抖动与零重复信号绑定），重置选中并清详情
func _populate_material_grid() -> void:
	if _view == null or _view.material_grid == null:
		return
	var grid: Container = _view.material_grid
	var category: String = _view.material_categories[_view.material_current_category] if _view.material_current_category < _view.material_categories.size() else ""
	var active_cell_index: int = 0
	for material_index in range(_view._materials.size()):
		var material_entry: Dictionary = _view._materials[material_index]
		if not category.is_empty() and str(material_entry.get("category", "")) != category:
			continue
		var border_color := KRarityTag.get_rarity_color(_rarity_str_to_level(str(material_entry.get("rarity", "COMMON"))))
		var cell := _acquire_pooled_grid_cell(grid, active_cell_index, Vector2(80, 80), border_color, 1, _on_material_cell_meta_clicked)
		cell.set_meta("_item_idx", material_index)
		_configure_cell_labels(
			cell,
			UIIntermediary.text(str(material_entry.get("name", ""))),
			11,
			Color.WHITE,
			false,
			"x%d" % int(material_entry.get("qty", 0)),
			11,
			DesignTokens.COLOR_SUCCESS_DEFAULT
		)
		active_cell_index += 1
	for child_index in range(active_cell_index, grid.get_child_count()):
		(grid.get_child(child_index) as Control).visible = false
	_view.material_selected_index = -1
	_clear_material_detail()

## 清空材料详情为空态
func _clear_material_detail() -> void:
	if _view == null:
		return
	UIIntermediary.resolve(_view.label_material_name, "ui.fe12.materials.select_prompt")
	UIIntermediary.resolve(_view.label_material_rarity, "ui.fe12.materials.rarity_none")
	UIIntermediary.resolve(_view.label_material_quantity, "ui.fe12.materials.quantity_none")
	UIIntermediary.resolve(_view.label_material_description, "ui.fe12.materials.desc_none")
	UIIntermediary.resolve(_view.label_material_source, "ui.fe12.materials.source_none")

## 刷新材料详情：名称/稀有度/数量/描述/获取途径（越界重置空态）
func _refresh_material_detail() -> void:
	if _view == null:
		return
	if _view.material_selected_index < 0 or _view.material_selected_index >= _view._materials.size():
		_clear_material_detail()
		return
	var material_entry: Dictionary = _view._materials[_view.material_selected_index]
	UIIntermediary.resolve(_view.label_material_name, str(material_entry.get("name", "")))
	UIIntermediary.resolve(_view.label_material_rarity, "ui.fe12.materials.rarity", {"rarity": str(material_entry.get("rarity", "--"))})
	UIIntermediary.resolve(_view.label_material_quantity, "ui.fe12.materials.quantity", {"count": int(material_entry.get("qty", 0))})
	UIIntermediary.resolve(_view.label_material_description, "ui.fe12.materials.desc", {"desc": UIIntermediary.text(str(material_entry.get("desc", "--")))})
	UIIntermediary.resolve(_view.label_material_source, "ui.fe12.materials.source", {"source": UIIntermediary.text(str(material_entry.get("source", "--")))})

func _on_material_cell_selected(list_index: int) -> void:
	if _view != null:
		_view.material_selected_index = list_index
	_refresh_material_detail()

func _on_material_category_pressed(category_index: int) -> void:
	if _view != null:
		_view.material_current_category = category_index
	_refresh_material_category_buttons()
	_populate_material_grid()

# ==============================================================================
# 信号绑定与工具方法
# ==============================================================================

## 绑定 Tab 2 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view.recipe_tab_bar.tab_changed, _on_recipe_category_changed)

## 稀有度字符串 → KRarityTag 整数等级
func _rarity_str_to_level(rarity: String) -> int:
	match rarity:
		"LEGENDARY": return 5
		"EPIC": return 4
		"RARE": return 3
		"UNCOMMON": return 2
		_: return 1

## 初始化配方虚拟列表并配置对象池 (ADV-POOL-001)
func init_recipe_virtual_list(container: Control = null) -> KVirtualList:
	if recipe_virtual_list == null:
		recipe_virtual_list = KVirtualListClass.new()
		recipe_virtual_list.name = "RecipeVirtualList"
		recipe_virtual_list.item_height = 56.0
		recipe_virtual_list.buffer_count = 3
		connect_managed(recipe_virtual_list.range_changed, _on_recipe_range_changed)
		if container != null:
			container.add_child(recipe_virtual_list)
		else:
			recipe_virtual_list.visible = false
			add_child(recipe_virtual_list)
	return recipe_virtual_list

## 刷新配方虚拟列表总数
func sync_recipe_virtual_list(count: int) -> void:
	if recipe_virtual_list == null:
		init_recipe_virtual_list()
	recipe_virtual_list.set_total_count(count)

func _on_recipe_range_changed(start_index: int, end_index: int) -> void:
	if _view == null or recipe_virtual_list == null or start_index < 0:
		return
	var filtered: Array = _get_filtered_recipes()
	for row_index in range(start_index, end_index + 1):
		if row_index < filtered.size():
			var virtual_row: Control = recipe_virtual_list.acquire_row_for_index(row_index)
			var recipe: Dictionary = filtered[row_index]
			if virtual_row is KVirtualList.KVirtualRow:
				var typed_row := virtual_row as KVirtualList.KVirtualRow
				typed_row.bound_key = str(recipe.get("recipe_id", ""))
				typed_row.bound_data = recipe

## 获取默认材料库存条目（供视图初始化与离线演示使用）
## 获取当前分类过滤配方
func _get_filtered_recipes() -> Array:
	if _view == null:
		return []
	var current_category: String = _view._recipe_categories[_view.recipe_current_category]
	if current_category == "all":
		return _view._recipe_catalog
	var filtered_recipes := []
	for recipe_entry in _view._recipe_catalog:
		if recipe_entry.get("category", "") == current_category:
			filtered_recipes.append(recipe_entry)
	return filtered_recipes

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	page_header = _ensure_page_header(page_header, KPageHeaderClass, title_key, _view) as KPageHeader
	return page_header
