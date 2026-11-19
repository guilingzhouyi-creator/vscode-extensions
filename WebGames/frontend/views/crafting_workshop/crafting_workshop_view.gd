# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第12卷 制造与工坊系统视图控制器)
# 文件路径: res://frontend/views/crafting_workshop/crafting_workshop_view.gd
# 架构定位: Presentation View Controller / Snapshot-Driven Screen
# 依赖与触发: 上游: NavManager, ServiceLocator, FrontendSnapshot
#           下游: CraftingWorkshopTabs, UIIntermediary, KTabBar, ThemeManager
# 职责说明: 锻造强化预览、配方图鉴习得检索、装备分解返还清单与材料仓库浏览；
#           其中配方图鉴与材料仓库子面板交互委托 CraftingWorkshopTabs 驱动。
# 退出语义与设计依据: 表现层快照单向绑定与网格对象池零堆分配规约 (ADV-PRF-002)
# ==============================================================================
## CraftingWorkshopView：第12卷制造与工坊四页签视图控制器
class_name CraftingWorkshopView
extends BaseScreen

const KButtonClass = preload("res://frontend/components/k_button.gd")
const CraftingWorkshopTabsClass = preload("res://frontend/views/crafting_workshop/crafting_workshop_tabs.gd")

const CATEGORY_WEAPON: String = "weapon"
const CATEGORY_ARMOR: String = "armor"
const CATEGORY_MATERIAL: String = "material"
const RARITY_COMMON: String = "COMMON"
const RARITY_RARE: String = "RARE"

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
var recipe_current_category: int = 0
var recipe_selected_index: int = -1

# 分解快照
var selected_salvage_item: Dictionary = {}
var estimated_salvage_materials: Array = []
var _dismantle_items: Array = []
var _dismantle_selected_index: int = -1
var _dismantle_history: Array = []

# 材料仓库快照
var material_categories: Array = ["ore", "herb", "leather", "wood", "crystal", "misc"]
var _materials: Array = []
var material_current_category: int = 0
var material_selected_index: int = -1

# 子面板委托控制器
var _tabs: Variant = null

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 全局 ---
@onready var _tab_container: TabContainer = %TabContainer
@onready var _back_button: Button = %BtnBack
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
@onready var _forge_craft_button: Button = %BtnForgeCraft

# --- Tab 2: 配方图鉴 (RECIPES) ---
@onready var label_recipe_progress: Label = %LabelRecipeProgress
@onready var recipe_tab_bar: TabBar = %RecipeTabBar
@onready var recipe_grid: GridContainer = %RecipeGrid
@onready var label_recipe_name: Label = %LabelRecipeName
@onready var label_recipe_rarity: Label = %LabelRecipeRarity
@onready var label_recipe_status: Label = %LabelRecipeStatus
@onready var label_recipe_unlock_condition: Label = %LabelRecipeUnlockCondition
@onready var recipe_material_list: ItemList = %RecipeMaterialList

# --- Tab 3: 分解 (DISMANTLE) ---
@onready var _option_dismantle_filter: OptionButton = %OptionDismantleFilter
@onready var _dismantle_item_list: ItemList = %DismantleItemList
@onready var _label_dismantle_item_name: Label = %LabelDismantleItemName
@onready var _dismantle_preview_list: ItemList = %DismantlePreviewList
@onready var _spin_dismantle_quantity: SpinBox = %SpinDismantleQuantity
@onready var _dismantle_confirm_button: Button = %BtnDismantleConfirm
@onready var _dismantle_history_list: ItemList = %DismantleHistoryList

# --- Tab 4: 材料仓库 (MATERIALS) ---
@onready var material_category_box: HBoxContainer = %MaterialCategoryHBox
@onready var material_grid: GridContainer = %MaterialGrid
@onready var label_material_name: Label = %LabelMaterialName
@onready var label_material_rarity: Label = %LabelMaterialRarity
@onready var label_material_quantity: Label = %LabelMaterialQuantity
@onready var label_material_description: Label = %LabelMaterialDescription
@onready var label_material_source: Label = %LabelMaterialSource

# ==============================================================================
# 子面板委托与初始化
# ==============================================================================

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(CraftingWorkshopTabsClass.new())
		_tabs.setup(self)
	return _tabs

# ==============================================================================
# 公开交互方法（供上层与测试调用）
# ==============================================================================

## 选中锻造配方并预测强化成功率
func select_forge_item(item_payload: Dictionary) -> void:
	selected_forge_item = item_payload.duplicate()
	enhancement_target_level = int(item_payload.get("enhancement_level", 0)) + 1
	var rate_preview: Dictionary = ServiceLocator.get_instance().crafting().preview_enhance_rate(enhancement_target_level)
	if bool(rate_preview.get("success", false)):
		predicted_success_rate = float(rate_preview.get("rate", predicted_success_rate))
	_refresh_forge_detail()

## 选中分解物品并注入预计产出材料清单
func select_salvage_item(item_payload: Dictionary, expected_yield: Array) -> void:
	selected_salvage_item = item_payload.duplicate()
	estimated_salvage_materials = expected_yield.duplicate()
	_refresh_dismantle_detail()

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	var tabs: Variant = _get_tabs()
	_apply_theme()
	_load_domain_snapshot()
	_init_header_text()
	_init_tab_titles()
	_init_forge_tab()
	tabs._init_recipes_tab()
	_init_dismantle_tab()
	tabs._init_materials_tab()
	_connect_signals()
	tabs._connect_signals()
	UIIntermediary.adapt_view(self)

func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

# ==============================================================================
# 领域快照加载
# ==============================================================================

func _load_domain_snapshot() -> void:
	var crafting_snapshot: Dictionary = ServiceLocator.get_instance().snapshot_data().load_snapshot("crafting")
	if not crafting_snapshot.is_empty():
		apply_snapshot(crafting_snapshot)

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
	UIIntermediary.resolve(_back_button, "ui.fe12.header.back")

func _init_tab_titles() -> void:
	KTabBar.init_titles(_tab_container, PackedStringArray([
		"ui.fe12.tab.forge", "ui.fe12.tab.recipes", "ui.fe12.tab.dismantle", "ui.fe12.tab.materials",
	]))

func _connect_signals() -> void:
	connect_managed(_back_button.pressed, _on_back_pressed)
	connect_managed(_tab_container.tab_changed, _on_tab_changed)
	connect_managed(_option_forge_category.item_selected, _on_forge_category_selected)
	connect_managed(_line_forge_search.text_changed, _on_forge_search_changed)
	connect_managed(_forge_recipe_list.item_selected, _on_forge_recipe_selected)
	connect_managed(_spin_forge_quantity.value_changed, _on_forge_quantity_changed)
	connect_managed(_forge_craft_button.pressed, _on_forge_craft_pressed)
	connect_managed(_option_dismantle_filter.item_selected, _on_dismantle_filter_selected)
	connect_managed(_dismantle_item_list.item_selected, _on_dismantle_item_selected)
	connect_managed(_spin_dismantle_quantity.value_changed, _on_dismantle_quantity_changed)
	connect_managed(_dismantle_confirm_button.pressed, _on_dismantle_confirm_pressed)

# ==============================================================================
# Tab 1: 锻造 (FORGE)
# ==============================================================================

func _populate_category_option(option_button: OptionButton) -> void:
	option_button.clear()
	option_button.add_item(UIIntermediary.text("ui.fe12.category.all"))
	for category_key in _recipe_categories:
		option_button.add_item(UIIntermediary.text("ui.fe12.category." + str(category_key)))
	option_button.select(0)

func _init_forge_tab() -> void:
	var forge_tab: Control = _tab_container.get_child(0)
	UIIntermediary.resolve(forge_tab.get_node("LeftPanel/SectionLabel"), "ui.fe12.forge.section_list")
	UIIntermediary.resolve(forge_tab.get_node("RightPanel/DetailSectionLabel"), "ui.fe12.forge.section_detail")
	UIIntermediary.resolve(forge_tab.get_node("RightPanel/MaterialSectionLabel"), "ui.fe12.forge.section_materials")
	UIIntermediary.resolve(forge_tab.get_node("RightPanel/QuantityRow/QtyLabel"), "ui.fe12.forge.quantity")
	UIIntermediary.resolve_placeholder(_line_forge_search, "ui.fe12.forge.search_ph")
	_populate_category_option(_option_forge_category)
	_spin_forge_quantity.value = 1
	UIIntermediary.resolve(_forge_craft_button, "ui.fe12.forge.craft_btn")
	_forge_craft_button.disabled = true
	UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.no_recipe")
	_populate_forge_recipe_list()

func _populate_forge_recipe_list() -> void:
	_forge_recipe_list.clear()
	for recipe in _get_filtered_forge_recipes():
		var recipe_name: String = UIIntermediary.text(str(recipe.get("name", "")))
		var learned_tag := "✓" if bool(recipe.get("learned", false)) else "✗"
		UIIntermediary.resolve_item(_forge_recipe_list, "ui.fe12.forge.recipe_display", {"tag": learned_tag, "name": recipe_name, "rarity": str(recipe.get("rarity", ""))})
	if _tabs != null:
		_tabs.sync_recipe_virtual_list(_forge_recipes.size())
	_forge_selected_index = -1
	_forge_craft_button.disabled = true

func _refresh_forge_detail() -> void:
	if selected_forge_item.is_empty():
		UIIntermediary.resolve(_label_forge_item_name, "ui.fe12.forge.select_prompt")
		UIIntermediary.resolve(_label_forge_rarity, "ui.fe12.forge.rarity_none")
		UIIntermediary.resolve(_label_forge_success_rate, "ui.fe12.forge.success_none")
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.no_recipe")
		_forge_craft_button.disabled = true
		return
	UIIntermediary.resolve(_label_forge_item_name, str(selected_forge_item.get("name", "")))
	UIIntermediary.resolve(_label_forge_rarity, "ui.fe12.forge.rarity", {"rarity": str(selected_forge_item.get("rarity", "--"))})
	UIIntermediary.resolve(_label_forge_success_rate, "ui.fe12.forge.success", {"percent": int(predicted_success_rate * 100.0), "level": enhancement_target_level})
	if _forge_material_list:
		_forge_material_list.clear()
		var materials: Array = selected_forge_item.get("materials", [])
		for material_entry in materials:
			UIIntermediary.resolve_item(_forge_material_list, "ui.fe12.forge.material", {
				"name": UIIntermediary.text(str(material_entry.get("name", ""))), "count": int(material_entry.get("qty", 0))
			})
	if _forge_craft_button:
		_forge_craft_button.disabled = not bool(selected_forge_item.get("learned", false))
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

func _on_forge_quantity_changed(_quantity_value: float) -> void:
	if not selected_forge_item.is_empty():
		UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.ready_qty", {"level": enhancement_target_level, "count": int(_spin_forge_quantity.value)})

func _on_forge_craft_pressed() -> void:
	if selected_forge_item.is_empty() or not bool(selected_forge_item.get("learned", false)):
		return
	var craft_quantity: int = int(_spin_forge_quantity.value)
	var craft_reply := ServiceLocator.get_instance().crafting().dispatch_crafting_action("CRAFT_RECIPE", {
		"recipe_id": str(selected_forge_item.get("id", "")),
		"target_level": enhancement_target_level,
		"quantity": craft_quantity,
	})
	if not bool(craft_reply.get("success", true)):
		NavManager.get_instance().show_toast(str(craft_reply.get("message", "ui.fe12.forge.craft_success")), NavTypes.ToastLevel.WARNING)
		return
	var crafted_text: String = UIIntermediary.resolve(_label_forge_result, "ui.fe12.forge.craft_success", {
		"name": UIIntermediary.text(str(selected_forge_item.get("name", ""))),
		"level": enhancement_target_level,
		"count": craft_quantity,
	})
	NavManager.get_instance().show_toast(crafted_text, NavTypes.ToastLevel.SUCCESS)

func _get_filtered_forge_recipes() -> Array:
	var filtered: Array = []
	var keyword: String = _line_forge_search.text.strip_edges().to_lower()
	var category_index: int = _option_forge_category.selected
	var category_filter: String = ""
	if category_index > 0:
		category_filter = str(_recipe_categories[category_index - 1])
	for recipe in _forge_recipes:
		var recipe_name: String = UIIntermediary.text(str(recipe.get("name", "")))
		if not keyword.is_empty() and not recipe_name.to_lower().contains(keyword):
			continue
		if not category_filter.is_empty() and str(recipe.get("category", "")) != category_filter:
			continue
		filtered.append(recipe)
	return filtered

# ==============================================================================
# Tab 3: 分解 (DISMANTLE)
# ==============================================================================

func _init_dismantle_tab() -> void:
	var dismantle_tab: Control = _tab_container.get_child(2)
	for label_binding in [["LeftPanel/SectionLabel", "ui.fe12.dismantle.section_list"], ["RightPanel/DetailSectionLabel", "ui.fe12.dismantle.section_preview"], ["RightPanel/PreviewLabel", "ui.fe12.dismantle.section_output"], ["RightPanel/QuantityRow/QtyLabel", "ui.fe12.dismantle.quantity"], ["RightPanel/HistoryLabel", "ui.fe12.dismantle.section_history"]]:
		UIIntermediary.resolve(dismantle_tab.get_node(str(label_binding[0])), str(label_binding[1]))
	UIIntermediary.resolve(_dismantle_confirm_button, "ui.fe12.dismantle.confirm_btn")
	_populate_category_option(_option_dismantle_filter)
	_spin_dismantle_quantity.value = 1
	_populate_dismantle_list()
	_dismantle_history_list.clear()
	UIIntermediary.resolve(_label_dismantle_item_name, "ui.fe12.dismantle.select_prompt")
	_dismantle_preview_list.clear()

func _populate_dismantle_list() -> void:
	_dismantle_item_list.clear()
	for dismantle_entry in _get_filtered_dismantle_items():
		UIIntermediary.resolve_item(_dismantle_item_list, "ui.fe12.dismantle.item_display", {
			"name": UIIntermediary.text(str(dismantle_entry.get("name", ""))),
			"rarity": str(dismantle_entry.get("rarity", "")),
			"count": int(dismantle_entry.get("qty", 0))
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
		var quantity_multiplier: int = int(_spin_dismantle_quantity.value) if _spin_dismantle_quantity else 1
		for material_entry in estimated_salvage_materials:
			var output_quantity: int = int(material_entry.get("qty", 0)) * quantity_multiplier
			UIIntermediary.resolve_item(_dismantle_preview_list, "ui.fe12.disassemble.output", {
				"name": UIIntermediary.text(str(material_entry.get("name", ""))), "count": output_quantity
			})

func _on_dismantle_filter_selected(_index: int) -> void:
	_populate_dismantle_list()

func _on_dismantle_item_selected(index: int) -> void:
	_dismantle_selected_index = index
	var filtered: Array = _get_filtered_dismantle_items()
	if index >= 0 and index < filtered.size():
		var selected_entry: Dictionary = filtered[index]
		select_salvage_item(selected_entry, selected_entry.get("yield", []))
	else:
		selected_salvage_item.clear()
		estimated_salvage_materials.clear()
		_refresh_dismantle_detail()

func _on_dismantle_quantity_changed(_quantity_value: float) -> void:
	_refresh_dismantle_detail()

func _on_dismantle_confirm_pressed() -> void:
	if selected_salvage_item.is_empty():
		NavManager.get_instance().show_toast(
			UIIntermediary.text("ui.fe12.dismantle.select_prompt"),
			NavTypes.ToastLevel.WARNING
		)
		return
	var dismantle_quantity: int = int(_spin_dismantle_quantity.value)
	ServiceLocator.get_instance().crafting().dispatch_crafting_action("DISMANTLE_ITEM", {
		"item_id": str(selected_salvage_item.get("item_id", "")),
		"quantity": dismantle_quantity,
		"refund_gold": dismantle_quantity * 25,
	})
	var item_name: String = UIIntermediary.text(str(selected_salvage_item.get("name", "")))
	_dismantle_history.append({"name": item_name, "qty": dismantle_quantity, "time": UIIntermediary.text("ui.fe12.dismantle.just_now")})
	_dismantle_history_list.clear()
	var recent: Array = _dismantle_history.duplicate()
	recent.reverse()
	for entry in recent:
		UIIntermediary.resolve_item(_dismantle_history_list, "ui.fe12.dismantle.history_item", {
			"name": str(entry.get("name", "")),
			"count": int(entry.get("qty", 0)),
			"time": str(entry.get("time", ""))
		})
	NavManager.get_instance().show_toast(
		UIIntermediary.text("ui.fe12.dismantle.success_toast", {"name": item_name, "count": dismantle_quantity}),
		NavTypes.ToastLevel.SUCCESS
	)

func _get_filtered_dismantle_items() -> Array:
	var filtered: Array = []
	var category_index: int = _option_dismantle_filter.selected
	var category_filter: String = ""
	if category_index > 0:
		category_filter = str(_recipe_categories[category_index - 1])
	for dismantle_entry in _dismantle_items:
		if not category_filter.is_empty() and str(dismantle_entry.get("category", "")) != category_filter:
			continue
		filtered.append(dismantle_entry)
	return filtered

# ==============================================================================
# 导航与信号响应
# ==============================================================================

func _on_tab_changed(tab_index: int) -> void:
	if tab_index == 0:
		_refresh_forge_detail()
	elif tab_index == 3:
		_refresh_dismantle_detail()

func _on_back_pressed() -> void:
	self.back()
