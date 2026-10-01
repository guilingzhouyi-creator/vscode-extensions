# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第10卷: 世界地图 Tab 子面板控制器
# 文件路径: res://frontend/views/world_map/world_map_tabs.gd
# 职责: 承接行军探索/主权建国/领地管理/寻路规划四个 Tab 的初始化与交互
# ==============================================================================
class_name WorldMapTabs
extends BaseScreen

var _view: WorldMapView = null

func setup(view: WorldMapView) -> void:
	_view = view

# ==============================================================================
# 静态文案与信号
# ==============================================================================

func init_static_text() -> void:
	if _view == null:
		return
	for item in [
		[_view._march_section_label_1, "ui.fe10.march.route_section"],
		[_view._march_from_label, "ui.fe10.march.from_label"],
		[_view._march_to_label, "ui.fe10.march.to_label"],
		[_view._march_section_label_2, "ui.fe10.march.preview_section"],
		[_view._march_section_label_3, "ui.fe10.march.action_section"],
		[_view._march_start_btn, "ui.fe10.march.start_btn"],
		[_view._march_stop_btn, "ui.fe10.march.stop_btn"],
		[_view._march_section_label_4, "ui.fe10.march.party_section"],
		[_view._sov_territory_section_label, "ui.fe10.sov.territory_section"],
		[_view._sov_nation_section_label, "ui.fe10.sov.nation_section"],
		[_view._sov_establish_btn, "ui.fe10.sov.establish_btn"],
		[_view._terr_list_section_label, "ui.fe10.terr.list_section"],
		[_view._terr_detail_section_label, "ui.fe10.terr.detail_section"],
		[_view._terr_construction_label, "ui.fe10.terr.construction_section"],
		[_view._terr_upgrade_btn, "ui.fe10.terr.upgrade_btn"],
		[_view._pf_start_label, "ui.fe10.pf.start_label"],
		[_view._pf_end_label, "ui.fe10.pf.end_label"],
		[_view._pf_calc_btn, "ui.fe10.pf.calc_btn"],
		[_view._pf_routes_section_label, "ui.fe10.pf.routes_section"],
		[_view._pf_route_detail_label, "ui.fe10.pf.detail_placeholder"],
		[_view._pf_auto_btn, "ui.fe10.pf.auto_btn"]
	]:
		UIIntermediary.resolve(item[0], str(item[1]))

func connect_signals() -> void:
	if _view == null:
		return
	_view._march_from_option.item_selected.connect(_on_march_option_changed)
	_view._march_to_option.item_selected.connect(_on_march_option_changed)
	_view._march_start_btn.pressed.connect(_on_march_start)
	_view._march_stop_btn.pressed.connect(_on_march_stop)
	_view._sov_establish_btn.pressed.connect(_on_sov_establish)
	_view._territory_list.item_selected.connect(_on_territory_selected)
	_view._terr_upgrade_btn.pressed.connect(_on_terr_upgrade)
	_view._pf_calc_btn.pressed.connect(_on_pf_calc)
	_view._pf_route_list.item_selected.connect(_on_pf_route_selected)
	_view._pf_auto_btn.pressed.connect(_on_pf_auto)

# ==============================================================================
# Tab 2: 行军探索 (MARCHING)
# ==============================================================================

func init_marching_tab() -> void:
	if _view == null:
		return
	_view._march_from_option.clear()
	_view._march_to_option.clear()
	for landmark in _view.town_landmarks:
		var name := UIIntermediary.text(landmark.get("name", ""))
		_view._march_from_option.add_item(name)
		_view._march_to_option.add_item(name)
	if _view.town_landmarks.size() >= 2:
		_view._march_from_option.select(0)
		_view._march_to_option.select(1)
		refresh_march_preview()
	refresh_march_party_status()

func refresh_march_preview() -> void:
	if _view == null:
		return
	var from_idx := _view._march_from_option.selected
	var to_idx := _view._march_to_option.selected
	if from_idx < 0 or to_idx < 0 or from_idx >= _view.town_landmarks.size() or to_idx >= _view.town_landmarks.size():
		return
	var from_name := UIIntermediary.text(_view.town_landmarks[from_idx].get("name", ""))
	var to_name := UIIntermediary.text(_view.town_landmarks[to_idx].get("name", ""))
	if _view._march_route_preview_label:
		UIIntermediary.resolve(_view._march_route_preview_label, "ui.fe10.march.route", {"from": from_name, "to": to_name})
	var hours := 0
	var terrain := UIIntermediary.text("ui.fe10.terrain.plains")
	for route in _view.marching_routes:
		if route.get("from", "") == _view.town_landmarks[from_idx].get("id", "") and route.get("to", "") == _view.town_landmarks[to_idx].get("id", ""):
			hours = route.get("hours_remain", 0)
			terrain = UIIntermediary.text(_terrain_key(route.get("terrain", "PLAINS")))
			break
	if hours == 0 and from_idx != to_idx:
		hours = 4
	if _view._march_eta_label:
		UIIntermediary.resolve(_view._march_eta_label, "ui.fe10.march.eta", {"hours": hours})
	if _view._march_terrain_label:
		UIIntermediary.resolve(_view._march_terrain_label, "ui.fe10.march.terrain", {"terrain": terrain})

func _terrain_key(code: String) -> String:
	match code:
		"PLAINS": return "ui.fe10.terrain.plains"
		"FOREST": return "ui.fe10.terrain.forest"
		"MOUNTAIN": return "ui.fe10.terrain.mountain"
		"SWAMP": return "ui.fe10.terrain.swamp"
		"DESERT": return "ui.fe10.terrain.desert"
		_: return code

func refresh_march_party_status() -> void:
	if _view and _view._march_party_status_label:
		var supply := UIIntermediary.text("ui.fe10.march.supply_sufficient")
		var status_key := "ui.fe10.march.party_active" if _view._marching_active else "ui.fe10.march.party_idle"
		UIIntermediary.resolve(_view._march_party_status_label, status_key, {"count": 6, "supply": supply})

func _on_march_option_changed(_index: int) -> void:
	refresh_march_preview()

func _on_march_start() -> void:
	if _view == null:
		return
	_view._marching_active = true
	_view._march_start_btn.disabled = true
	_view._march_stop_btn.disabled = false
	refresh_march_party_status()

func _on_march_stop() -> void:
	if _view == null:
		return
	_view._marching_active = false
	_view._march_start_btn.disabled = false
	_view._march_stop_btn.disabled = true
	refresh_march_party_status()

# ==============================================================================
# Tab 3: 主权建国 (SOVEREIGNTY)
# ==============================================================================

func init_sovereignty_tab() -> void:
	if _view == null:
		return
	_view._sov_territory_list.clear()
	for terr in _view._mock_territories:
		_view._sov_territory_list.add_item(UIIntermediary.text(terr.get("name", "")))
	refresh_sovereignty_info()

func refresh_sovereignty_info() -> void:
	if _view == null:
		return
	if _view._sov_nation_name_label:
		var nation_key: String = _view._mock_sovereignty.get("nation_name", "ui.fe10.sov.nation_name_none")
		_view._sov_nation_name_label.text = UIIntermediary.text(nation_key)
	if _view._sov_monarch_label:
		var monarch_name := UIIntermediary.text(_view._mock_sovereignty.get("monarch", ""))
		UIIntermediary.resolve(_view._sov_monarch_label, "ui.fe10.sov.monarch", {"name": monarch_name})
	if _view._sov_population_label:
		UIIntermediary.resolve(_view._sov_population_label, "ui.fe10.sov.population", {"count": _view._mock_sovereignty.get("population", 0)})
	if _view._sov_territory_count_label:
		UIIntermediary.resolve(_view._sov_territory_count_label, "ui.fe10.sov.territory_count", {"count": _view._mock_sovereignty.get("territory_count", 0)})
	if _view._sov_level_label:
		var level_name := UIIntermediary.text(_view._mock_sovereignty.get("level", "ui.fe10.sov.level_none"))
		UIIntermediary.resolve(_view._sov_level_label, "ui.fe10.sov.level", {"level": level_name})

func _on_sov_establish() -> void:
	if _view == null:
		return
	_view._mock_sovereignty = {
		"nation_name": "ui.fe10.mock.sov.nation_name",
		"monarch": "ui.fe10.mock.sov.monarch",
		"population": 1200,
		"territory_count": _view._mock_territories.size(),
		"level": "ui.fe10.mock.sov.level"
	}
	refresh_sovereignty_info()
	_view._sov_establish_btn.disabled = true
	UIIntermediary.resolve(_view._sov_establish_btn, "ui.fe10.sov.established")

# ==============================================================================
# Tab 4: 领地管理 (TERRITORY)
# ==============================================================================

func init_territory_tab() -> void:
	if _view == null:
		return
	_view._territory_list.clear()
	for terr in _view._mock_territories:
		_view._territory_list.add_item(UIIntermediary.text(terr.get("name", "")))
	if _view._mock_territories.size() > 0:
		show_territory_detail(_view._mock_territories[0])

func show_territory_detail(terr: Dictionary) -> void:
	if _view == null:
		return
	if _view._terr_resource_label:
		UIIntermediary.resolve(_view._terr_resource_label, "ui.fe10.terr.resource", {
			"food": terr.get("food", 0), "wood": terr.get("wood", 0), "ore": terr.get("ore", 0)
		})
	if _view._terr_construction_bar:
		_view._terr_construction_bar.value = terr.get("construction", 0.0) * 100.0
	if _view._terr_garrison_label:
		UIIntermediary.resolve(_view._terr_garrison_label, "ui.fe10.terr.garrison", {"count": terr.get("garrison", 0)})

func _on_territory_selected(index: int) -> void:
	if _view and index >= 0 and index < _view._mock_territories.size():
		show_territory_detail(_view._mock_territories[index])

func _on_terr_upgrade() -> void:
	if _view == null:
		return
	var idx := _view._territory_list.get_selected_items()
	if idx.size() > 0 and idx[0] < _view._mock_territories.size():
		var result := MockServiceContainer.get_instance().world().upgrade_territory(_view._mock_territories[idx[0]])
		if bool(result.get("success", false)):
			_view._mock_territories[idx[0]] = result.get("territory", _view._mock_territories[idx[0]])
			show_territory_detail(_view._mock_territories[idx[0]])

# ==============================================================================
# Tab 5: 寻路规划 (PATHFINDING)
# ==============================================================================

func init_pathfinding_tab() -> void:
	if _view == null:
		return
	_view._pf_start_option.clear()
	_view._pf_end_option.clear()
	for landmark in _view.town_landmarks:
		var name := UIIntermediary.text(landmark.get("name", ""))
		_view._pf_start_option.add_item(name)
		_view._pf_end_option.add_item(name)
	if _view.town_landmarks.size() >= 2:
		_view._pf_start_option.select(0)
		_view._pf_end_option.select(1)

func _on_pf_calc() -> void:
	if _view == null:
		return
	var from_idx := _view._pf_start_option.selected
	var to_idx := _view._pf_end_option.selected
	var route_data := MockServiceContainer.get_instance().world().plan_routes(from_idx, to_idx)
	if route_data.is_empty():
		if _view._pf_route_detail_label:
			UIIntermediary.resolve(_view._pf_route_detail_label, "ui.fe10.pf.same_start_end")
		return
	_view._pf_route_list.clear()
	var from_name := UIIntermediary.text(_view.town_landmarks[from_idx].get("name", ""))
	var to_name := UIIntermediary.text(_view.town_landmarks[to_idx].get("name", ""))
	for rd in route_data:
		UIIntermediary.resolve_item(_view._pf_route_list, "ui.fe10.pf.route_item", {
			"label": rd.label, "from": from_name, "to": to_name,
			"hours": rd.hours, "danger": UIIntermediary.text(rd.danger_key), "cost": rd.cost,
		})
	if _view._pf_route_detail_label:
		UIIntermediary.resolve(_view._pf_route_detail_label, "ui.fe10.pf.routes_calculated", {"count": route_data.size()})

func _on_pf_route_selected(index: int) -> void:
	if _view and _view._pf_route_detail_label:
		var detail_key := "ui.fe10.pf.route_detail_%d" % index
		var detail_text := UIIntermediary.text(detail_key)
		UIIntermediary.resolve(_view._pf_route_detail_label, "ui.fe10.pf.route_detail", {"index": index + 1, "detail": detail_text})

func _on_pf_auto() -> void:
	if _view == null:
		return
	if _view._pf_route_list.item_count == 0:
		_on_pf_calc()
	if _view._pf_route_detail_label:
		UIIntermediary.resolve(_view._pf_route_detail_label, "ui.fe10.pf.auto_started")
