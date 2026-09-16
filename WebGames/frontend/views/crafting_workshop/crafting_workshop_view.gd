# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第12卷: 制造与工坊系统视图控制器
# 文件路径: res://frontend/views/crafting_workshop/crafting_workshop_view.gd
# 职责: 锻造强化预览(+1~+15)、配方图鉴习得检索、装备分解材料返还清单、
#       材料仓库分类浏览与获取途径
#       四 Tab 界面：
#       - FORGE 锻造（配方列表 + 材料对照 + 成功率 + 数量 + 制造）；
#       - RECIPES 配方图鉴（5 分类 Tab + 网格 + 已习得/未习得 + 详情）；
#       - DISMANTLE 分解（背包列表 + 分解预览 + 数量 + 分解）；
#       - MATERIALS 材料仓库（6 分类 + 网格 + 详情 + 获取途径）。
# 骨架阶段：零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name CraftingWorkshopView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")

# ==============================================================================
# 强化成功率规则（经 domain_boundary 服务预测，视图不做公式与配置读取）
# ==============================================================================

# ==============================================================================
# 锻造数据快照
# ==============================================================================

# 当前选中的锻造配方
var selected_forge_item: Dictionary = {}
# 锻造目标等级（当前 +1）
var enhancement_target_level: int = 0
# 预测成功率
var predicted_success_rate: float = 1.0
# 锻造配方列表
var _forge_recipes: Array = []
# 当前选中的配方索引
var _forge_selected_index: int = -1

# ==============================================================================
# 配方图鉴数据快照
# ==============================================================================

# 图鉴分类（5 分类）
var _recipe_categories: Array = ["weapon", "armor", "accessory", "consumable", "material"]
var _recipe_catalog: Array = []  # 全部配方图鉴
var _recipe_current_category: int = 0
var _recipe_selected_index: int = -1

# ==============================================================================
# 分解数据快照
# ==============================================================================

var selected_salvage_item: Dictionary = {}
var estimated_salvage_materials: Array = []
var _dismantle_items: Array = []  # 背包可分解物品
var _dismantle_selected_index: int = -1
var _dismantle_history: Array = []  # 分解历史日志

# ==============================================================================
# 材料仓库数据快照
# ==============================================================================

# 材料分类（6 分类）
var _material_categories: Array = ["ore", "herb", "leather", "wood", "crystal", "misc"]
var _materials: Array = []  # 全部材料
var _material_current_category: int = 0
var _material_selected_index: int = -1

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记，与 .tscn 一一对应）
# ==============================================================================

# --- 全局 ---
@onready var _tab_container: TabContainer = %TabContainer
@onready var _btn_back: Button = %BtnBack
@onready var _title_label: Label = %TitleLabel

# --- Tab 1: 锻造 (FORGE) ---
@onready var _option_forge_category: OptionButton = %OptionForgeCategory
@onready var _line_forge_search: LineEdit = %LineForgeSearch
@onready var _forge_recipe_list: ItemList = %ForgeRecipeList
@onready var _label_forge_item_name: Label = %LabelForgeItemName
@onready var _label_forge_rarity: Label = %LabelForgeRarity
@onready var _forge_material_list: ItemList = %ForgeMaterialList
@onready var _label_forge_success_rate: Label = %LabelForgeSuccessRate
@onready var _spin_forge_quantity: SpinBox = %SpinForgeQuantity
@onready var _label_forge_result: Label = %LabelForgeResult
@onready var _btn_forge_craft: Button = %BtnForgeCraft

# --- Tab 2: 配方图鉴 (RECIPES) ---
@onready var _label_recipe_progress: Label = %LabelRecipeProgress
@onready var _recipe_tab_bar: TabBar = %RecipeTabBar
@onready var _recipe_grid: GridContainer = %RecipeGrid
@onready var _label_recipe_name: Label = %LabelRecipeName
@onready var _label_recipe_rarity: Label = %LabelRecipeRarity
@onready var _label_recipe_status: Label = %LabelRecipeStatus
@onready var _label_recipe_unlock_condition: Label = %LabelRecipeUnlockCondition
@onready var _recipe_material_list: ItemList = %RecipeMaterialList

# --- Tab 3: 分解 (DISMANTLE) ---
@onready var _option_dismantle_filter: OptionButton = %OptionDismantleFilter
@onready var _dismantle_item_list: ItemList = %DismantleItemList
@onready var _label_dismantle_item_name: Label = %LabelDismantleItemName
@onready var _dismantle_preview_list: ItemList = %DismantlePreviewList
@onready var _spin_dismantle_quantity: SpinBox = %SpinDismantleQuantity
@onready var _btn_dismantle_confirm: Button = %BtnDismantleConfirm
@onready var _dismantle_history_list: ItemList = %DismantleHistoryList

# --- Tab 4: 材料仓库 (MATERIALS) ---
@onready var _material_category_hbox: HBoxContainer = %MaterialCategoryHBox
@onready var _material_grid: GridContainer = %MaterialGrid
@onready var _label_material_name: Label = %LabelMaterialName
@onready var _label_material_rarity: Label = %LabelMaterialRarity
@onready var _label_material_quantity: Label = %LabelMaterialQuantity
@onready var _label_material_description: Label = %LabelMaterialDescription
@onready var _label_material_source: Label = %LabelMaterialSource

# ==============================================================================
# 公开交互方法（白模测试契约：锻造选择 / 分解选择 / 成功率预测）
# ==============================================================================

## 白模测试契约桩：选中锻造配方并预测强化成功率（公式经服务产出）
func select_forge_item(item_data: Dictionary) -> void:
	selected_forge_item = item_data.duplicate()
	enhancement_target_level = int(item_data.get("enhancement_level", 0)) + 1
	var preview := MockServiceContainer.get_instance().crafting().preview_enhance_rate(enhancement_target_level)
	if bool(preview.get("success", false)):
		predicted_success_rate = float(preview.get("rate", predicted_success_rate))
	_refresh_forge_detail()

## 白模测试契约桩：选中分解物品并注入预计产出材料清单
func select_salvage_item(item_data: Dictionary, mock_yield: Array) -> void:
	selected_salvage_item = item_data.duplicate()
	estimated_salvage_materials = mock_yield.duplicate()
	_refresh_dismantle_detail()

# ==============================================================================
# 生命周期
# ==============================================================================

## 生命周期初始化：主题/Mock 数据/头栏与四 Tab/信号绑定（骨架零接线）
func _ready() -> void:
	_apply_theme()
	_load_mock_data()
	_init_header_text()
	_init_tab_titles()
	_init_forge_tab()
	_init_recipes_tab()
	_init_dismantle_tab()
	_init_materials_tab()
	_connect_signals()
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

## 应用 ThemeManager 单例主题（null 安全）
func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# Mock 数据加载（零接线阶段，不接后端）
# ==============================================================================

## 加载 Mock 数据：锻造配方/图鉴/分解背包/材料仓库（视图内常量，经 apply_snapshot 注入）
func _load_mock_data() -> void:
	# 锻造配方
	var forge_recipes: Array = [
		{ "name": "ui.fe12.mock.forge.mithril_sword", "rarity": "RARE", "category": "weapon", "materials": [{ "name": "ui.fe12.mock.material.mithril_ingot", "qty": 3 }, { "name": "ui.fe12.mock.material.iron_ore", "qty": 2 }], "enhancement_level": 0, "learned": true },
		{ "name": "ui.fe12.mock.forge.leather_armor", "rarity": "COMMON", "category": "armor", "materials": [{ "name": "ui.fe12.mock.material.leather", "qty": 4 }, { "name": "ui.fe12.mock.material.thread", "qty": 2 }], "enhancement_level": 2, "learned": true },
		{ "name": "ui.fe12.mock.forge.wind_bow", "rarity": "RARE", "category": "weapon", "materials": [{ "name": "ui.fe12.mock.material.wood", "qty": 5 }, { "name": "ui.fe12.mock.material.thread", "qty": 1 }], "enhancement_level": 0, "learned": false },
		{ "name": "ui.fe12.mock.forge.arcane_staff", "rarity": "EPIC", "category": "weapon", "materials": [{ "name": "ui.fe12.mock.material.mana_shard", "qty": 6 }, { "name": "ui.fe12.mock.material.wood", "qty": 3 }], "enhancement_level": 0, "learned": true },
		{ "name": "ui.fe12.mock.forge.dragon_armor", "rarity": "LEGENDARY", "category": "armor", "materials": [{ "name": "ui.fe12.mock.material.dragon_scale", "qty": 8 }, { "name": "ui.fe12.mock.material.mithril_ingot", "qty": 4 }], "enhancement_level": 0, "learned": false },
	]
	# 配方图鉴
	var recipe_catalog: Array = forge_recipes.duplicate(true)
	# 分解背包
	var dismantle_items: Array = [
		{ "name": "ui.fe12.mock.dismantle.old_sword", "rarity": "COMMON", "category": "weapon", "qty": 2, "yield": [{ "name": "ui.fe12.mock.material.iron_ore", "qty": 3 }] },
		{ "name": "ui.fe12.mock.dismantle.old_leather", "rarity": "COMMON", "category": "armor", "qty": 1, "yield": [{ "name": "ui.fe12.mock.material.leather", "qty": 2 }] },
		{ "name": "ui.fe12.mock.dismantle.broken_staff", "rarity": "RARE", "category": "weapon", "qty": 1, "yield": [{ "name": "ui.fe12.mock.material.mana_shard", "qty": 2 }, { "name": "ui.fe12.mock.material.wood", "qty": 2 }] },
		{ "name": "ui.fe12.mock.dismantle.excess_mithril", "rarity": "RARE", "category": "material", "qty": 5, "yield": [{ "name": "ui.fe12.mock.material.mana_shard", "qty": 1 }] },
	]
	# 材料仓库
	var materials: Array = [
		{ "name": "ui.fe12.mock.material.iron_ore", "rarity": "COMMON", "category": "ore", "qty": 25, "desc": "ui.fe12.mock.material.iron_ore.desc", "source": "ui.fe12.mock.material.iron_ore.source" },
		{ "name": "ui.fe12.mock.material.mithril_ingot", "rarity": "RARE", "category": "ore", "qty": 8, "desc": "ui.fe12.mock.material.mithril_ingot.desc", "source": "ui.fe12.mock.material.mithril_ingot.source" },
		{ "name": "ui.fe12.mock.material.mana_shard", "rarity": "EPIC", "category": "crystal", "qty": 12, "desc": "ui.fe12.mock.material.mana_shard.desc", "source": "ui.fe12.mock.material.mana_shard.source" },
		{ "name": "ui.fe12.mock.material.dragon_scale", "rarity": "LEGENDARY", "category": "misc", "qty": 2, "desc": "ui.fe12.mock.material.dragon_scale.desc", "source": "ui.fe12.mock.material.dragon_scale.source" },
		{ "name": "ui.fe12.mock.material.herb", "rarity": "COMMON", "category": "herb", "qty": 30, "desc": "ui.fe12.mock.material.herb.desc", "source": "ui.fe12.mock.material.herb.source" },
		{ "name": "ui.fe12.mock.material.leather", "rarity": "COMMON", "category": "leather", "qty": 15, "desc": "ui.fe12.mock.material.leather.desc", "source": "ui.fe12.mock.material.leather.source" },
		{ "name": "ui.fe12.mock.material.wood", "rarity": "COMMON", "category": "wood", "qty": 40, "desc": "ui.fe12.mock.material.wood.desc", "source": "ui.fe12.mock.material.wood.source" },
		{ "name": "ui.fe12.mock.material.thread", "rarity": "COMMON", "category": "misc", "qty": 18, "desc": "ui.fe12.mock.material.thread.desc", "source": "ui.fe12.mock.material.thread.source" },
	]
	apply_snapshot({
		"forge_recipes": forge_recipes,
		"recipe_catalog": recipe_catalog,
		"dismantle_items": dismantle_items,
		"materials": materials,
	})

## 统一快照渲染映射（P81）：配方/图鉴/分解/材料 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("forge_recipes"):
		_forge_recipes = FrontendSnapshot.read_array(snapshot, "forge_recipes")
	if snapshot.has("recipe_catalog"):
		_recipe_catalog = FrontendSnapshot.read_array(snapshot, "recipe_catalog")
	if snapshot.has("dismantle_items"):
		_dismantle_items = FrontendSnapshot.read_array(snapshot, "dismantle_items")
	if snapshot.has("materials"):
		_materials = FrontendSnapshot.read_array(snapshot, "materials")

# ==============================================================================
# 顶部栏与 Tab 标题初始化
# ==============================================================================

## 初始化顶部标题与返回按钮文案（i18n 驱动）
func _init_header_text() -> void:
	UIIntermediary.resolve(_title_label, "ui.fe12.header.title")
	UIIntermediary.resolve(_btn_back, "ui.fe12.header.back")

## 设置四主 Tab 标题（i18n 键驱动）
func _init_tab_titles() -> void:
	UIIntermediary.resolve_tab(_tab_container, 0, "ui.fe12.tab.forge")
	UIIntermediary.resolve_tab(_tab_container, 1, "ui.fe12.tab.recipes")
	UIIntermediary.resolve_tab(_tab_container, 2, "ui.fe12.tab.dismantle")
	UIIntermediary.resolve_tab(_tab_container, 3, "ui.fe12.tab.materials")

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：四 Tab 控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)
	# Tab 切换
	_tab_container.tab_changed.connect(_on_tab_changed)
	# 锻造
	_option_forge_category.item_selected.connect(_on_forge_category_selected)
	_line_forge_search.text_changed.connect(_on_forge_search_changed)
	_forge_recipe_list.item_selected.connect(_on_forge_recipe_selected)
	_spin_forge_quantity.value_changed.connect(_on_forge_quantity_changed)
	_btn_forge_craft.pressed.connect(_on_forge_craft_pressed)
	# 配方图鉴
	_recipe_tab_bar.tab_changed.connect(_on_recipe_category_changed)
	# 分解
	_option_dismantle_filter.item_selected.connect(_on_dismantle_filter_selected)
	_dismantle_item_list.item_selected.connect(_on_dismantle_item_selected)
	_spin_dismantle_quantity.value_changed.connect(_on_dismantle_quantity_changed)
	_btn_dismantle_confirm.pressed.connect(_on_dismantle_confirm_pressed)
	# 材料仓库（分类按钮在 _init_materials_tab 动态生成时绑定）

# ==============================================================================
# Tab 1: 锻造 (FORGE) 初始化
# ==============================================================================

## 初始化锻造 Tab：区块标签/搜索占位/分类下拉/数量/按钮态与配方列表
func _init_forge_tab() -> void:
	# 静态区块标签
	var forge_tab: Control = _tab_container.get_child(0)
	var section_list_label: Label = forge_tab.get_node("LeftPanel/SectionLabel")
	UIIntermediary.resolve(section_list_label, "ui.fe12.forge.section_list")
	var section_detail_label: Label = forge_tab.get_node("RightPanel/DetailSectionLabel")
	UIIntermediary.resolve(section_detail_label, "ui.fe12.forge.section_detail")
	var section_materials_label: Label = forge_tab.get_node("RightPanel/MaterialSectionLabel")
	UIIntermediary.resolve(section_materials_label, "ui.fe12.forge.section_materials")
	var qty_label: Label = forge_tab.get_node("RightPanel/QuantityRow/QtyLabel")
	UIIntermediary.resolve(qty_label, "ui.fe12.forge.quantity")
	# 搜索框占位符
	UIIntermediary.resolve_placeholder(_line_forge_search, "ui.fe12.forge.search_ph")
	# 锻造分类下拉
	_option_forge_category.clear()
	_option_forge_category.add_item(UIIntermediary.text("ui.fe12.category.all"))
	for cat in _recipe_categories:
		_option_forge_category.add_item(UIIntermediary.text("ui.fe12.category." + str(cat)))
	_option_forge_category.select(0)
	# 数量默认 1
	_spin_forge_quantity.value = 1
	# 制造按钮
	UIIntermediary.resolve(_btn_forge_craft, "ui.fe12.forge.craft_btn")
	_btn_forge_craft.disabled = true
	UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.no_recipe")
	_populate_forge_recipe_list()

## 填充锻造配方列表：关键词 + 分类双过滤，重置选中并禁用制造按钮
func _populate_forge_recipe_list() -> void:
	_forge_recipe_list.clear()
	var keyword := _line_forge_search.text.strip_edges().to_lower()
	var cat_index := _option_forge_category.selected
	var cat_filter := ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for recipe in _forge_recipes:
		var name_str := UIIntermediary.text(str(recipe.get("name", "")))
		if not keyword.is_empty() and not name_str.to_lower().contains(keyword):
			continue
		if not cat_filter.is_empty() and str(recipe.get("category", "")) != cat_filter:
			continue
		var learned_tag := "✓" if bool(recipe.get("learned", false)) else "✗"
		UIIntermediary.resolve_item(_forge_recipe_list, "ui.fe12.forge.recipe_display", {
			"tag": learned_tag, "name": name_str, "rarity": str(recipe.get("rarity", ""))
		})
	# 重置选中状态
	_forge_selected_index = -1
	_btn_forge_craft.disabled = true

## 刷新锻造详情：未选中占位或名称/稀有度/成功率/材料对照，按习得态启停制造按钮
func _refresh_forge_detail() -> void:
	if selected_forge_item.is_empty():
		UIIntermediary.resolve(_label_forge_item_name, "ui.fe12.forge.select_prompt")
		UIIntermediary.resolve(_label_forge_rarity, "ui.fe12.forge.rarity_none")
		UIIntermediary.resolve(_label_forge_success_rate, "ui.fe12.forge.success_none")
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.no_recipe")
		_btn_forge_craft.disabled = true
		return
	UIIntermediary.resolve(_label_forge_item_name, str(selected_forge_item.get("name", "")))
	UIIntermediary.resolve(_label_forge_rarity, "ui.fe12.forge.rarity", {"rarity": str(selected_forge_item.get("rarity", "--"))})
	UIIntermediary.resolve(_label_forge_success_rate, "ui.fe12.forge.success", {"percent": int(predicted_success_rate * 100.0), "level": enhancement_target_level})
	# 材料对照清单
	if _forge_material_list:
		_forge_material_list.clear()
		var materials: Array = selected_forge_item.get("materials", [])
		for mat in materials:
			UIIntermediary.resolve_item(_forge_material_list, "ui.fe12.forge.material", {
				"name": UIIntermediary.text(str(mat.get("name", ""))), "count": int(mat.get("qty", 0))
			})
	if _btn_forge_craft:
		_btn_forge_craft.disabled = not bool(selected_forge_item.get("learned", false))
	if bool(selected_forge_item.get("learned", false)):
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.ready", {"level": enhancement_target_level})
	else:
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.not_learned")

# ==============================================================================
# Tab 2: 配方图鉴 (RECIPES) 初始化
# ==============================================================================

## 初始化配方图鉴 Tab：分类 TabBar（清占位后建 5 分类）/网格/进度首刷
func _init_recipes_tab() -> void:
	# 静态区块标签
	var recipes_tab: Control = _tab_container.get_child(1)
	var section_label: Label = recipes_tab.get_node("TopRow/SectionLabel")
	UIIntermediary.resolve(section_label, "ui.fe12.recipes.section")
	var material_label: Label = recipes_tab.get_node("DetailPanel/DetailVBox/MaterialLabel")
	UIIntermediary.resolve(material_label, "ui.fe12.recipes.section_materials")
	# 图鉴分类 TabBar（5 分类），先清理 .tscn 可能存在的占位 Tab
	if _recipe_tab_bar.tab_count > 0:
		_recipe_tab_bar.clear_tab(0)
	for cat in _recipe_categories:
		_recipe_tab_bar.add_tab(UIIntermediary.text("ui.fe12.category." + str(cat)))
	_recipe_tab_bar.current_tab = 0
	_recipe_current_category = 0
	_populate_recipe_grid()
	_refresh_recipe_progress()

## 重建配方网格：按分类过滤生成细胞，重置选中并清详情
func _populate_recipe_grid() -> void:
	# 清除旧格子
	for child in _recipe_grid.get_children():
		child.queue_free()
	var category: String = _recipe_categories[_recipe_current_category] if _recipe_current_category < _recipe_categories.size() else ""
	for i in range(_recipe_catalog.size()):
		var recipe: Dictionary = _recipe_catalog[i]
		if not category.is_empty() and str(recipe.get("category", "")) != category:
			continue
		_recipe_grid.add_child(_make_recipe_cell(recipe, i))
	# 重置选中
	_recipe_selected_index = -1
	_clear_recipe_detail()

## 构建配方网格细胞：稀有度配色边框（未习得灰化）+ 名称/状态标签 + 点击回调
func _make_recipe_cell(recipe: Dictionary, catalog_index: int) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(96, 96)
	var learned := bool(recipe.get("learned", false))
	# 未习得配方灰化边框
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.border_color = _rarity_color(str(recipe.get("rarity", "COMMON"))) if learned else DesignTokens.COLOR_TEXT_MUTED_DEFAULT
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
	# 点击选中（通过 gui_input 简化骨架阶段交互）
	panel.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			_on_recipe_cell_selected(catalog_index))
	return panel

## 清空配方详情为占位态
func _clear_recipe_detail() -> void:
	UIIntermediary.resolve(_label_recipe_name, "ui.fe12.recipes.select_prompt")
	UIIntermediary.resolve(_label_recipe_rarity, "ui.fe12.recipes.rarity_none")
	UIIntermediary.resolve(_label_recipe_status, "ui.fe12.recipes.status_none")
	UIIntermediary.resolve(_label_recipe_unlock_condition, "ui.fe12.recipes.unlock_none")
	_recipe_material_list.clear()

## 刷新配方详情：名称/稀有度/习得态/解锁条件/材料清单（越界清空占位）
func _refresh_recipe_detail() -> void:
	if _recipe_selected_index < 0 or _recipe_selected_index >= _recipe_catalog.size():
		_clear_recipe_detail()
		return
	var recipe: Dictionary = _recipe_catalog[_recipe_selected_index]
	UIIntermediary.resolve(_label_recipe_name, str(recipe.get("name", "")))
	UIIntermediary.resolve(_label_recipe_rarity, "ui.fe12.recipes.rarity", {"rarity": str(recipe.get("rarity", "--"))})
	var learned := bool(recipe.get("learned", false))
	var status_text := UIIntermediary.text("ui.fe12.recipes.status_learned") if learned else UIIntermediary.text("ui.fe12.recipes.status_not_learned")
	UIIntermediary.resolve(_label_recipe_status, "ui.fe12.recipes.status", {"status": status_text})
	var condition_raw := str(recipe.get("unlock_condition", "ui.fe12.recipes.unlock_default"))
	UIIntermediary.resolve(_label_recipe_unlock_condition, "ui.fe12.recipes.unlock", {"condition": UIIntermediary.text(condition_raw)})
	_recipe_material_list.clear()
	for mat in recipe.get("materials", []):
		UIIntermediary.resolve_item(_recipe_material_list, "ui.fe12.recipe.material", {
			"name": UIIntermediary.text(str(mat.get("name", ""))), "count": int(mat.get("qty", 0))
		})

## 刷新图鉴习得进度（已习得/总数）
func _refresh_recipe_progress() -> void:
	var learned_count := 0
	for recipe in _recipe_catalog:
		if bool(recipe.get("learned", false)):
			learned_count += 1
	UIIntermediary.resolve(_label_recipe_progress, "ui.fe12.recipes.progress", {"learned": learned_count, "total": _recipe_catalog.size()})

## 配方细胞点击：记录图鉴索引并刷新详情
func _on_recipe_cell_selected(catalog_index: int) -> void:
	_recipe_selected_index = catalog_index
	_refresh_recipe_detail()

# ==============================================================================
# Tab 3: 分解 (DISMANTLE) 初始化
# ==============================================================================

## 初始化分解 Tab：区块标签/确认按钮/筛选下拉/数量/列表与历史占位
func _init_dismantle_tab() -> void:
	# 静态区块标签
	var dismantle_tab: Control = _tab_container.get_child(2)
	var section_list_label: Label = dismantle_tab.get_node("LeftPanel/SectionLabel")
	UIIntermediary.resolve(section_list_label, "ui.fe12.dismantle.section_list")
	var section_preview_label: Label = dismantle_tab.get_node("RightPanel/DetailSectionLabel")
	UIIntermediary.resolve(section_preview_label, "ui.fe12.dismantle.section_preview")
	var section_output_label: Label = dismantle_tab.get_node("RightPanel/PreviewLabel")
	UIIntermediary.resolve(section_output_label, "ui.fe12.dismantle.section_output")
	var qty_label: Label = dismantle_tab.get_node("RightPanel/QuantityRow/QtyLabel")
	UIIntermediary.resolve(qty_label, "ui.fe12.dismantle.quantity")
	var section_history_label: Label = dismantle_tab.get_node("RightPanel/HistoryLabel")
	UIIntermediary.resolve(section_history_label, "ui.fe12.dismantle.section_history")
	# 分解确认按钮
	UIIntermediary.resolve(_btn_dismantle_confirm, "ui.fe12.dismantle.confirm_btn")
	# 分解筛选下拉
	_option_dismantle_filter.clear()
	_option_dismantle_filter.add_item(UIIntermediary.text("ui.fe12.category.all"))
	for cat in _recipe_categories:
		_option_dismantle_filter.add_item(UIIntermediary.text("ui.fe12.category." + str(cat)))
	_option_dismantle_filter.select(0)
	_spin_dismantle_quantity.value = 1
	_populate_dismantle_list()
	_dismantle_history_list.clear()
	UIIntermediary.resolve(_label_dismantle_item_name, "ui.fe12.dismantle.select_prompt")
	_dismantle_preview_list.clear()

## 填充分解背包列表：按分类过滤并重置选中
func _populate_dismantle_list() -> void:
	_dismantle_item_list.clear()
	var cat_index := _option_dismantle_filter.selected
	var cat_filter := ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for item in _dismantle_items:
		if not cat_filter.is_empty() and str(item.get("category", "")) != cat_filter:
			continue
		UIIntermediary.resolve_item(_dismantle_item_list, "ui.fe12.dismantle.item_display", {
			"name": UIIntermediary.text(str(item.get("name", ""))),
			"rarity": str(item.get("rarity", "")),
			"count": int(item.get("qty", 0))
		})
	_dismantle_selected_index = -1

## 刷新分解预览：未选中占位或名称/产出清单（产出量 × 分解数量）
func _refresh_dismantle_detail() -> void:
	if selected_salvage_item.is_empty():
		UIIntermediary.resolve(_label_dismantle_item_name, "ui.fe12.dismantle.select_prompt")
		if _dismantle_preview_list:
			_dismantle_preview_list.clear()
		return
	UIIntermediary.resolve(_label_dismantle_item_name, str(selected_salvage_item.get("name", "")))
	if _dismantle_preview_list:
		_dismantle_preview_list.clear()
		var mult: int = int(_spin_dismantle_quantity.value) if _spin_dismantle_quantity else 1
		for mat in estimated_salvage_materials:
			var qty := int(mat.get("qty", 0)) * mult
			UIIntermediary.resolve_item(_dismantle_preview_list, "ui.fe12.disassemble.output", {
				"name": UIIntermediary.text(str(mat.get("name", ""))), "count": qty
			})

# ==============================================================================
# Tab 4: 材料仓库 (MATERIALS) 初始化
# ==============================================================================

## 初始化材料仓库 Tab：六分类按钮动态生成 + 默认选中首类 + 网格/详情占位
func _init_materials_tab() -> void:
	# 静态区块标签
	var materials_tab: Control = _tab_container.get_child(3)
	var section_label: Label = materials_tab.get_node("SectionLabel")
	UIIntermediary.resolve(section_label, "ui.fe12.materials.section")
	# 分类按钮（6 分类，动态生成到 MaterialCategoryHBox）
	for child in _material_category_hbox.get_children():
		child.queue_free()
	for i in range(_material_categories.size()):
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.text = UIIntermediary.text("ui.fe12.mat_category." + str(_material_categories[i]))
		btn.toggle_mode = true
		btn.custom_minimum_size = Vector2(72, 0)
		var cat_idx := i
		btn.pressed.connect(func(): _on_material_category_pressed(cat_idx))
		_material_category_hbox.add_child(btn)
	# 默认选中第一分类
	_material_current_category = 0
	_refresh_material_category_buttons()
	_populate_material_grid()
	_clear_material_detail()

## 刷新分类按钮选中态（唯一高亮当前分类）
func _refresh_material_category_buttons() -> void:
	for i in _material_category_hbox.get_child_count():
		var btn: Button = _material_category_hbox.get_child(i)
		btn.button_pressed = (i == _material_current_category)

## 重建材料网格：按分类过滤生成细胞，重置选中并清详情
func _populate_material_grid() -> void:
	for child in _material_grid.get_children():
		child.queue_free()
	var category: String = _material_categories[_material_current_category] if _material_current_category < _material_categories.size() else ""
	for i in range(_materials.size()):
		var mat: Dictionary = _materials[i]
		if not category.is_empty() and str(mat.get("category", "")) != category:
			continue
		_material_grid.add_child(_make_material_cell(mat, i))
	_material_selected_index = -1
	_clear_material_detail()

## 构建材料网格细胞：稀有度配色边框 + 名称/数量标签 + 点击回调
func _make_material_cell(mat: Dictionary, list_index: int) -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(80, 80)
	var style := StyleBoxFlat.new()
	style.bg_color = DesignTokens.COLOR_SURFACE_DEFAULT
	style.border_color = _rarity_color(str(mat.get("rarity", "COMMON")))
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
	UIIntermediary.resolve(_label_material_name, "ui.fe12.materials.select_prompt")
	UIIntermediary.resolve(_label_material_rarity, "ui.fe12.materials.rarity_none")
	UIIntermediary.resolve(_label_material_quantity, "ui.fe12.materials.quantity_none")
	UIIntermediary.resolve(_label_material_description, "ui.fe12.materials.desc_none")
	UIIntermediary.resolve(_label_material_source, "ui.fe12.materials.source_none")

## 刷新材料详情：名称/稀有度/数量/描述/获取途径（越界清空占位）
func _refresh_material_detail() -> void:
	if _material_selected_index < 0 or _material_selected_index >= _materials.size():
		_clear_material_detail()
		return
	var mat: Dictionary = _materials[_material_selected_index]
	UIIntermediary.resolve(_label_material_name, str(mat.get("name", "")))
	UIIntermediary.resolve(_label_material_rarity, "ui.fe12.materials.rarity", {"rarity": str(mat.get("rarity", "--"))})
	UIIntermediary.resolve(_label_material_quantity, "ui.fe12.materials.quantity", {"count": int(mat.get("qty", 0))})
	UIIntermediary.resolve(_label_material_description, "ui.fe12.materials.desc", {"desc": UIIntermediary.text(str(mat.get("desc", "--")))})
	UIIntermediary.resolve(_label_material_source, "ui.fe12.materials.source", {"source": UIIntermediary.text(str(mat.get("source", "--")))})

## 材料细胞点击：记录索引并刷新详情
func _on_material_cell_selected(list_index: int) -> void:
	_material_selected_index = list_index
	_refresh_material_detail()

## 分类按钮点击：切换当前分类并重建网格与按钮态
func _on_material_category_pressed(cat_idx: int) -> void:
	_material_current_category = cat_idx
	_refresh_material_category_buttons()
	_populate_material_grid()

# ==============================================================================
# Tab 1: 锻造信号处理
# ==============================================================================

## 锻造分类切换：重建配方列表
func _on_forge_category_selected(_index: int) -> void:
	_populate_forge_recipe_list()

## 锻造搜索变化：重建配方列表
func _on_forge_search_changed(_text: String) -> void:
	_populate_forge_recipe_list()

## 配方条目选中：过滤后反查源配方并注入选中（select_forge_item）
func _on_forge_recipe_selected(index: int) -> void:
	_forge_selected_index = index
	# 从过滤后的列表反查源配方（骨架阶段：用索引匹配过滤后顺序）
	# 简化处理：取过滤后第 index 项对应的源数据
	var filtered := _get_filtered_forge_recipes()
	if index >= 0 and index < filtered.size():
		select_forge_item(filtered[index])
	else:
		selected_forge_item.clear()
		_refresh_forge_detail()

## 锻造数量变化：刷新制造结果文案（数量维度）
func _on_forge_quantity_changed(_value: float) -> void:
	# 数量变化仅影响制造结果文案
	if not selected_forge_item.is_empty():
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.ready_qty", {"level": enhancement_target_level, "count": int(_spin_forge_quantity.value)})

## 制造按钮：习得态校验后渲染成功文案并打印锻造日志（骨架桩）
func _on_forge_craft_pressed() -> void:
	if selected_forge_item.is_empty() or not bool(selected_forge_item.get("learned", false)):
		return
	var qty := int(_spin_forge_quantity.value)
	UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.craft_success", {
		"name": UIIntermediary.text(str(selected_forge_item.get("name", ""))),
		"level": enhancement_target_level,
		"count": qty,
	})
	print("[CraftingWorkshop] 锻造: %s +%d ×%d (成功率 %.0f%%)" % [
		selected_forge_item.get("name", ""),
		enhancement_target_level,
		qty,
		predicted_success_rate * 100.0,
	])

## 获取过滤后的锻造配方（与列表渲染同口径，供选中反查）
func _get_filtered_forge_recipes() -> Array:
	var filtered := []
	var keyword := _line_forge_search.text.strip_edges().to_lower()
	var cat_index := _option_forge_category.selected
	var cat_filter := ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for recipe in _forge_recipes:
		var name_str := UIIntermediary.text(str(recipe.get("name", "")))
		if not keyword.is_empty() and not name_str.to_lower().contains(keyword):
			continue
		if not cat_filter.is_empty() and str(recipe.get("category", "")) != cat_filter:
			continue
		filtered.append(recipe)
	return filtered

# ==============================================================================
# Tab 2: 配方图鉴信号处理
# ==============================================================================

## 图鉴分类切换：更新分类并重建网格
func _on_recipe_category_changed(tab_index: int) -> void:
	_recipe_current_category = tab_index
	_populate_recipe_grid()

# ==============================================================================
# Tab 3: 分解信号处理
# ==============================================================================

## 分解筛选切换：重建背包列表
func _on_dismantle_filter_selected(_index: int) -> void:
	_populate_dismantle_list()

## 分解物品选中：过滤后反查源数据并注入产出预览
func _on_dismantle_item_selected(index: int) -> void:
	_dismantle_selected_index = index
	# 从过滤后列表反查源数据
	var filtered := _get_filtered_dismantle_items()
	if index >= 0 and index < filtered.size():
		var item: Dictionary = filtered[index]
		select_salvage_item(item, item.get("yield", []))
	else:
		selected_salvage_item.clear()
		estimated_salvage_materials.clear()
		_refresh_dismantle_detail()

## 分解数量变化：刷新产出预览
func _on_dismantle_quantity_changed(_value: float) -> void:
	# 数量变化更新预览产出
	_refresh_dismantle_detail()

## 分解确认按钮：未选拦截，记入分解历史（倒序展示）并打印日志（骨架桩）
func _on_dismantle_confirm_pressed() -> void:
	if selected_salvage_item.is_empty():
		print("[CraftingWorkshop] 分解：未选择物品")
		return
	var qty := int(_spin_dismantle_quantity.value)
	var item_name := UIIntermediary.text(str(selected_salvage_item.get("name", "")))
	# 记入分解历史
	_dismantle_history.append({ "name": item_name, "qty": qty, "time": UIIntermediary.text("ui.fe12.dismantle.just_now") })
	_dismantle_history_list.clear()
	# 倒序展示
	var recent := _dismantle_history.duplicate()
	recent.reverse()
	for entry in recent:
		UIIntermediary.resolve_item(_dismantle_history_list, "ui.fe12.dismantle.history_item", {
			"name": str(entry.get("name", "")),
			"count": int(entry.get("qty", 0)),
			"time": str(entry.get("time", ""))
		})
	print("[CraftingWorkshop] 分解: %s ×%d" % [item_name, qty])

## 获取过滤后的分解物品（与列表渲染同口径，供选中反查）
func _get_filtered_dismantle_items() -> Array:
	var filtered := []
	var cat_index := _option_dismantle_filter.selected
	var cat_filter := ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for item in _dismantle_items:
		if not cat_filter.is_empty() and str(item.get("category", "")) != cat_filter:
			continue
		filtered.append(item)
	return filtered

# ==============================================================================
# 全局信号处理
# ==============================================================================

## 主 Tab 切换：骨架阶段占位
func _on_tab_changed(_tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换工坊分类", NavTypes.ToastLevel.INFO, 1.0)

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	# 返回按钮：通过 ViewRouter 返回上一视图
	var router := ViewRouter.get_instance()
	if router != null:
		router.pop_view()

# ==============================================================================
# 工具方法
# ==============================================================================

## 稀有度对应配色（LEGENDARY 金 / EPIC 紫 / RARE 蓝 / COMMON 灰）
func _rarity_color(rarity: String) -> Color:
	match rarity:
		"LEGENDARY": return DesignTokens.COLOR_WARNING_DEFAULT
		"EPIC": return DesignTokens.COLOR_RARITY_EPIC
		"RARE": return DesignTokens.COLOR_ACCENT_DEFAULT
		"UNCOMMON": return DesignTokens.COLOR_SUCCESS_DEFAULT
		_: return DesignTokens.COLOR_TEXT_MUTED_DEFAULT
