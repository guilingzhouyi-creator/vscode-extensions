# ==============================================================================
# 模块归属: frontend.views.world_map
# 文件路径: res://frontend/views/world_map/world_map_view.gd
# 架构定位: 世界与地图视图主控脚本，统领大地图缩放、城镇地标、行军探索与领地寻路呈现
# 依赖与触发: 依赖 BaseScreen / WorldMapTabs / KButton / ServiceLocator / GameConfig
# 职责说明: 管理大地图和城镇分页展示与公共状态属性，并将行军主权领地与寻路委托给子控制器
# 退出语义与设计依据: 点击返回调用 back() 退出界面；地标及行军快照经统一接口注入后重绘
# ==============================================================================
## 世界地图主视图控制器，承担大地图探索、城镇详情与子分页调度
class_name WorldMapView
extends BaseScreen

const WorldMapTabsClass = preload("res://frontend/views/world_map/world_map_tabs.gd")

const KButtonClass = preload("res://frontend/components/k_button.gd")

# ==============================================================================
# 节点引用（场景树中以 unique_name_in_owner 标记）
# ==============================================================================

# --- 主 Tab 容器 ---
@onready var _main_tab_container: TabContainer = $%MainTabContainer

# --- Tab 0: WORLD_MAP 大地图探索 ---
@onready var _world_map_landmark_container: Control = $%WmapLandmarkContainer
@onready var _world_map_zoom_out_button: Button = $%WmapZoomOutBtn
@onready var _world_map_zoom_label: Label = $%WmapZoomLabel
@onready var _world_map_zoom_in_button: Button = $%WmapZoomInBtn
@onready var _world_map_coordinate_label: Label = $%WmapCoordLabel
@onready var _world_map_legend_list: ItemList = $%WmapLegendList

# --- Tab 1: TOWN_VIEW 城镇详情 ---
@onready var _town_name_label: Label = $%TownNameLabel
@onready var _town_type_label: Label = $%TownTypeLabel
@onready var _town_facility_list: ItemList = $%TownFacilityList
@onready var _town_npc_list: ItemList = $%TownNpcList
@onready var _town_facility_detail_label: Label = $%TownFacilityDetailLabel

# --- Tab 2: MARCHING 行军探索 ---
@onready var march_from_option: OptionButton = $%MarchFromOption
@onready var march_to_option: OptionButton = $%MarchToOption
@onready var march_route_preview_label: Label = $%MarchRoutePreviewLabel
@onready var march_eta_label: Label = $%MarchEtaLabel
@onready var march_terrain_label: Label = $%MarchTerrainLabel
@onready var march_start_button: Button = $%MarchStartBtn
@onready var march_stop_button: Button = $%MarchStopBtn
@onready var march_party_status_label: Label = $%MarchPartyStatusLabel

# --- Tab 3: SOVEREIGNTY 主权建国 ---
@onready var sovereignty_territory_list: ItemList = $%SovTerritoryList
@onready var sovereignty_nation_name_label: Label = $%SovNationNameLabel
@onready var sovereignty_monarch_label: Label = $%SovMonarchLabel
@onready var sovereignty_population_label: Label = $%SovPopulationLabel
@onready var sovereignty_territory_count_label: Label = $%SovTerritoryCountLabel
@onready var sovereignty_level_label: Label = $%SovLevelLabel
@onready var sovereignty_establish_button: Button = $%SovEstablishBtn

# --- Tab 4: TERRITORY 领地管理 ---
@onready var territory_list: ItemList = $%TerritoryList
@onready var territory_resource_label: Label = $%TerrResourceLabel
@onready var territory_construction_bar: ProgressBar = $%TerrConstructionBar
@onready var territory_garrison_label: Label = $%TerrGarrisonLabel
@onready var territory_upgrade_button: Button = $%TerrUpgradeBtn

# --- Tab 5: PATHFINDING 寻路规划 ---
@onready var pathfinding_start_option: OptionButton = $%PfStartOption
@onready var pathfinding_end_option: OptionButton = $%PfEndOption
@onready var pathfinding_calculate_button: Button = $%PfCalcBtn
@onready var pathfinding_route_list: ItemList = $%PfRouteList
@onready var pathfinding_route_detail_label: Label = $%PfRouteDetailLabel
@onready var pathfinding_auto_button: Button = $%PfAutoBtn

# --- 底部操作栏 ---
@onready var _back_button: Button = $%BackBtn

# --- 非唯一静态标签（i18n 迁移新增，共 22 个） ---
@onready var _title_label: Label = $%TitleLabel
@onready var _title_subtitle_label: Label = $%TitleSubLabel
@onready var _world_map_placeholder_label: Label = $%WmapPlaceholderLabel
@onready var _world_map_zoom_section_label: Label = $%WmapZoomSectionLabel
@onready var _world_map_legend_label: Label = $%WmapLegendLabel
@onready var _town_facility_section_label: Label = $%TownFacilitySectionLabel
@onready var _town_npc_section_label: Label = $%TownNpcSectionLabel
@onready var _town_detail_section_label: Label = $%TownDetailSectionLabel
@onready var march_section_label_1: Label = $%MarchSectionLabel1
@onready var march_from_label: Label = $%MarchFromLabel
@onready var march_to_label: Label = $%MarchToLabel
@onready var march_section_label_2: Label = $%MarchSectionLabel2
@onready var march_section_label_3: Label = $%MarchSectionLabel3
@onready var march_section_label_4: Label = $%MarchSectionLabel4
@onready var sovereignty_territory_section_label: Label = $%SovTerritorySectionLabel
@onready var sovereignty_nation_section_label: Label = $%SovNationSectionLabel
@onready var territory_list_section_label: Label = $%TerrListSectionLabel
@onready var territory_detail_section_label: Label = $%TerrDetailSectionLabel
@onready var territory_construction_label: Label = $%TerrConstructionLabel
@onready var pathfinding_start_label: Label = $%PfStartLabel
@onready var pathfinding_end_label: Label = $%PfEndLabel
@onready var pathfinding_routes_section_label: Label = $%PfRoutesSectionLabel

# ==============================================================================
# 地图状态与 Mock 数据快照
# ==============================================================================

var map_zoom_level: float = GameConfig.get_float("frontend.views", "fe10_world_map/default_zoom", 1.0)
const MAP_MIN_ZOOM := 0.5
const MAP_MAX_ZOOM := 3.0

var town_landmarks: Array = []
var marching_routes: Array = []
var selected_landmark_id: String = ""
var selected_town_id: String = "" # 当前选中城镇标识

# 城镇设施、NPC、领地与主权数据（经 ServiceLocator 领域边界服务按需加载）
var _mock_town_facilities: Array = []
var _mock_town_npcs: Array = []
var _mock_territories: Array = []
var _mock_sovereignty: Dictionary = {}

# 行军队伍状态（本地交互模拟）
var marching_active: bool = false

# 地标名称仅由快照 name / name_key 动态提供，视图层零硬编码地标映射表

# ==============================================================================
# 外部交互与快照入口
# ==============================================================================

## 调整当前大地图缩放倍率并限制在合法范围
func adjust_zoom(delta: float) -> void:
	map_zoom_level = clampf(map_zoom_level + delta, MAP_MIN_ZOOM, MAP_MAX_ZOOM)

## 选中指定城镇并记录目标标识
func select_town(town_id: String) -> Dictionary:
	selected_town_id = town_id
	return {"success": true, "town_id": town_id}

## 注入行军路线列表快照并触发视图刷新
func set_marching_route_snapshot(routes: Array) -> void:
	apply_snapshot({"marching_routes": routes})

## 统一快照渲染映射：行军路线与拓扑快照 → 视图状态并刷新控件
func _render_from_snapshot() -> void:
	if snapshot.has("marching_routes"):
		marching_routes = FrontendSnapshot.read_array(snapshot, "marching_routes")
	if snapshot.has("landmarks"):
		town_landmarks = FrontendSnapshot.read_array(snapshot, "landmarks")
	if snapshot.has("territories"):
		_mock_territories = FrontendSnapshot.read_array(snapshot, "territories")
	if snapshot.has("sovereignty") and snapshot.get("sovereignty") is Dictionary:
		_mock_sovereignty = (snapshot.get("sovereignty") as Dictionary).duplicate(true)
	if is_inside_tree() and _tabs != null:
		_tabs.refresh_march_preview()
		_tabs.refresh_sovereignty_info()

## 生命周期初始化：主题/快照/六 Tab 标题与文案/各子界面装配/信号绑定（本地交互初始化）
var _tabs: Variant = null

func _get_tabs():
	if _tabs == null:
		_tabs = _register_owned_subcontroller(WorldMapTabsClass.new())
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	# 1. 应用主题（直接读取 ThemeManager 单例主题）
	var theme_manager := ThemeManager.get_instance()
	theme = theme_manager.theme

	# 2. 加载快照数据
	_load_mock_snapshot()

	# 3. 设置 Tab 标题
	_setup_tab_titles()

	# 4. 初始化静态文案
	_init_static_text()

	# 5. 初始化各子界面
	_init_world_map_tab()
	_init_town_view_tab()
	_init_marching_tab()
	_init_sovereignty_tab()
	_init_territory_tab()
	_init_pathfinding_tab()

	# 6. 绑定信号（本地 UI 交互绑定）
	_connect_signals()

	# 7. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

# ==============================================================================
# Mock 数据加载
# ==============================================================================

## 从 domain_boundary 快照服务加载世界地图域快照（地标 i18n 键替换/行军路线）
func _load_mock_snapshot() -> void:
	var world_map := ServiceLocator.get_instance().snapshot_data().load_snapshot("world_map")
	if world_map.is_empty():
		return
	if world_map.has("landmarks"):
		town_landmarks = FrontendSnapshot.read_array(world_map, "landmarks")
		# 保留快照传入的 i18n name_key 或直接透传地标展示名
		for landmark_entry in town_landmarks:
			var landmark_id: String = str(landmark_entry.get("id", ""))
			var name_key: String = str(landmark_entry.get("name_key", ""))
			if not name_key.is_empty():
				landmark_entry["name"] = name_key
			elif str(landmark_entry.get("name", "")).is_empty():
				landmark_entry["name"] = landmark_id
	if world_map.has("marching_routes"):
		marching_routes = FrontendSnapshot.read_array(world_map, "marching_routes")
	if world_map.has("town_facilities"):
		_mock_town_facilities = FrontendSnapshot.read_array(world_map, "town_facilities")
	if world_map.has("town_npcs"):
		_mock_town_npcs = FrontendSnapshot.read_array(world_map, "town_npcs")
	if world_map.has("territories"):
		_mock_territories = FrontendSnapshot.read_array(world_map, "territories")
	if world_map.has("sovereignty"):
		_mock_sovereignty = (world_map.get("sovereignty", {}) as Dictionary).duplicate(true)

# ==============================================================================
# Tab 标题设置
# ==============================================================================

## 设置六主 Tab 标题（i18n 键驱动）
func _setup_tab_titles() -> void:
	var tab_keys := [
		"ui.fe10.tab.world_map",
		"ui.fe10.tab.town_view",
		"ui.fe10.tab.marching",
		"ui.fe10.tab.sovereignty",
		"ui.fe10.tab.territory",
		"ui.fe10.tab.pathfinding",
	]
	for tab_index in tab_keys.size():
		UIIntermediary.resolve_tab(_main_tab_container, tab_index, tab_keys[tab_index])

# ==============================================================================
# 静态文案初始化（非动态数据节点，i18n 绑定）
# ==============================================================================

## 初始化全部静态文案（22 个非唯一标签 + 各 Tab 按钮，i18n 全驱动）
func _init_static_text() -> void:
	# 顶部标题栏
	UIIntermediary.resolve(_title_label, "ui.fe10.header.title")
	UIIntermediary.resolve(_title_subtitle_label, "ui.fe10.header.title_sub")
	UIIntermediary.resolve(_back_button, "ui.fe10.header.back")

	# Tab 0: 大地图
	UIIntermediary.resolve(_world_map_placeholder_label, "ui.fe10.wmap.placeholder")
	UIIntermediary.resolve(_world_map_zoom_section_label, "ui.fe10.wmap.zoom_section")
	UIIntermediary.resolve(_world_map_legend_label, "ui.fe10.wmap.legend")

	# Tab 1: 城镇
	UIIntermediary.resolve(_town_facility_section_label, "ui.fe10.town.facility_section")
	UIIntermediary.resolve(_town_npc_section_label, "ui.fe10.town.npc_section")
	UIIntermediary.resolve(_town_detail_section_label, "ui.fe10.town.detail_section")

	_get_tabs().init_static_text()

# ==============================================================================
# Tab 0: 大地图探索 - 初始化
# ==============================================================================

## 初始化大地图 Tab：动态生成地标按钮 + 图例列表 + 初始缩放/坐标
func _init_world_map_tab() -> void:
	# 动态生成地标按钮
	_spawn_landmark_buttons()
	# 填充图例列表
	_world_map_legend_list.clear()
	for landmark_entry in town_landmarks:
		var landmark_name := UIIntermediary.text(landmark_entry.get("name", ""))
		var landmark_type_name := UIIntermediary.text(_landmark_type_key(landmark_entry.get("type", "")))
		UIIntermediary.resolve_item(_world_map_legend_list, "ui.fe10.wmap.legend_item", {"name": landmark_name, "type": landmark_type_name})
	# 初始缩放与坐标显示
	_refresh_wmap_zoom()
	_refresh_wmap_coord()

## 刷新地标按钮：按快照坐标复用节点池定位，点击回调切城镇详情
func _spawn_landmark_buttons() -> void:
	for landmark_index in range(town_landmarks.size()):
		var landmark_entry: Dictionary = town_landmarks[landmark_index]
		var landmark_button: Button = _acquire_landmark_button(landmark_index)
		landmark_button.visible = true
		landmark_button.name = "Landmark_%s" % landmark_entry.get("id", "")
		landmark_button.text = UIIntermediary.text(landmark_entry.get("name", ""))
		landmark_button.position = Vector2(landmark_entry.get("x", 0) - 60, landmark_entry.get("y", 0) - 16)
		landmark_button.set_meta("landmark_id", str(landmark_entry.get("id", "")))
	for child_index in range(town_landmarks.size(), _world_map_landmark_container.get_child_count()):
		_world_map_landmark_container.get_child(child_index).visible = false

## 获取或创建地标按钮（循环外分配，按元数据动态分派）
func _acquire_landmark_button(button_index: int) -> Button:
	if button_index < _world_map_landmark_container.get_child_count():
		return _world_map_landmark_container.get_child(button_index) as Button
	var landmark_button := KButtonClass.new()
	landmark_button.variant = KButtonClass.StyleVariant.SECONDARY
	landmark_button.size = Vector2(120, 32)
	connect_managed(landmark_button.pressed, func():
		var landmark_id: String = str(landmark_button.get_meta("landmark_id", ""))
		if not landmark_id.is_empty():
			_on_landmark_pressed(landmark_id)
	)
	_world_map_landmark_container.add_child(landmark_button)
	return landmark_button

func _landmark_type_key(type_code: String) -> String:
	var type_key_map := {"CAPITAL": "ui.fe10.landmark.type.capital", "TOWN": "ui.fe10.landmark.type.town", "FORTRESS": "ui.fe10.landmark.type.fortress", "DUNGEON": "ui.fe10.landmark.type.dungeon"}
	return type_key_map.get(type_code, type_code)

## 刷新缩放百分比标签
func _refresh_wmap_zoom() -> void:
	if _world_map_zoom_label:
		UIIntermediary.resolve(_world_map_zoom_label, "ui.fe10.wmap.zoom", {"percent": int(map_zoom_level * 100)})

## 刷新坐标标签：未选中地标显示默认文案，选中则按地标坐标渲染
func _refresh_wmap_coord() -> void:
	if _world_map_coordinate_label:
		if selected_landmark_id.is_empty():
			UIIntermediary.resolve(_world_map_coordinate_label, "ui.fe10.wmap.coord_default")
		else:
			for landmark_entry in town_landmarks:
				if landmark_entry.get("id", "") == selected_landmark_id:
					UIIntermediary.resolve(_world_map_coordinate_label, "ui.fe10.wmap.coord", {"x": landmark_entry.get("x", 0), "y": landmark_entry.get("y", 0)})
					break

# ==============================================================================
# Tab 1: 城镇详情 - 初始化
# ==============================================================================

## 初始化城镇详情 Tab：填充设施/NPC 列表并默认展示首个地标
func _init_town_view_tab() -> void:
	# 填充设施列表
	_town_facility_list.clear()
	for facility_entry in _mock_town_facilities:
		_town_facility_list.add_item(UIIntermediary.text(facility_entry.get("name", "")))
	# 填充 NPC 列表
	_town_npc_list.clear()
	for resident_entry in _mock_town_npcs:
		_town_npc_list.add_item(UIIntermediary.text(resident_entry.get("name", "")))
	# 默认选中第一个地标
	if town_landmarks.size() > 0:
		_show_town(town_landmarks[0])

## 展示城镇详情：名称/类型/设施详情初始展示
func _show_town(landmark_entry: Dictionary) -> void:
	if _town_name_label:
		_town_name_label.text = UIIntermediary.text(landmark_entry.get("name", "ui.fe10.town.name_default"))
	if _town_type_label:
		var type_name := UIIntermediary.text(_landmark_type_key(landmark_entry.get("type", "")))
		UIIntermediary.resolve(_town_type_label, "ui.fe10.town.type_label", {"type": type_name})
	if _town_facility_detail_label:
		UIIntermediary.resolve(_town_facility_detail_label, "ui.fe10.town.detail_placeholder")

# ==============================================================================
# Tab 2~5 委托给 WorldMapTabs
# ==============================================================================

func _init_marching_tab() -> void: _get_tabs().init_marching_tab()
func _refresh_march_preview() -> void: _get_tabs().refresh_march_preview()
func _terrain_key(terrain_code: String) -> String: return _get_tabs()._terrain_key(terrain_code)
func _refresh_march_party_status() -> void: _get_tabs().refresh_march_party_status()
func _init_sovereignty_tab() -> void: _get_tabs().init_sovereignty_tab()
func _refresh_sovereignty_info() -> void: _get_tabs().refresh_sovereignty_info()
func _init_territory_tab() -> void: _get_tabs().init_territory_tab()
func _show_territory_detail(territory_entry: Dictionary) -> void: _get_tabs().show_territory_detail(territory_entry)
func _init_pathfinding_tab() -> void: _get_tabs().init_pathfinding_tab()

# ==============================================================================
# 信号绑定（本地 UI 交互绑定）
# ==============================================================================

## 绑定本地 UI 交互信号（六标签页控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	connect_managed(_back_button.pressed, _on_back_pressed)

	# 大地图缩放
	connect_managed(_world_map_zoom_in_button.pressed, _on_wmap_zoom_in)
	connect_managed(_world_map_zoom_out_button.pressed, _on_wmap_zoom_out)
	# 图例点击切换地标
	connect_managed(_world_map_legend_list.item_selected, _on_legend_selected)

	# 城镇设施 / NPC 选择
	connect_managed(_town_facility_list.item_selected, _on_town_facility_selected)
	connect_managed(_town_npc_list.item_selected, _on_town_npc_selected)

	_get_tabs().connect_signals()

# ==============================================================================
# 返回按钮
# ==============================================================================

func _on_back_pressed() -> void: self.back()

# ==============================================================================
# 大地图交互
# ==============================================================================

## 地标点击：记录选中、刷新坐标、展示城镇详情并切到城镇 Tab
func _on_landmark_pressed(landmark_id: String) -> void:
	selected_landmark_id = landmark_id
	_refresh_wmap_coord()
	# 查找对应地标并切换到城镇 Tab
	for landmark_entry in town_landmarks:
		if landmark_entry.get("id", "") == landmark_id:
			_show_town(landmark_entry)
			_main_tab_container.current_tab = 1
			break

## 图例条目选中：委托地标点击逻辑
func _on_legend_selected(legend_index: int) -> void:
	if legend_index >= 0 and legend_index < town_landmarks.size():
		_on_landmark_pressed(town_landmarks[legend_index].get("id", ""))

func _on_wmap_zoom_in() -> void: map_zoom_level = minf(map_zoom_level + 0.25, MAP_MAX_ZOOM); _refresh_wmap_zoom()
func _on_wmap_zoom_out() -> void: map_zoom_level = maxf(map_zoom_level - 0.25, MAP_MIN_ZOOM); _refresh_wmap_zoom()

# ==============================================================================
# 城镇交互
# ==============================================================================

## 设施条目选中：渲染设施名称与描述详情
func _on_town_facility_selected(facility_index: int) -> void:
	if facility_index >= 0 and facility_index < _mock_town_facilities.size():
		var facility_entry: Dictionary = _mock_town_facilities[facility_index]
		if _town_facility_detail_label:
			var facility_name := UIIntermediary.text(facility_entry.get("name", ""))
			var facility_description := UIIntermediary.text(facility_entry.get("desc", ""))
			UIIntermediary.resolve(_town_facility_detail_label, "ui.fe10.town.facility_detail", {"name": facility_name, "desc": facility_description})

## NPC 条目选中：渲染 NPC 名称与描述详情
func _on_town_npc_selected(resident_index: int) -> void:
	if resident_index >= 0 and resident_index < _mock_town_npcs.size():
		var resident_entry: Dictionary = _mock_town_npcs[resident_index]
		if _town_facility_detail_label:
			var resident_name := UIIntermediary.text(resident_entry.get("name", ""))
			var resident_description := UIIntermediary.text(resident_entry.get("desc", ""))
			UIIntermediary.resolve(_town_facility_detail_label, "ui.fe10.town.npc_detail", {"name": resident_name, "desc": resident_description})

# ==============================================================================
# Tab 2~5 回调委托
# ==============================================================================

func _on_march_option_changed(option_index: int) -> void: _get_tabs()._on_march_option_changed(option_index)
func _on_march_start() -> void: _get_tabs()._on_march_start()
func _on_march_stop() -> void: _get_tabs()._on_march_stop()
func _on_sov_establish() -> void: _get_tabs()._on_sov_establish()
func _on_territory_selected(territory_index: int) -> void: _get_tabs()._on_territory_selected(territory_index)
func _on_terr_upgrade() -> void: _get_tabs()._on_terr_upgrade()
func _on_pf_calc() -> void: _get_tabs()._on_pf_calc()
func _on_pf_route_selected(route_index: int) -> void: _get_tabs()._on_pf_route_selected(route_index)
func _on_pf_auto() -> void: _get_tabs()._on_pf_auto()
