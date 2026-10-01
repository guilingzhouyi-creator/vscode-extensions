# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第12卷: 制造与工坊 Tab 子面板控制器
# 文件路径: res://frontend/views/crafting_workshop/crafting_workshop_tabs.gd
# 职责: 承接配方图鉴（Tab 2）与材料仓库（Tab 4）的网格构建、分类过滤、详情联动与事件
#       由 CraftingWorkshopView 持有，经 setup(view) 绑定视图引用后委托调用
#       节点引用与数据均经 _view 访问，保证行为与拆分前完全一致
# ==============================================================================
class_name CraftingWorkshopTabs
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KRarityTag = preload("res://frontend/components/k_rarity_tag.gd")
const KVirtualListClass = preload("res://frontend/components/k_virtual_list.gd")
const KPageHeaderClass = preload("res://frontend/components/k_page_header.gd")

var recipe_virtual_list: KVirtualList = null
var page_header: KPageHeader = null

var _view = null

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

	if _view._recipe_tab_bar.tab_count > 0:
		_view._recipe_tab_bar.clear_tab(0)
	for cat in _view._recipe_categories:
		_view._recipe_tab_bar.add_tab(UIIntermediary.text("ui.fe12.category." + str(cat)))
	_view._recipe_tab_bar.current_tab = 0
	_view._recipe_current_category = 0
	_populate_recipe_grid()
	_refresh_recipe_progress()

## 重建配方网格：按分类过滤生成细胞，重置选中并清详情
func _populate_recipe_grid() -> void:
	if _view == null or _view._recipe_grid == null:
		return
	for child in _view._recipe_grid.get_children():
		child.queue_free()
	var category: String = _view._recipe_categories[_view._recipe_current_category] if _view._recipe_current_category < _view._recipe_categories.size() else ""
	for i in range(_view._recipe_catalog.size()):
		var recipe: Dictionary = _view._recipe_catalog[i]
		if not category.is_empty() and str(recipe.get("category", "")) != category:
			continue
		_view._recipe_grid.add_child(_make_recipe_cell(recipe, i))
	_view._recipe_selected_index = -1
	_clear_recipe_detail()

## 构建配方网格细胞：稀有度配色边框（未习得灰化）+ 名称/状态标签 + 点击回调
func _make_recipe_cell(recipe: Dictionary, catalog_index: int) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(96, 96)
	var learned: bool = bool(recipe.get("learned", false))
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.border_color = KRarityTag.get_rarity_color(_rarity_str_to_level(str(recipe.get("rarity", "COMMON")))) if learned else DesignTokens.COLOR_TEXT_MUTED_DEFAULT
	style.border_width_left = 2
	style.border_width_right = 2
	style.border_width_top = 2
	style.border_width_bottom = 2
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	panel.add_theme_stylebox_override("panel", style)
	var vbox := VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var name_label := Label.new()
	name_label.text = UIIntermediary.text(str(recipe.get("name", "")))
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 11)
	name_label.add_theme_color_override("font_color", DesignTokens.COLOR_TEXT_DEFAULT if learned else DesignTokens.COLOR_TEXT_MUTED_DEFAULT)
	vbox.add_child(name_label)
	var status_label := Label.new()
	status_label.text = UIIntermediary.text("ui.fe12.recipes.status_learned") if learned else UIIntermediary.text("ui.fe12.recipes.status_not_learned")
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.add_theme_font_size_override("font_size", 10)
	status_label.add_theme_color_override("font_color", DesignTokens.COLOR_SUCCESS_DEFAULT if learned else DesignTokens.COLOR_DANGER_DEFAULT)
	vbox.add_child(status_label)
	panel.add_child(vbox)
	panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_on_recipe_cell_selected(catalog_index))
	return panel

## 清空配方详情为占位态
func _clear_recipe_detail() -> void:
	if _view == null:
		return
	UIIntermediary.resolve(_view._label_recipe_name, "ui.fe12.recipes.select_prompt")
	UIIntermediary.resolve(_view._label_recipe_rarity, "ui.fe12.recipes.rarity_none")
	UIIntermediary.resolve(_view._label_recipe_status, "ui.fe12.recipes.status_none")
	UIIntermediary.resolve(_view._label_recipe_unlock_condition, "ui.fe12.recipes.unlock_none")
	_view._recipe_material_list.clear()

## 刷新配方详情：名称/稀有度/习得态/解锁条件/材料清单（越界清空占位）
func _refresh_recipe_detail() -> void:
	if _view == null:
		return
	if _view._recipe_selected_index < 0 or _view._recipe_selected_index >= _view._recipe_catalog.size():
		_clear_recipe_detail()
		return
	var recipe: Dictionary = _view._recipe_catalog[_view._recipe_selected_index]
	UIIntermediary.resolve(_view._label_recipe_name, str(recipe.get("name", "")))
	UIIntermediary.resolve(_view._label_recipe_rarity, "ui.fe12.recipes.rarity", {"rarity": str(recipe.get("rarity", "--"))})
	var learned: bool = bool(recipe.get("learned", false))
	var status_text: String = UIIntermediary.text("ui.fe12.recipes.status_learned") if learned else UIIntermediary.text("ui.fe12.recipes.status_not_learned")
	UIIntermediary.resolve(_view._label_recipe_status, "ui.fe12.recipes.status", {"status": status_text})
	var condition_raw: String = str(recipe.get("unlock_condition", "ui.fe12.recipes.unlock_default"))
	UIIntermediary.resolve(_view._label_recipe_unlock_condition, "ui.fe12.recipes.unlock", {"condition": UIIntermediary.text(condition_raw)})
	_view._recipe_material_list.clear()
	for mat in recipe.get("materials", []):
		UIIntermediary.resolve_item(_view._recipe_material_list, "ui.fe12.recipe.material", {
			"name": UIIntermediary.text(str(mat.get("name", ""))), "count": int(mat.get("qty", 0))
		})

## 刷新图鉴习得进度（已习得/总数）
func _refresh_recipe_progress() -> void:
	if _view == null or _view._label_recipe_progress == null:
		return
	var learned_count: int = 0
	for recipe in _view._recipe_catalog:
		if bool(recipe.get("learned", false)):
			learned_count += 1
	UIIntermediary.resolve(_view._label_recipe_progress, "ui.fe12.recipes.progress", {"learned": learned_count, "total": _view._recipe_catalog.size()})

func _on_recipe_cell_selected(catalog_index: int) -> void:
	if _view != null:
		_view._recipe_selected_index = catalog_index
	_refresh_recipe_detail()

func _on_recipe_category_changed(tab_index: int) -> void:
	if _view != null:
		_view._recipe_current_category = tab_index
	_populate_recipe_grid()

# ==============================================================================
# Tab 4: 材料仓库 (MATERIALS) 初始化
# ==============================================================================

## 初始化材料仓库 Tab：六分类按钮动态生成 + 默认选中首类 + 网格/详情占位
func _init_materials_tab() -> void:
	if _view == null or _view._tab_container == null:
		return
	var materials_tab: Control = _view._tab_container.get_child(3)
	if materials_tab != null:
		var section_label: Label = materials_tab.get_node_or_null("SectionLabel")
		if section_label != null:
			UIIntermediary.resolve(section_label, "ui.fe12.materials.section")
	for child in _view._material_category_hbox.get_children():
		child.queue_free()
	for i in range(_view._material_categories.size()):
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.text = UIIntermediary.text("ui.fe12.mat_category." + str(_view._material_categories[i]))
		btn.toggle_mode = true
		btn.custom_minimum_size = Vector2(72, 0)
		var cat_idx: int = i
		btn.pressed.connect(func(): _on_material_category_pressed(cat_idx))
		_view._material_category_hbox.add_child(btn)
	_view._material_current_category = 0
	_refresh_material_category_buttons()
	_populate_material_grid()
	_clear_material_detail()

## 刷新分类按钮选中态（唯一高亮当前分类）
func _refresh_material_category_buttons() -> void:
	if _view == null or _view._material_category_hbox == null:
		return
	for i in _view._material_category_hbox.get_child_count():
		var btn: Button = _view._material_category_hbox.get_child(i)
		btn.button_pressed = (i == _view._material_current_category)

## 重建材料网格：按分类过滤生成细胞，重置选中并清详情
func _populate_material_grid() -> void:
	if _view == null or _view._material_grid == null:
		return
	for child in _view._material_grid.get_children():
		child.queue_free()
	var category: String = _view._material_categories[_view._material_current_category] if _view._material_current_category < _view._material_categories.size() else ""
	for i in range(_view._materials.size()):
		var mat: Dictionary = _view._materials[i]
		if not category.is_empty() and str(mat.get("category", "")) != category:
			continue
		_view._material_grid.add_child(_make_material_cell(mat, i))
	_view._material_selected_index = -1
	_clear_material_detail()

## 构建材料网格细胞：稀有度配色边框 + 名称/数量标签 + 点击回调
func _make_material_cell(mat: Dictionary, list_index: int) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(80, 80)
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.border_color = KRarityTag.get_rarity_color(_rarity_str_to_level(str(mat.get("rarity", "COMMON"))))
	style.border_width_left = 1
	style.border_width_right = 1
	style.border_width_top = 1
	style.border_width_bottom = 1
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	panel.add_theme_stylebox_override("panel", style)
	var vbox := VBoxContainer.new()
	vbox.alignment = BoxContainer.ALIGNMENT_CENTER
	var name_label := Label.new()
	name_label.text = UIIntermediary.text(str(mat.get("name", "")))
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_size_override("font_size", 11)
	vbox.add_child(name_label)
	var qty_label := Label.new()
	qty_label.text = "x%d" % int(mat.get("qty", 0))
	qty_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	qty_label.add_theme_font_size_override("font_size", 11)
	qty_label.add_theme_color_override("font_color", DesignTokens.COLOR_SUCCESS_DEFAULT)
	vbox.add_child(qty_label)
	panel.add_child(vbox)
	panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_on_material_cell_selected(list_index))
	return panel

## 清空材料详情为占位态
func _clear_material_detail() -> void:
	if _view == null:
		return
	UIIntermediary.resolve(_view._label_material_name, "ui.fe12.materials.select_prompt")
	UIIntermediary.resolve(_view._label_material_rarity, "ui.fe12.materials.rarity_none")
	UIIntermediary.resolve(_view._label_material_quantity, "ui.fe12.materials.quantity_none")
	UIIntermediary.resolve(_view._label_material_description, "ui.fe12.materials.desc_none")
	UIIntermediary.resolve(_view._label_material_source, "ui.fe12.materials.source_none")

## 刷新材料详情：名称/稀有度/数量/描述/获取途径（越界清空占位）
func _refresh_material_detail() -> void:
	if _view == null:
		return
	if _view._material_selected_index < 0 or _view._material_selected_index >= _view._materials.size():
		_clear_material_detail()
		return
	var mat: Dictionary = _view._materials[_view._material_selected_index]
	UIIntermediary.resolve(_view._label_material_name, str(mat.get("name", "")))
	UIIntermediary.resolve(_view._label_material_rarity, "ui.fe12.materials.rarity", {"rarity": str(mat.get("rarity", "--"))})
	UIIntermediary.resolve(_view._label_material_quantity, "ui.fe12.materials.quantity", {"count": int(mat.get("qty", 0))})
	UIIntermediary.resolve(_view._label_material_description, "ui.fe12.materials.desc", {"desc": UIIntermediary.text(str(mat.get("desc", "--")))})
	UIIntermediary.resolve(_view._label_material_source, "ui.fe12.materials.source", {"source": UIIntermediary.text(str(mat.get("source", "--")))})

func _on_material_cell_selected(list_index: int) -> void:
	if _view != null:
		_view._material_selected_index = list_index
	_refresh_material_detail()

func _on_material_category_pressed(cat_idx: int) -> void:
	if _view != null:
		_view._material_current_category = cat_idx
	_refresh_material_category_buttons()
	_populate_material_grid()

# ==============================================================================
# 信号绑定与工具方法
# ==============================================================================

## 绑定 Tab 2 交互信号
func _connect_signals() -> void:
	if _view == null:
		return
	_view._recipe_tab_bar.tab_changed.connect(_on_recipe_category_changed)

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
		recipe_virtual_list.range_changed.connect(_on_recipe_range_changed)
		if container != null:
			container.add_child(recipe_virtual_list)
	return recipe_virtual_list

## 刷新配方虚拟列表总数
func sync_recipe_virtual_list(count: int) -> void:
	if recipe_virtual_list == null:
		init_recipe_virtual_list()
	recipe_virtual_list.set_total_count(count)

func _on_recipe_range_changed(start_idx: int, end_idx: int) -> void:
	if _view == null or recipe_virtual_list == null or start_idx < 0:
		return
	var filtered: Array = _get_filtered_recipes()
	for i in range(start_idx, end_idx + 1):
		if i < filtered.size():
			var row: Control = recipe_virtual_list.acquire_row_for_index(i)
			var recipe: Dictionary = filtered[i]
			if row is KVirtualList.KVirtualRow:
				var vrow := row as KVirtualList.KVirtualRow
				vrow.bound_key = str(recipe.get("recipe_id", ""))
				vrow.bound_data = recipe

## 获取当前分类过滤配方
func _get_filtered_recipes() -> Array:
	if _view == null:
		return []
	var cat: String = _view._recipe_categories[_view._recipe_current_category]
	if cat == "all":
		return _view._recipe_book
	var res := []
	for r in _view._recipe_book:
		if r.get("category", "") == cat:
			res.append(r)
	return res

## 统一页面标题栏构建
func create_page_header(title_key: String) -> KPageHeader:
	if page_header == null:
		page_header = KPageHeaderClass.new()
		page_header.title_key = title_key
		page_header.back_pressed.connect(func(): if _view != null: _view.back())
	return page_header
