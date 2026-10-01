# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第12卷: 制造与工坊系统视图控制器
# 文件路径: res://frontend/views/crafting_workshop/crafting_workshop_view.gd
# 职责: 锻造强化预览(+1~+15)、配方图鉴习得检索、装备分解材料返还清单、
#       材料仓库分类浏览与获取途径
#       四 Tab 界面：
#       - FORGE 锻造（主视图承载）
#       - RECIPES 配方图鉴（委托 CraftingWorkshopTabs）
#       - DISMANTLE 分解（主视图承载）
#       - MATERIALS 材料仓库（委托 CraftingWorkshopTabs）
# 骨架阶段：零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
class_name CraftingWorkshopView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const KRarityTag = preload("res://frontend/components/k_rarity_tag.gd")
const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const CraftingWorkshopTabsClass = preload("res://frontend/views/crafting_workshop/crafting_workshop_tabs.gd")

# ==============================================================================
# 状态与快照字段
# ==============================================================================

# 当前选中的锻造配方
var selected_forge_item: Dictionary = {}
var enhancement_target_level: int = 0
var predicted_success_rate: float = 1.0
var _forge_recipes: Array = []
var _forge_selected_index: int = -1

# 配方图鉴快照
var _recipe_categories: Array = ["weapon", "armor", "accessory", "consumable", "material"]
var _recipe_catalog: Array = []
var _recipe_current_category: int = 0
var _recipe_selected_index: int = -1

# 分解快照
var selected_salvage_item: Dictionary = {}
var estimated_salvage_materials: Array = []
var _dismantle_items: Array = []
var _dismantle_selected_index: int = -1
var _dismantle_history: Array = []

# 材料仓库快照
var _material_categories: Array = ["ore", "herb", "leather", "wood", "crystal", "misc"]
var _materials: Array = []
var _material_current_category: int = 0
var _material_selected_index: int = -1

# 子面板委托控制器
var _tabs = null

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
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
# 子面板委托与初始化
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = CraftingWorkshopTabsClass.new()
		_tabs.setup(self)
	return _tabs

# ==============================================================================
# 公开交互方法（白模测试契约）
# ==============================================================================

## 白模测试契约桩：选中锻造配方并预测强化成功率
func select_forge_item(item_data: Dictionary) -> void:
	selected_forge_item = item_data.duplicate()
	enhancement_target_level = int(item_data.get("enhancement_level", 0)) + 1
	var preview: Dictionary = MockServiceContainer.get_instance().crafting().preview_enhance_rate(enhancement_target_level)
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

func _ready() -> void:
	var tabs = _get_tabs()
	_apply_theme()
	_load_mock_data()
	_init_header_text()
	_init_tab_titles()
	_init_forge_tab()
	tabs._init_recipes_tab()
	_init_dismantle_tab()
	tabs._init_materials_tab()
	_connect_signals()
	tabs._connect_signals()
	UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

# ==============================================================================
# Mock 数据加载
# ==============================================================================

func _load_mock_data() -> void:
	var forge_recipes: Array = [
		{"name": "ui.fe12.mock.forge.mithril_sword", "rarity": "RARE", "category": "weapon", "materials": [ {"name": "ui.fe12.mock.material.mithril_ingot", "qty": 3}, {"name": "ui.fe12.mock.material.iron_ore", "qty": 2}], "enhancement_level": 0, "learned": true},
		{"name": "ui.fe12.mock.forge.leather_armor", "rarity": "COMMON", "category": "armor", "materials": [ {"name": "ui.fe12.mock.material.leather", "qty": 4}, {"name": "ui.fe12.mock.material.thread", "qty": 2}], "enhancement_level": 2, "learned": true},
		{"name": "ui.fe12.mock.forge.wind_bow", "rarity": "RARE", "category": "weapon", "materials": [ {"name": "ui.fe12.mock.material.wood", "qty": 5}, {"name": "ui.fe12.mock.material.thread", "qty": 1}], "enhancement_level": 0, "learned": false},
		{"name": "ui.fe12.mock.forge.arcane_staff", "rarity": "EPIC", "category": "weapon", "materials": [ {"name": "ui.fe12.mock.material.mana_shard", "qty": 6}, {"name": "ui.fe12.mock.material.wood", "qty": 3}], "enhancement_level": 0, "learned": true},
		{"name": "ui.fe12.mock.forge.dragon_armor", "rarity": "LEGENDARY", "category": "armor", "materials": [ {"name": "ui.fe12.mock.material.dragon_scale", "qty": 8}, {"name": "ui.fe12.mock.material.mithril_ingot", "qty": 4}], "enhancement_level": 0, "learned": false},
	]
	var recipe_catalog: Array = forge_recipes.duplicate(true)
	var dismantle_items: Array = [
		{"name": "ui.fe12.mock.dismantle.old_sword", "rarity": "COMMON", "category": "weapon", "qty": 2, "yield": [ {"name": "ui.fe12.mock.material.iron_ore", "qty": 3}]},
		{"name": "ui.fe12.mock.dismantle.old_leather", "rarity": "COMMON", "category": "armor", "qty": 1, "yield": [ {"name": "ui.fe12.mock.material.leather", "qty": 2}]},
		{"name": "ui.fe12.mock.dismantle.broken_staff", "rarity": "RARE", "category": "weapon", "qty": 1, "yield": [ {"name": "ui.fe12.mock.material.mana_shard", "qty": 2}, {"name": "ui.fe12.mock.material.wood", "qty": 2}]},
		{"name": "ui.fe12.mock.dismantle.excess_mithril", "rarity": "RARE", "category": "material", "qty": 5, "yield": [ {"name": "ui.fe12.mock.material.mana_shard", "qty": 1}]},
	]
	var materials: Array = _get_tabs().get_default_materials()
	apply_snapshot({
		"forge_recipes": forge_recipes,
		"recipe_catalog": recipe_catalog,
		"dismantle_items": dismantle_items,
		"materials": materials,
	})

func _render_from_snapshot() -> void:
	if snapshot.has("forge_recipes"):
		_forge_recipes = FrontendSnapshot.read_array(snapshot, "forge_recipes")
	if snapshot.has("recipe_catalog"):
		_recipe_catalog = FrontendSnapshot.read_array(snapshot, "recipe_catalog")
	if snapshot.has("dismantle_items"):
		_dismantle_items = FrontendSnapshot.read_array(snapshot, "dismantle_items")
	if snapshot.has("materials"):
		_materials = FrontendSnapshot.read_array(snapshot, "materials")

func _init_header_text() -> void:
	UIIntermediary.resolve(_title_label, "ui.fe12.header.title")
	UIIntermediary.resolve(_btn_back, "ui.fe12.header.back")

func _init_tab_titles() -> void:
	KTabBar.init_titles(_tab_container, PackedStringArray([
		"ui.fe12.tab.forge", "ui.fe12.tab.recipes", "ui.fe12.tab.dismantle", "ui.fe12.tab.materials",
	]))

func _connect_signals() -> void:
	_btn_back.pressed.connect(_on_back_pressed)
	_tab_container.tab_changed.connect(_on_tab_changed)
	_option_forge_category.item_selected.connect(_on_forge_category_selected)
	_line_forge_search.text_changed.connect(_on_forge_search_changed)
	_forge_recipe_list.item_selected.connect(_on_forge_recipe_selected)
	_spin_forge_quantity.value_changed.connect(_on_forge_quantity_changed)
	_btn_forge_craft.pressed.connect(_on_forge_craft_pressed)
	_option_dismantle_filter.item_selected.connect(_on_dismantle_filter_selected)
	_dismantle_item_list.item_selected.connect(_on_dismantle_item_selected)
	_spin_dismantle_quantity.value_changed.connect(_on_dismantle_quantity_changed)
	_btn_dismantle_confirm.pressed.connect(_on_dismantle_confirm_pressed)

# ==============================================================================
# Tab 1: 锻造 (FORGE)
# ==============================================================================

func _init_forge_tab() -> void:
	var forge_tab: Control = _tab_container.get_child(0)
	UIIntermediary.resolve(forge_tab.get_node("LeftPanel/SectionLabel"), "ui.fe12.forge.section_list")
	UIIntermediary.resolve(forge_tab.get_node("RightPanel/DetailSectionLabel"), "ui.fe12.forge.section_detail")
	UIIntermediary.resolve(forge_tab.get_node("RightPanel/MaterialSectionLabel"), "ui.fe12.forge.section_materials")
	UIIntermediary.resolve(forge_tab.get_node("RightPanel/QuantityRow/QtyLabel"), "ui.fe12.forge.quantity")
	UIIntermediary.resolve_placeholder(_line_forge_search, "ui.fe12.forge.search_ph")
	_option_forge_category.clear()
	_option_forge_category.add_item(UIIntermediary.text("ui.fe12.category.all"))
	for cat in _recipe_categories:
		_option_forge_category.add_item(UIIntermediary.text("ui.fe12.category." + str(cat)))
	_option_forge_category.select(0)
	_spin_forge_quantity.value = 1
	UIIntermediary.resolve(_btn_forge_craft, "ui.fe12.forge.craft_btn")
	_btn_forge_craft.disabled = true
	UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.no_recipe")
	_populate_forge_recipe_list()

func _populate_forge_recipe_list() -> void:
	_forge_recipe_list.clear()
	var keyword: String = _line_forge_search.text.strip_edges().to_lower()
	var cat_index: int = _option_forge_category.selected
	var cat_filter: String = ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for recipe in _forge_recipes:
		var name_str: String = UIIntermediary.text(str(recipe.get("name", "")))
		if not keyword.is_empty() and not name_str.to_lower().contains(keyword):
			continue
		if not cat_filter.is_empty() and str(recipe.get("category", "")) != cat_filter:
			continue
		var learned_tag := "✓" if bool(recipe.get("learned", false)) else "✗"
		UIIntermediary.resolve_item(_forge_recipe_list, "ui.fe12.forge.recipe_display", {"tag": learned_tag, "name": name_str, "rarity": str(recipe.get("rarity", ""))})
	if _tabs != null:
		_tabs.sync_recipe_virtual_list(_forge_recipes.size())
	_forge_selected_index = -1
	_btn_forge_craft.disabled = true

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

func _on_forge_category_selected(_index: int) -> void:
	_populate_forge_recipe_list()

func _on_forge_search_changed(_text: String) -> void:
	_populate_forge_recipe_list()

func _on_forge_recipe_selected(index: int) -> void:
	_forge_selected_index = index
	var filtered: Array = _get_filtered_forge_recipes()
	if index >= 0 and index < filtered.size():
		select_forge_item(filtered[index])
	else:
		selected_forge_item.clear()
		_refresh_forge_detail()

func _on_forge_quantity_changed(_value: float) -> void:
	if not selected_forge_item.is_empty():
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.ready_qty", {"level": enhancement_target_level, "count": int(_spin_forge_quantity.value)})

func _on_forge_craft_pressed() -> void:
	if selected_forge_item.is_empty() or not bool(selected_forge_item.get("learned", false)):
		return
	var qty: int = int(_spin_forge_quantity.value)
	UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.craft_success", {
		"name": UIIntermediary.text(str(selected_forge_item.get("name", ""))),
		"level": enhancement_target_level,
		"count": qty,
	})
	print("[CraftingWorkshop] 锻造: %s +%d ×%d (成功率 %.0f%%)" % [selected_forge_item.get("name", ""), enhancement_target_level, qty, predicted_success_rate * 100.0])

func _get_filtered_forge_recipes() -> Array:
	var filtered: Array = []
	var keyword: String = _line_forge_search.text.strip_edges().to_lower()
	var cat_index: int = _option_forge_category.selected
	var cat_filter: String = ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for recipe in _forge_recipes:
		var name_str: String = UIIntermediary.text(str(recipe.get("name", "")))
		if not keyword.is_empty() and not name_str.to_lower().contains(keyword):
			continue
		if not cat_filter.is_empty() and str(recipe.get("category", "")) != cat_filter:
			continue
		filtered.append(recipe)
	return filtered

# ==============================================================================
# Tab 3: 分解 (DISMANTLE)
# ==============================================================================

func _init_dismantle_tab() -> void:
	var dismantle_tab: Control = _tab_container.get_child(2)
	for item in [["LeftPanel/SectionLabel", "ui.fe12.dismantle.section_list"], ["RightPanel/DetailSectionLabel", "ui.fe12.dismantle.section_preview"], ["RightPanel/PreviewLabel", "ui.fe12.dismantle.section_output"], ["RightPanel/QuantityRow/QtyLabel", "ui.fe12.dismantle.quantity"], ["RightPanel/HistoryLabel", "ui.fe12.dismantle.section_history"]]:
		UIIntermediary.resolve(dismantle_tab.get_node(str(item[0])), str(item[1]))
	UIIntermediary.resolve(_btn_dismantle_confirm, "ui.fe12.dismantle.confirm_btn")
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

func _populate_dismantle_list() -> void:
	_dismantle_item_list.clear()
	var cat_index: int = _option_dismantle_filter.selected
	var cat_filter: String = ""
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
			var qty: int = int(mat.get("qty", 0)) * mult
			UIIntermediary.resolve_item(_dismantle_preview_list, "ui.fe12.disassemble.output", {
				"name": UIIntermediary.text(str(mat.get("name", ""))), "count": qty
			})

func _on_dismantle_filter_selected(_index: int) -> void:
	_populate_dismantle_list()

func _on_dismantle_item_selected(index: int) -> void:
	_dismantle_selected_index = index
	var filtered: Array = _get_filtered_dismantle_items()
	if index >= 0 and index < filtered.size():
		var item: Dictionary = filtered[index]
		select_salvage_item(item, item.get("yield", []))
	else:
		selected_salvage_item.clear()
		estimated_salvage_materials.clear()
		_refresh_dismantle_detail()

func _on_dismantle_quantity_changed(_value: float) -> void:
	_refresh_dismantle_detail()

func _on_dismantle_confirm_pressed() -> void:
	if selected_salvage_item.is_empty():
		print("[CraftingWorkshop] 分解：未选择物品")
		return
	var qty: int = int(_spin_dismantle_quantity.value)
	var item_name: String = UIIntermediary.text(str(selected_salvage_item.get("name", "")))
	_dismantle_history.append({"name": item_name, "qty": qty, "time": UIIntermediary.text("ui.fe12.dismantle.just_now")})
	_dismantle_history_list.clear()
	var recent: Array = _dismantle_history.duplicate()
	recent.reverse()
	for entry in recent:
		UIIntermediary.resolve_item(_dismantle_history_list, "ui.fe12.dismantle.history_item", {
			"name": str(entry.get("name", "")),
			"count": int(entry.get("qty", 0)),
			"time": str(entry.get("time", ""))
		})
	print("[CraftingWorkshop] 分解: %s ×%d" % [item_name, qty])

func _get_filtered_dismantle_items() -> Array:
	var filtered: Array = []
	var cat_index: int = _option_dismantle_filter.selected
	var cat_filter: String = ""
	if cat_index > 0:
		cat_filter = str(_recipe_categories[cat_index - 1])
	for item in _dismantle_items:
		if not cat_filter.is_empty() and str(item.get("category", "")) != cat_filter:
			continue
		filtered.append(item)
	return filtered

# ==============================================================================
# 导航与信号响应
# ==============================================================================

func _on_tab_changed(_tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换工坊分类", NavTypes.ToastLevel.INFO, 1.0)

func _on_back_pressed() -> void:
	self.back()
