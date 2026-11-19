# ==============================================================================
# 模块归属: frontend.views.world_map
# 文件路径: res://frontend/views/world_map/world_map_tabs.gd
# 架构定位: 世界地图标签页子控制器，承接行军探索、主权建国、领地管理与寻路规划交互
# 依赖与触发: 依赖 BaseScreen / UIIntermediary / ServiceLocator / WorldMapView
# 职责说明: 管理行军、主权、领地和寻路四个分页的静态文案、列表刷新及控件回调
# 退出语义与设计依据: 随宿主视图同步释放；行军与领地状态变更写回宿主并刷新界面反馈
# ==============================================================================
## 世界地图分页子控制器，封装行军探索、主权建国、领地与寻路面板
class_name WorldMapTabs
extends BaseScreen

var _view: WorldMapView = null

## 绑定宿主世界地图视图实例
func setup(host_view: WorldMapView) -> void:
	_view = host_view

# ==============================================================================
# 静态文案与信号
# ==============================================================================

## 初始化行军、主权、领地和寻路分页静态文案
func init_static_text() -> void:
	if _view == null:
		return
	for binding_entry in [
		[_view.march_section_label_1, "ui.fe10.march.route_section"],
		[_view.march_from_label, "ui.fe10.march.from_label"],
		[_view.march_to_label, "ui.fe10.march.to_label"],
		[_view.march_section_label_2, "ui.fe10.march.preview_section"],
		[_view.march_section_label_3, "ui.fe10.march.action_section"],
		[_view.march_start_button, "ui.fe10.march.start_btn"],
		[_view.march_stop_button, "ui.fe10.march.stop_btn"],
		[_view.march_section_label_4, "ui.fe10.march.party_section"],
		[_view.sovereignty_territory_section_label, "ui.fe10.sov.territory_section"],
		[_view.sovereignty_nation_section_label, "ui.fe10.sov.nation_section"],
		[_view.sovereignty_establish_button, "ui.fe10.sov.establish_btn"],
		[_view.territory_list_section_label, "ui.fe10.terr.list_section"],
		[_view.territory_detail_section_label, "ui.fe10.terr.detail_section"],
		[_view.territory_construction_label, "ui.fe10.terr.construction_section"],
		[_view.territory_upgrade_button, "ui.fe10.terr.upgrade_btn"],
		[_view.pathfinding_start_label, "ui.fe10.pf.start_label"],
		[_view.pathfinding_end_label, "ui.fe10.pf.end_label"],
		[_view.pathfinding_calculate_button, "ui.fe10.pf.calc_btn"],
		[_view.pathfinding_routes_section_label, "ui.fe10.pf.routes_section"],
		[_view.pathfinding_route_detail_label, "ui.fe10.pf.detail_placeholder"],
		[_view.pathfinding_auto_button, "ui.fe10.pf.auto_btn"]
	]:
		UIIntermediary.resolve(binding_entry[0], str(binding_entry[1]))

## 绑定行军、主权、领地和寻路控件信号
func connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view._town_facility_list.item_selected, on_town_facility_selected)
	connect_managed(_view._town_npc_list.item_selected, on_town_npc_selected)
	connect_managed(_view.march_from_option.item_selected, _on_march_option_changed)
	connect_managed(_view.march_to_option.item_selected, _on_march_option_changed)
	connect_managed(_view.march_start_button.pressed, _on_march_start)
	connect_managed(_view.march_stop_button.pressed, _on_march_stop)
	connect_managed(_view.sovereignty_establish_button.pressed, _on_sov_establish)
	connect_managed(_view.territory_list.item_selected, _on_territory_selected)
	connect_managed(_view.territory_upgrade_button.pressed, _on_terr_upgrade)
	connect_managed(_view.pathfinding_calculate_button.pressed, _on_pf_calc)
	connect_managed(_view.pathfinding_route_list.item_selected, _on_pf_route_selected)
	connect_managed(_view.pathfinding_auto_button.pressed, _on_pf_auto)

# ==============================================================================
# Tab 2: 行军探索 (MARCHING)
# ==============================================================================

## 初始化行军分页地标下拉选项与队伍状态
func init_marching_tab() -> void:
	if _view == null:
		return
	_view.march_from_option.clear()
	_view.march_to_option.clear()
	for landmark_entry in _view.town_landmarks:
		var landmark_name := UIIntermediary.text(landmark_entry.get("name", ""))
		_view.march_from_option.add_item(landmark_name)
		_view.march_to_option.add_item(landmark_name)
	if _view.town_landmarks.size() >= 2:
		_view.march_from_option.select(0)
		_view.march_to_option.select(1)
		refresh_march_preview()
	refresh_march_party_status()

## 刷新当前所选起止地标的行军路线、预计耗时与地形预览
func refresh_march_preview() -> void:
	if _view == null:
		return
	var from_index := _view.march_from_option.selected
	var to_index := _view.march_to_option.selected
	if from_index < 0 or to_index < 0 or from_index >= _view.town_landmarks.size() or to_index >= _view.town_landmarks.size():
		return
	var from_name := UIIntermediary.text(_view.town_landmarks[from_index].get("name", ""))
	var to_name := UIIntermediary.text(_view.town_landmarks[to_index].get("name", ""))
	if _view.march_route_preview_label:
		UIIntermediary.resolve(_view.march_route_preview_label, "ui.fe10.march.route", {"from": from_name, "to": to_name})
	var remaining_hours := 0
	var terrain_name := UIIntermediary.text("ui.fe10.terrain.plains")
	for route_entry in _view.marching_routes:
		if route_entry.get("from", "") == _view.town_landmarks[from_index].get("id", "") and route_entry.get("to", "") == _view.town_landmarks[to_index].get("id", ""):
			remaining_hours = route_entry.get("hours_remain", 0)
			terrain_name = UIIntermediary.text(_terrain_key(route_entry.get("terrain", "PLAINS")))
			break
	if remaining_hours == 0 and from_index != to_index:
		remaining_hours = 4
	if _view.march_eta_label:
		UIIntermediary.resolve(_view.march_eta_label, "ui.fe10.march.eta", {"hours": remaining_hours})
	if _view.march_terrain_label:
		UIIntermediary.resolve(_view.march_terrain_label, "ui.fe10.march.terrain", {"terrain": terrain_name})

func _terrain_key(terrain_code: String) -> String:
	match terrain_code:
		"PLAINS": return "ui.fe10.terrain.plains"
		"FOREST": return "ui.fe10.terrain.forest"
		"MOUNTAIN": return "ui.fe10.terrain.mountain"
		"SWAMP": return "ui.fe10.terrain.swamp"
		"DESERT": return "ui.fe10.terrain.desert"
		_: return terrain_code

## 刷新行军队伍补给与行进状态文本
func refresh_march_party_status() -> void:
	if _view and _view.march_party_status_label:
		var supply_text := UIIntermediary.text("ui.fe10.march.supply_sufficient")
		var status_key := "ui.fe10.march.party_active" if _view.marching_active else "ui.fe10.march.party_idle"
		UIIntermediary.resolve(_view.march_party_status_label, status_key, {"count": 6, "supply": supply_text})

func _on_march_option_changed(_option_index: int) -> void:
	refresh_march_preview()

func _on_march_start() -> void:
	if _view == null:
		return
	ServiceLocator.get_instance().world().dispatch_world_directive("world_navigation", "ADVANCE_MARCH", {"hours": 1})
	_view.marching_active = true
	_view.march_start_button.disabled = true
	_view.march_stop_button.disabled = false
	refresh_march_party_status()

func _on_march_stop() -> void:
	if _view == null:
		return
	ServiceLocator.get_instance().world().dispatch_world_directive("world_navigation", "STOP_MARCH", {})
	_view.marching_active = false
	_view.march_start_button.disabled = false
	_view.march_stop_button.disabled = true
	refresh_march_party_status()

# ==============================================================================
# Tab 3: 主权建国 (SOVEREIGNTY)
# ==============================================================================

## 初始化主权分页领地列表与国家信息展示
func init_sovereignty_tab() -> void:
	if _view == null:
		return
	_view.sovereignty_territory_list.clear()
	for territory_entry in _view._territories:
		_view.sovereignty_territory_list.add_item(UIIntermediary.text(territory_entry.get("name", "")))
	refresh_sovereignty_info()

## 刷新当前国家名称、君主、人口、领地数与等级展示
func refresh_sovereignty_info() -> void:
	if _view == null:
		return
	if _view.sovereignty_nation_name_label:
		var nation_key: String = _view._sovereignty.get("nation_name", "ui.fe10.sov.nation_name_none")
		_view.sovereignty_nation_name_label.text = UIIntermediary.text(nation_key)
	if _view.sovereignty_monarch_label:
		var monarch_name := UIIntermediary.text(_view._sovereignty.get("monarch", ""))
		UIIntermediary.resolve(_view.sovereignty_monarch_label, "ui.fe10.sov.monarch", {"name": monarch_name})
	if _view.sovereignty_population_label:
		UIIntermediary.resolve(_view.sovereignty_population_label, "ui.fe10.sov.population", {"count": _view._sovereignty.get("population", 0)})
	if _view.sovereignty_territory_count_label:
		UIIntermediary.resolve(_view.sovereignty_territory_count_label, "ui.fe10.sov.territory_count", {"count": _view._sovereignty.get("territory_count", 0)})
	if _view.sovereignty_level_label:
		var level_name := UIIntermediary.text(_view._sovereignty.get("level", "ui.fe10.sov.level_none"))
		UIIntermediary.resolve(_view.sovereignty_level_label, "ui.fe10.sov.level", {"level": level_name})

func _on_sov_establish() -> void:
	if _view == null:
		return
	var establish_reply := ServiceLocator.get_instance().world().dispatch_world_directive("world_navigation", "ESTABLISH_SOVEREIGNTY", {"territory_count": _view._territories.size()})
	if establish_reply.get("sovereignty") is Dictionary:
		_view._sovereignty = (establish_reply.get("sovereignty") as Dictionary).duplicate(true)
	else:
		_view._sovereignty["territory_count"] = _view._territories.size()
	refresh_sovereignty_info()
	_view.sovereignty_establish_button.disabled = true
	UIIntermediary.resolve(_view.sovereignty_establish_button, "ui.fe10.sov.established")

# ==============================================================================
# Tab 4: 领地管理 (TERRITORY)
# ==============================================================================

## 初始化领地列表并默认显示首座领地详情
func init_territory_tab() -> void:
	if _view == null:
		return
	_view.territory_list.clear()
	for territory_entry in _view._territories:
		_view.territory_list.add_item(UIIntermediary.text(territory_entry.get("name", "")))
	if _view._territories.size() > 0:
		show_territory_detail(_view._territories[0])

## 展示指定领地的资源产出、建设进度与驻防人数
func show_territory_detail(territory_entry: Dictionary) -> void:
	if _view == null:
		return
	if _view.territory_resource_label:
		UIIntermediary.resolve(_view.territory_resource_label, "ui.fe10.terr.resource", {
			"food": territory_entry.get("food", 0), "wood": territory_entry.get("wood", 0), "ore": territory_entry.get("ore", 0)
		})
	if _view.territory_construction_bar:
		_view.territory_construction_bar.value = territory_entry.get("construction", 0.0) * 100.0
	if _view.territory_garrison_label:
		UIIntermediary.resolve(_view.territory_garrison_label, "ui.fe10.terr.garrison", {"count": territory_entry.get("garrison", 0)})

func _on_territory_selected(territory_index: int) -> void:
	if _view and territory_index >= 0 and territory_index < _view._territories.size():
		show_territory_detail(_view._territories[territory_index])

func _on_terr_upgrade() -> void:
	if _view == null:
		return
	var selected_indices := _view.territory_list.get_selected_items()
	if selected_indices.size() > 0 and selected_indices[0] < _view._territories.size():
		var upgrade_outcome := ServiceLocator.get_instance().world().upgrade_territory(_view._territories[selected_indices[0]])
		if bool(upgrade_outcome.get("success", false)):
			_view._territories[selected_indices[0]] = upgrade_outcome.get("territory", _view._territories[selected_indices[0]])
			show_territory_detail(_view._territories[selected_indices[0]])

# ==============================================================================
# Tab 5: 寻路规划 (PATHFINDING)
# ==============================================================================

## 初始化寻路分页起点与终点地标下拉选项
func init_pathfinding_tab() -> void:
	if _view == null:
		return
	_view.pathfinding_start_option.clear()
	_view.pathfinding_end_option.clear()
	for landmark_entry in _view.town_landmarks:
		var landmark_name := UIIntermediary.text(landmark_entry.get("name", ""))
		_view.pathfinding_start_option.add_item(landmark_name)
		_view.pathfinding_end_option.add_item(landmark_name)
	if _view.town_landmarks.size() >= 2:
		_view.pathfinding_start_option.select(0)
		_view.pathfinding_end_option.select(1)

func _on_pf_calc() -> void:
	if _view == null:
		return
	var start_index := _view.pathfinding_start_option.selected
	var destination_index := _view.pathfinding_end_option.selected
	var planned_routes := ServiceLocator.get_instance().world().plan_routes(start_index, destination_index)
	if planned_routes.is_empty():
		if _view.pathfinding_route_detail_label:
			UIIntermediary.resolve(_view.pathfinding_route_detail_label, "ui.fe10.pf.same_start_end")
		return
	_view.pathfinding_route_list.clear()
	var start_name := UIIntermediary.text(_view.town_landmarks[start_index].get("name", ""))
	var destination_name := UIIntermediary.text(_view.town_landmarks[destination_index].get("name", ""))
	for route_entry in planned_routes:
		UIIntermediary.resolve_item(_view.pathfinding_route_list, "ui.fe10.pf.route_item", {
			"label": route_entry.label, "from": start_name, "to": destination_name,
			"hours": route_entry.hours, "danger": UIIntermediary.text(route_entry.danger_key), "cost": route_entry.cost,
		})
	if _view.pathfinding_route_detail_label:
		UIIntermediary.resolve(_view.pathfinding_route_detail_label, "ui.fe10.pf.routes_calculated", {"count": planned_routes.size()})

func _on_pf_route_selected(route_index: int) -> void:
	if _view and _view.pathfinding_route_detail_label:
		var detail_key := "ui.fe10.pf.route_detail_%d" % route_index
		var detail_text := UIIntermediary.text(detail_key)
		UIIntermediary.resolve(_view.pathfinding_route_detail_label, "ui.fe10.pf.route_detail", {"index": route_index + 1, "detail": detail_text})

func _on_pf_auto() -> void:
	if _view == null:
		return
	if _view.pathfinding_route_list.item_count == 0:
		_on_pf_calc()
	if _view.pathfinding_route_detail_label:
		UIIntermediary.resolve(_view.pathfinding_route_detail_label, "ui.fe10.pf.auto_started")

## 设施条目选中：渲染设施名称与描述详情
func on_town_facility_selected(facility_index: int) -> void:
	if _view and facility_index >= 0 and facility_index < _view._town_facilities.size():
		var facility_entry: Dictionary = _view._town_facilities[facility_index]
		if _view._town_facility_detail_label:
			var facility_name := UIIntermediary.text(facility_entry.get("name", ""))
			var facility_description := UIIntermediary.text(facility_entry.get("desc", ""))
			UIIntermediary.resolve(_view._town_facility_detail_label, "ui.fe10.town.facility_detail", {"name": facility_name, "desc": facility_description})

## NPC 条目选中：渲染 NPC 名称与描述详情
func on_town_npc_selected(resident_index: int) -> void:
	if _view and resident_index >= 0 and resident_index < _view._town_npcs.size():
		var resident_entry: Dictionary = _view._town_npcs[resident_index]
		if _view._town_facility_detail_label:
			var resident_name := UIIntermediary.text(resident_entry.get("name", ""))
			var resident_description := UIIntermediary.text(resident_entry.get("desc", ""))
			UIIntermediary.resolve(_view._town_facility_detail_label, "ui.fe10.town.npc_detail", {"name": resident_name, "desc": resident_description})
