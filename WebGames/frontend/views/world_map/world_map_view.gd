# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第10卷: 世界与地图系统视图控制器
# 文件路径: res://frontend/views/world_map/world_map_view.gd
# 职责: 七大洲宏观地图缩放、城镇地标锚点、行军探索路线与主权势力范围呈现；
#       6 个子界面 Tab：大地图/城镇/行军/主权/领地/寻路。
# 骨架阶段: 零接线、不接 EventBus，仅本地 Mock 数据驱动 + 按钮点击反馈。
# ==============================================================================
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
@onready var _wmap_panel: PanelContainer = $%WmapPanel
@onready var _wmap_landmark_container: Control = $%WmapLandmarkContainer
@onready var _wmap_zoom_out_btn: Button = $%WmapZoomOutBtn
@onready var _wmap_zoom_label: Label = $%WmapZoomLabel
@onready var _wmap_zoom_in_btn: Button = $%WmapZoomInBtn
@onready var _wmap_coord_label: Label = $%WmapCoordLabel
@onready var _wmap_legend_list: ItemList = $%WmapLegendList

# --- Tab 1: TOWN_VIEW 城镇详情 ---
@onready var _town_name_label: Label = $%TownNameLabel
@onready var _town_type_label: Label = $%TownTypeLabel
@onready var _town_facility_list: ItemList = $%TownFacilityList
@onready var _town_npc_list: ItemList = $%TownNpcList
@onready var _town_facility_detail_label: Label = $%TownFacilityDetailLabel

# --- Tab 2: MARCHING 行军探索 ---
@onready var _march_from_option: OptionButton = $%MarchFromOption
@onready var _march_to_option: OptionButton = $%MarchToOption
@onready var _march_route_preview_label: Label = $%MarchRoutePreviewLabel
@onready var _march_eta_label: Label = $%MarchEtaLabel
@onready var _march_terrain_label: Label = $%MarchTerrainLabel
@onready var _march_start_btn: Button = $%MarchStartBtn
@onready var _march_stop_btn: Button = $%MarchStopBtn
@onready var _march_party_status_label: Label = $%MarchPartyStatusLabel

# --- Tab 3: SOVEREIGNTY 主权建国 ---
@onready var _sov_territory_list: ItemList = $%SovTerritoryList
@onready var _sov_nation_name_label: Label = $%SovNationNameLabel
@onready var _sov_monarch_label: Label = $%SovMonarchLabel
@onready var _sov_population_label: Label = $%SovPopulationLabel
@onready var _sov_territory_count_label: Label = $%SovTerritoryCountLabel
@onready var _sov_level_label: Label = $%SovLevelLabel
@onready var _sov_establish_btn: Button = $%SovEstablishBtn

# --- Tab 4: TERRITORY 领地管理 ---
@onready var _territory_list: ItemList = $%TerritoryList
@onready var _terr_resource_label: Label = $%TerrResourceLabel
@onready var _terr_construction_bar: ProgressBar = $%TerrConstructionBar
@onready var _terr_garrison_label: Label = $%TerrGarrisonLabel
@onready var _terr_upgrade_btn: Button = $%TerrUpgradeBtn

# --- Tab 5: PATHFINDING 寻路规划 ---
@onready var _pf_start_option: OptionButton = $%PfStartOption
@onready var _pf_end_option: OptionButton = $%PfEndOption
@onready var _pf_calc_btn: Button = $%PfCalcBtn
@onready var _pf_route_list: ItemList = $%PfRouteList
@onready var _pf_route_detail_label: Label = $%PfRouteDetailLabel
@onready var _pf_auto_btn: Button = $%PfAutoBtn

# --- 底部操作栏 ---
@onready var _back_btn: Button = $%BackBtn

# --- 非唯一静态标签（i18n 迁移新增，共 22 个） ---
@onready var _title_label: Label = $%TitleLabel
@onready var _title_sub_label: Label = $%TitleSubLabel
@onready var _wmap_placeholder_label: Label = $%WmapPlaceholderLabel
@onready var _wmap_zoom_section_label: Label = $%WmapZoomSectionLabel
@onready var _wmap_legend_label: Label = $%WmapLegendLabel
@onready var _town_facility_section_label: Label = $%TownFacilitySectionLabel
@onready var _town_npc_section_label: Label = $%TownNpcSectionLabel
@onready var _town_detail_section_label: Label = $%TownDetailSectionLabel
@onready var _march_section_label_1: Label = $%MarchSectionLabel1
@onready var _march_from_label: Label = $%MarchFromLabel
@onready var _march_to_label: Label = $%MarchToLabel
@onready var _march_section_label_2: Label = $%MarchSectionLabel2
@onready var _march_section_label_3: Label = $%MarchSectionLabel3
@onready var _march_section_label_4: Label = $%MarchSectionLabel4
@onready var _sov_territory_section_label: Label = $%SovTerritorySectionLabel
@onready var _sov_nation_section_label: Label = $%SovNationSectionLabel
@onready var _terr_list_section_label: Label = $%TerrListSectionLabel
@onready var _terr_detail_section_label: Label = $%TerrDetailSectionLabel
@onready var _terr_construction_label: Label = $%TerrConstructionLabel
@onready var _pf_start_label: Label = $%PfStartLabel
@onready var _pf_end_label: Label = $%PfEndLabel
@onready var _pf_routes_section_label: Label = $%PfRoutesSectionLabel

# ==============================================================================
# 地图状态与 Mock 数据快照
# ==============================================================================

var map_zoom_level: float = GameConfig.get_float("frontend.views", "fe10_world_map/default_zoom", 1.0)
const MAP_MIN_ZOOM := 0.5
const MAP_MAX_ZOOM := 3.0

var town_landmarks: Array = []
var marching_routes: Array = []
var selected_landmark_id: String = ""
var selected_town_id: String = "" # 白模测试契约字段（TC-FE10-02 断言）

# 城镇设施数据（骨架阶段 Mock）
var _mock_town_facilities: Array = [
	{ "id": "FAC_INN", "name": "ui.fe10.mock.fac.inn.name", "desc": "ui.fe10.mock.fac.inn.desc" },
	{ "id": "FAC_SMITH", "name": "ui.fe10.mock.fac.smith.name", "desc": "ui.fe10.mock.fac.smith.desc" },
	{ "id": "FAC_GUILD", "name": "ui.fe10.mock.fac.guild.name", "desc": "ui.fe10.mock.fac.guild.desc" },
	{ "id": "FAC_MARKET", "name": "ui.fe10.mock.fac.market.name", "desc": "ui.fe10.mock.fac.market.desc" }
]

# 城镇 NPC 数据（骨架阶段 Mock）
var _mock_town_npcs: Array = [
	{ "id": "NPC_INNKEEPER", "name": "ui.fe10.mock.npc.innkeeper.name", "desc": "ui.fe10.mock.npc.innkeeper.desc" },
	{ "id": "NPC_BLACKSMITH", "name": "ui.fe10.mock.npc.blacksmith.name", "desc": "ui.fe10.mock.npc.blacksmith.desc" },
	{ "id": "NPC_GUILDMASTER", "name": "ui.fe10.mock.npc.guildmaster.name", "desc": "ui.fe10.mock.npc.guildmaster.desc" }
]

# 领地数据（骨架阶段 Mock）
var _mock_territories: Array = [
	{ "id": "TERR_01", "name": "ui.fe10.mock.terr.farmland.name", "food": 50, "wood": 10, "ore": 0, "garrison": 20, "construction": 0.65 },
	{ "id": "TERR_02", "name": "ui.fe10.mock.terr.silver_woods.name", "food": 20, "wood": 80, "ore": 5, "garrison": 10, "construction": 1.0 }
]

# 主权国家数据（骨架阶段 Mock）
var _mock_sovereignty: Dictionary = {"nation_name": "ui.fe10.mock.sov.nation_name", "monarch": "ui.fe10.mock.sov.monarch", "population": 1200, "territory_count": 2, "level": "ui.fe10.mock.sov.level"}

# 行军队伍状态（骨架阶段本地模拟）
var _marching_active: bool = false

# 地标 ID → i18n key 映射
const _LANDMARK_NAME_KEYS := {"VALAN_CAPITAL": "ui.fe10.mock.landmark.valan_capital", "SILVER_GROVE": "ui.fe10.mock.landmark.silver_grove", "IRON_FORTRESS": "ui.fe10.mock.landmark.iron_fortress", "DRAGON_PEAK": "ui.fe10.mock.landmark.dragon_peak"}

# ==============================================================================
# 生命周期
# ==============================================================================

# ==============================================================================
# 白模测试契约兼容桩（映射到新状态，不触碰 @onready 节点）
# ==============================================================================

func adjust_zoom(delta: float) -> void: map_zoom_level = clampf(map_zoom_level + delta, MAP_MIN_ZOOM, MAP_MAX_ZOOM)
func select_town(town_id: String) -> Dictionary: selected_town_id = town_id; return {"success": true, "town_id": town_id}
func set_marching_route_snapshot(routes: Array) -> void: apply_snapshot({"marching_routes": routes})

## 统一快照渲染映射（P81）：行军路线 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("marching_routes"):
		marching_routes = FrontendSnapshot.read_array(snapshot, "marching_routes")

## 生命周期初始化：主题/快照/六 Tab 标题与文案/各子界面装配/信号绑定（骨架零接线）
var _tabs = null

func _get_tabs():
	if _tabs == null:
		_tabs = WorldMapTabsClass.new()
		_tabs.setup(self)
	return _tabs

func _ready() -> void:
	# 1. 应用主题（骨架阶段直接用 ThemeManager 单例的默认主题）
	var tm := ThemeManager.get_instance()
	theme = tm.theme

	# 2. 加载 Mock 快照数据
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

	# 6. 绑定信号（零接线：仅本地 UI 交互反馈）
	_connect_signals()

	# 7. 视图加载后批量视觉适配
	UIIntermediary.adapt_view(self)

## 视图销毁钩子：清理 UIIntermediary 视图绑定（防悬挂引用）
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

# ==============================================================================
# Mock 数据加载
# ==============================================================================

## 从 domain_boundary 快照服务加载世界地图域快照（地标 i18n 键替换/行军路线）
func _load_mock_snapshot() -> void:
	var world_map := MockServiceContainer.get_instance().snapshot_data().load_snapshot("world_map")
	if world_map.is_empty():
		return
	if world_map.has("landmarks"):
		town_landmarks = FrontendSnapshot.read_array(world_map, "landmarks")
		# 将地标中文名替换为 i18n key
		for lm in town_landmarks:
			var lid: String = lm.get("id", "")
			if _LANDMARK_NAME_KEYS.has(lid):
				lm["name"] = _LANDMARK_NAME_KEYS[lid]
	if world_map.has("marching_routes"):
		marching_routes = FrontendSnapshot.read_array(world_map, "marching_routes")

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
	for i in tab_keys.size():
		UIIntermediary.resolve_tab(_main_tab_container, i, tab_keys[i])

# ==============================================================================
# 静态文案初始化（非动态数据节点，i18n 绑定）
# ==============================================================================

## 初始化全部静态文案（22 个非唯一标签 + 各 Tab 按钮，i18n 全驱动）
func _init_static_text() -> void:
	# 顶部标题栏
	UIIntermediary.resolve(_title_label, "ui.fe10.header.title")
	UIIntermediary.resolve(_title_sub_label, "ui.fe10.header.title_sub")
	UIIntermediary.resolve(_back_btn, "ui.fe10.header.back")

	# Tab 0: 大地图
	UIIntermediary.resolve(_wmap_placeholder_label, "ui.fe10.wmap.placeholder")
	UIIntermediary.resolve(_wmap_zoom_section_label, "ui.fe10.wmap.zoom_section")
	UIIntermediary.resolve(_wmap_legend_label, "ui.fe10.wmap.legend")

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
	_wmap_legend_list.clear()
	for landmark in town_landmarks:
		var name := UIIntermediary.text(landmark.get("name", ""))
		var type := UIIntermediary.text(_landmark_type_key(landmark.get("type", "")))
		UIIntermediary.resolve_item(_wmap_legend_list, "ui.fe10.wmap.legend_item", {"name": name, "type": type})
	# 初始缩放与坐标显示
	_refresh_wmap_zoom()
	_refresh_wmap_coord()

## 动态生成地标按钮：按 Mock 坐标定位，点击回调切城镇详情
func _spawn_landmark_buttons() -> void:
	# 清除旧地标按钮
	for child in _wmap_landmark_container.get_children():
		child.queue_free()
	# 动态生成地标按钮（坐标来自 Mock 数据）
	for landmark in town_landmarks:
		var btn := KButtonClass.new()
		btn.variant = KButtonClass.StyleVariant.SECONDARY
		btn.name = "Landmark_%s" % landmark.get("id", "")
		btn.text = UIIntermediary.text(landmark.get("name", ""))
		btn.position = Vector2(landmark.get("x", 0) - 60, landmark.get("y", 0) - 16)
		btn.size = Vector2(120, 32)
		var lid: String = landmark.get("id", "")
		btn.pressed.connect(func(): _on_landmark_pressed(lid))
		_wmap_landmark_container.add_child(btn)

func _landmark_type_key(code: String) -> String:
	var m := {"CAPITAL": "ui.fe10.landmark.type.capital", "TOWN": "ui.fe10.landmark.type.town", "FORTRESS": "ui.fe10.landmark.type.fortress", "DUNGEON": "ui.fe10.landmark.type.dungeon"}
	return m.get(code, code)

## 刷新缩放百分比标签
func _refresh_wmap_zoom() -> void:
	if _wmap_zoom_label:
		UIIntermediary.resolve(_wmap_zoom_label, "ui.fe10.wmap.zoom", {"percent": int(map_zoom_level * 100)})

## 刷新坐标标签：未选中地标显示默认文案，选中则按地标坐标渲染
func _refresh_wmap_coord() -> void:
	if _wmap_coord_label:
		if selected_landmark_id.is_empty():
			UIIntermediary.resolve(_wmap_coord_label, "ui.fe10.wmap.coord_default")
		else:
			for lm in town_landmarks:
				if lm.get("id", "") == selected_landmark_id:
					UIIntermediary.resolve(_wmap_coord_label, "ui.fe10.wmap.coord", {"x": lm.get("x", 0), "y": lm.get("y", 0)})
					break

# ==============================================================================
# Tab 1: 城镇详情 - 初始化
# ==============================================================================

## 初始化城镇详情 Tab：填充设施/NPC 列表并默认展示首个地标
func _init_town_view_tab() -> void:
	# 填充设施列表
	_town_facility_list.clear()
	for fac in _mock_town_facilities:
		_town_facility_list.add_item(UIIntermediary.text(fac.get("name", "")))
	# 填充 NPC 列表
	_town_npc_list.clear()
	for npc in _mock_town_npcs:
		_town_npc_list.add_item(UIIntermediary.text(npc.get("name", "")))
	# 默认选中第一个地标
	if town_landmarks.size() > 0:
		_show_town(town_landmarks[0])

## 展示城镇详情：名称/类型/设施详情占位
func _show_town(landmark: Dictionary) -> void:
	if _town_name_label:
		_town_name_label.text = UIIntermediary.text(landmark.get("name", "ui.fe10.town.name_default"))
	if _town_type_label:
		var type_name := UIIntermediary.text(_landmark_type_key(landmark.get("type", "")))
		UIIntermediary.resolve(_town_type_label, "ui.fe10.town.type_label", {"type": type_name})
	if _town_facility_detail_label:
		UIIntermediary.resolve(_town_facility_detail_label, "ui.fe10.town.detail_placeholder")

# ==============================================================================
# Tab 2~5 委托给 WorldMapTabs
# ==============================================================================

func _init_marching_tab() -> void: _get_tabs().init_marching_tab()
func _refresh_march_preview() -> void: _get_tabs().refresh_march_preview()
func _terrain_key(code: String) -> String: return _get_tabs()._terrain_key(code)
func _refresh_march_party_status() -> void: _get_tabs().refresh_march_party_status()
func _init_sovereignty_tab() -> void: _get_tabs().init_sovereignty_tab()
func _refresh_sovereignty_info() -> void: _get_tabs().refresh_sovereignty_info()
func _init_territory_tab() -> void: _get_tabs().init_territory_tab()
func _show_territory_detail(terr: Dictionary) -> void: _get_tabs().show_territory_detail(terr)
func _init_pathfinding_tab() -> void: _get_tabs().init_pathfinding_tab()

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================

## 绑定本地 UI 交互信号（零接线：六 Tab 控件在本地脚本闭环）
func _connect_signals() -> void:
	# 返回按钮
	_back_btn.pressed.connect(_on_back_pressed)

	# 大地图缩放
	_wmap_zoom_in_btn.pressed.connect(_on_wmap_zoom_in)
	_wmap_zoom_out_btn.pressed.connect(_on_wmap_zoom_out)
	# 图例点击切换地标
	_wmap_legend_list.item_selected.connect(_on_legend_selected)

	# 城镇设施 / NPC 选择
	_town_facility_list.item_selected.connect(_on_town_facility_selected)
	_town_npc_list.item_selected.connect(_on_town_npc_selected)

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
	for landmark in town_landmarks:
		if landmark.get("id", "") == landmark_id:
			_show_town(landmark)
			_main_tab_container.current_tab = 1
			break

## 图例条目选中：委托地标点击逻辑
func _on_legend_selected(index: int) -> void:
	if index >= 0 and index < town_landmarks.size():
		_on_landmark_pressed(town_landmarks[index].get("id", ""))

func _on_wmap_zoom_in() -> void: map_zoom_level = minf(map_zoom_level + 0.25, MAP_MAX_ZOOM); _refresh_wmap_zoom()
func _on_wmap_zoom_out() -> void: map_zoom_level = maxf(map_zoom_level - 0.25, MAP_MIN_ZOOM); _refresh_wmap_zoom()

# ==============================================================================
# 城镇交互
# ==============================================================================

## 设施条目选中：渲染设施名称与描述详情
func _on_town_facility_selected(index: int) -> void:
	if index >= 0 and index < _mock_town_facilities.size():
		var fac: Dictionary = _mock_town_facilities[index]
		if _town_facility_detail_label:
			var name := UIIntermediary.text(fac.get("name", ""))
			var desc := UIIntermediary.text(fac.get("desc", ""))
			UIIntermediary.resolve(_town_facility_detail_label, "ui.fe10.town.facility_detail", {"name": name, "desc": desc})

## NPC 条目选中：渲染 NPC 名称与描述详情
func _on_town_npc_selected(index: int) -> void:
	if index >= 0 and index < _mock_town_npcs.size():
		var npc: Dictionary = _mock_town_npcs[index]
		if _town_facility_detail_label:
			var name := UIIntermediary.text(npc.get("name", ""))
			var desc := UIIntermediary.text(npc.get("desc", ""))
			UIIntermediary.resolve(_town_facility_detail_label, "ui.fe10.town.npc_detail", {"name": name, "desc": desc})

# ==============================================================================
# Tab 2~5 回调委托
# ==============================================================================

func _on_march_option_changed(idx: int) -> void: _get_tabs()._on_march_option_changed(idx)
func _on_march_start() -> void: _get_tabs()._on_march_start()
func _on_march_stop() -> void: _get_tabs()._on_march_stop()
func _on_sov_establish() -> void: _get_tabs()._on_sov_establish()
func _on_territory_selected(idx: int) -> void: _get_tabs()._on_territory_selected(idx)
func _on_terr_upgrade() -> void: _get_tabs()._on_terr_upgrade()
func _on_pf_calc() -> void: _get_tabs()._on_pf_calc()
func _on_pf_route_selected(idx: int) -> void: _get_tabs()._on_pf_route_selected(idx)
func _on_pf_auto() -> void: _get_tabs()._on_pf_auto()
