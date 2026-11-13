# ==============================================================================
# Module: Frontend Views (Presentation Tab Controller)
# File Path: WebGames/frontend/views/example/example_tab_view_controller.gd
# Architecture Role: Strongly typed Tab view controller (Godot 4.7 Control tree)
# Dependencies & Triggers: Parent container -> typed apply_snapshot() -> child views
# Responsibilities: Coordinate tab switching and inject read-only snapshots with zero view math
# Exit Semantics & Design Rationale: Pure presentation controller with unidirectional snapshot flow
# ==============================================================================
class_name ExampleTabViewController
extends Control

## Strongly typed child view references (forbid untyped dynamic lookups)
@onready var _overview_tab: Control = %OverviewTab
@onready var _details_tab: Control = %DetailsTab
@onready var _tab_bar: TabBar = %TabBar

## Active tab index
var _current_tab_index: int = 0

func _ready() -> void:
    if _tab_bar == null:
        push_error("TabBar node not found")
        return
    _tab_bar.tab_changed.connect(_on_tab_changed)
    _update_tab_visibility()

## Exclusive data entrypoint: unidirectional snapshot injection (zero domain math)
func apply_snapshot(snapshot: Dictionary) -> void:
    if snapshot.is_empty():
        return

    if snapshot.has("overview") and _overview_tab != null:
        if _overview_tab.has_method("apply_snapshot"):
            _overview_tab.apply_snapshot(snapshot.get("overview", {}))

    if snapshot.has("details") and _details_tab != null:
        if _details_tab.has_method("apply_snapshot"):
            _details_tab.apply_snapshot(snapshot.get("details", {}))

func _on_tab_changed(index: int) -> void:
    if index == _current_tab_index:
        return
    _current_tab_index = index
    _update_tab_visibility()

func _update_tab_visibility() -> void:
    if _overview_tab != null:
        _overview_tab.visible = (_current_tab_index == 0)
    if _details_tab != null:
        _details_tab.visible = (_current_tab_index == 1)
