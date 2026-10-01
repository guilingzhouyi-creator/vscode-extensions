# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第15卷: 设置中心 Tab 子面板控制器
# 文件路径: res://frontend/views/settings_center/settings_center_tabs.gd
# 职责: 承接音频/画质/按键/多语言/功能开关/关于六大 Tab 的初始化与交互信号
# ==============================================================================
class_name SettingsCenterTabs
extends BaseScreen

var _view = null

func setup(view: BaseScreen) -> void:
	_view = view

# ==============================================================================
# 各 Tab 初始化
# ==============================================================================

## 初始化音频 Tab：文案 + 三路滑块/静音回填 + 音量标签刷新
func init_audio_tab() -> void:
	if _view == null:
		return
	var section: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/SectionLabel")
	if section != null:
		UIIntermediary.resolve(section, "ui.fe15.audio.section")
	var master_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/MasterRow/Label")
	if master_label != null:
		UIIntermediary.resolve(master_label, "ui.fe15.audio.master")
	var bgm_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/BGMRow/Label")
	if bgm_label != null:
		UIIntermediary.resolve(bgm_label, "ui.fe15.audio.bgm")
	var se_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/SERow/Label")
	if se_label != null:
		UIIntermediary.resolve(se_label, "ui.fe15.audio.se")
	if _view._check_mute_master != null:
		UIIntermediary.resolve(_view._check_mute_master, "ui.fe15.audio.mute")
		UIIntermediary.resolve(_view._check_mute_bgm, "ui.fe15.audio.mute")
		UIIntermediary.resolve(_view._check_mute_se, "ui.fe15.audio.mute")
		_view._slider_master.value = _view.volume_master
		_view._slider_bgm.value = _view.volume_bgm
		_view._slider_se.value = _view.volume_se
	refresh_volume_labels()

## 初始化画质 Tab：文案 + 分辨率/画质档位选项回填 + 全屏/垂直同步 + 回滚弹窗隐藏
func init_graphics_tab() -> void:
	if _view == null:
		return
	var section: Label = _view.get_node_or_null("MainLayout/TabContainer/画质设置/SectionLabel")
	if section != null:
		UIIntermediary.resolve(section, "ui.fe15.graphics.section")
	var resolution_label: Label = _view.get_node_or_null("MainLayout/TabContainer/画质设置/ResolutionRow/Label")
	if resolution_label != null:
		UIIntermediary.resolve(resolution_label, "ui.fe15.graphics.resolution")
	var quality_label: Label = _view.get_node_or_null("MainLayout/TabContainer/画质设置/QualityRow/Label")
	if quality_label != null:
		UIIntermediary.resolve(quality_label, "ui.fe15.graphics.quality")
	if _view._check_fullscreen != null:
		UIIntermediary.resolve(_view._check_fullscreen, "ui.fe15.graphics.fullscreen")
		UIIntermediary.resolve(_view._check_vsync, "ui.fe15.graphics.vsync")
		UIIntermediary.resolve(_view._btn_apply_graphics, "ui.fe15.graphics.apply")
		UIIntermediary.resolve(_view._btn_confirm_resolution, "ui.fe15.graphics.confirm_resolution")
		UIIntermediary.resolve(_view._btn_revert_resolution, "ui.fe15.graphics.revert_resolution")

		_view._option_resolution.clear()
		var resolutions := ["1280x720", "1920x1080", "2560x1440", "3840x2160"]
		for i in range(resolutions.size()):
			_view._option_resolution.add_item(resolutions[i])
			if resolutions[i] == _view.selected_resolution:
				_view._option_resolution.select(i)

		_view._option_quality.clear()
		var quality_keys := ["low", "medium", "high", "ultra"]
		for i in range(quality_keys.size()):
			_view._option_quality.add_item(UIIntermediary.text("ui.fe15.graphics.quality_" + quality_keys[i]))
			if quality_keys[i] == _view.selected_quality:
				_view._option_quality.select(i)

		_view._check_fullscreen.button_pressed = _view.is_fullscreen
		_view._check_vsync.button_pressed = _view.is_vsync
		_view._panel_revert_popup.visible = false

## 初始化按键 Tab：8 行按键标签 + 鼠标左键 + 重置按钮/手柄提示（i18n）
func init_keys_tab() -> void:
	if _view == null:
		return
	var section: Label = _view.get_node_or_null("MainLayout/TabContainer/按键设置/SectionLabel")
	if section != null:
		UIIntermediary.resolve(section, "ui.fe15.keys.section")
	var key_base := "MainLayout/TabContainer/按键设置/ScrollContainer/KeyList"
	var key_row_labels := [
		{"path": key_base + "/KeyRow1/Label", "key": "ui.fe15.keys.move_forward"},
		{"path": key_base + "/KeyRow2/Label", "key": "ui.fe15.keys.move_backward"},
		{"path": key_base + "/KeyRow3/Label", "key": "ui.fe15.keys.move_left"},
		{"path": key_base + "/KeyRow4/Label", "key": "ui.fe15.keys.move_right"},
		{"path": key_base + "/KeyRow5/Label", "key": "ui.fe15.keys.normal_attack"},
		{"path": key_base + "/KeyRow6/Label", "key": "ui.fe15.keys.skill"},
		{"path": key_base + "/KeyRow7/Label", "key": "ui.fe15.keys.jump"},
		{"path": key_base + "/KeyRow8/Label", "key": "ui.fe15.keys.interact"},
	]
	for entry in key_row_labels:
		var lbl: Label = _view.get_node_or_null(entry.path)
		if lbl != null:
			UIIntermediary.resolve(lbl, entry.key)
	var mouse_left_btn: Button = _view.get_node_or_null(key_base + "/KeyRow5/KeyBtn")
	if mouse_left_btn != null:
		UIIntermediary.resolve(mouse_left_btn, "ui.fe15.keys.mouse_left")
	if _view._btn_reset_keys != null:
		UIIntermediary.resolve(_view._btn_reset_keys, "ui.fe15.keys.reset")
		UIIntermediary.resolve(_view._label_gamepad_hint, "ui.fe15.keys.gamepad_hint")

## 初始化语言 Tab：文案 + 四语言选项回填选中 locale
func init_language_tab() -> void:
	if _view == null:
		return
	var section: Label = _view.get_node_or_null("MainLayout/TabContainer/语言设置/SectionLabel")
	if section != null:
		UIIntermediary.resolve(section, "ui.fe15.language.section")
	var lang_label: Label = _view.get_node_or_null("MainLayout/TabContainer/语言设置/LanguageRow/Label")
	if lang_label != null:
		UIIntermediary.resolve(lang_label, "ui.fe15.language.label")
	if _view._btn_apply_language != null:
		UIIntermediary.resolve(_view._btn_apply_language, "ui.fe15.language.apply")
		_view._option_language.clear()
		var langs := [
			{"code": "zh_CN", "name_key": "ui.fe15.language.zh_CN"},
			{"code": "zh_TW", "name_key": "ui.fe15.language.zh_TW"},
			{"code": "en_US", "name_key": "ui.fe15.language.en_US"},
			{"code": "ja_JP", "name_key": "ui.fe15.language.ja_JP"},
		]
		for i in range(langs.size()):
			_view._option_language.add_item(UIIntermediary.text(langs[i]["name_key"]))
			if langs[i]["code"] == _view.selected_locale:
				_view._option_language.select(i)

## 初始化功能开关 Tab：文案 + 六开关回填默认值
func init_toggles_tab() -> void:
	if _view == null:
		return
	var section: Label = _view.get_node_or_null("MainLayout/TabContainer/功能开关/SectionLabel")
	if section != null:
		UIIntermediary.resolve(section, "ui.fe15.toggles.section")
	if _view._check_combat_numbers != null:
		UIIntermediary.resolve(_view._check_combat_numbers, "ui.fe15.toggles.combat_numbers")
		UIIntermediary.resolve(_view._check_floating_text, "ui.fe15.toggles.floating_text")
		UIIntermediary.resolve(_view._check_vibration, "ui.fe15.toggles.vibration")
		UIIntermediary.resolve(_view._check_auto_save, "ui.fe15.toggles.auto_save")
		UIIntermediary.resolve(_view._check_bloom, "ui.fe15.toggles.bloom")
		UIIntermediary.resolve(_view._check_motion_blur, "ui.fe15.toggles.motion_blur")

		_view._check_combat_numbers.button_pressed = _view.toggle_combat_numbers
		_view._check_floating_text.button_pressed = _view.toggle_floating_text
		_view._check_vibration.button_pressed = _view.toggle_vibration
		_view._check_auto_save.button_pressed = _view.toggle_auto_save
		_view._check_bloom.button_pressed = _view.toggle_bloom
		_view._check_motion_blur.button_pressed = _view.toggle_motion_blur

## 初始化关于 Tab：版本/引擎/版权文案（引擎版本动态读取）
func init_about_tab() -> void:
	if _view == null:
		return
	var section: Label = _view.get_node_or_null("MainLayout/TabContainer/关于/SectionLabel")
	if section != null:
		UIIntermediary.resolve(section, "ui.fe15.about.section")
	if _view._label_version != null:
		UIIntermediary.resolve(_view._label_version, "ui.fe15.about.version")
		UIIntermediary.resolve(_view._label_engine, "ui.fe15.about.engine", {"version": Engine.get_version_info()["string"]})
		UIIntermediary.resolve(_view._label_copyright, "ui.fe15.about.copyright")

# ==============================================================================
# 交互信号处理
# ==============================================================================

func refresh_volume_labels() -> void:
	if _view == null or _view._label_master_val == null:
		return
	UIIntermediary.resolve(_view._label_master_val, "ui.fe15.audio.volume_value", {"percent": int(_view.volume_master * 100)})
	UIIntermediary.resolve(_view._label_bgm_val, "ui.fe15.audio.volume_value", {"percent": int(_view.volume_bgm * 100)})
	UIIntermediary.resolve(_view._label_se_val, "ui.fe15.audio.volume_value", {"percent": int(_view.volume_se * 100)})

func on_master_volume_changed(value: float) -> void:
	if _view != null:
		_view.volume_master = value
		refresh_volume_labels()

func on_bgm_volume_changed(value: float) -> void:
	if _view != null:
		_view.volume_bgm = value
		refresh_volume_labels()

func on_se_volume_changed(value: float) -> void:
	if _view != null:
		_view.volume_se = value
		refresh_volume_labels()

func on_mute_master_toggled(checked: bool) -> void:
	if _view != null:
		_view.mute_master = checked
		if _view._slider_master != null:
			_view._slider_master.editable = not checked

func on_mute_bgm_toggled(checked: bool) -> void:
	if _view != null:
		_view.mute_bgm = checked
		if _view._slider_bgm != null:
			_view._slider_bgm.editable = not checked

func on_mute_se_toggled(checked: bool) -> void:
	if _view != null:
		_view.mute_se = checked
		if _view._slider_se != null:
			_view._slider_se.editable = not checked

func on_resolution_selected(index: int) -> void:
	if _view != null and _view._option_resolution != null:
		_view.selected_resolution = _view._option_resolution.get_item_text(index)

func on_quality_selected(index: int) -> void:
	if _view != null:
		var quality_keys := ["low", "medium", "high", "ultra"]
		if index >= 0 and index < quality_keys.size():
			_view.selected_quality = quality_keys[index]

func on_fullscreen_toggled(checked: bool) -> void:
	if _view != null:
		_view.is_fullscreen = checked

func on_vsync_toggled(checked: bool) -> void:
	if _view != null:
		_view.is_vsync = checked

func on_apply_graphics_pressed() -> void:
	start_revert_countdown()

func start_revert_countdown() -> void:
	if _view == null:
		return
	_view.is_in_resolution_revert_countdown = true
	_view.revert_seconds_remain = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)
	if _view._panel_revert_popup != null:
		_view._panel_revert_popup.visible = true

	if _view._revert_timer == null and _view.is_inside_tree():
		_view._revert_timer = Timer.new()
		_view._revert_timer.wait_time = 1.0
		_view._revert_timer.autostart = false
		_view._revert_timer.timeout.connect(on_revert_tick)
		_view.add_child(_view._revert_timer)
	if _view._revert_timer != null:
		_view._revert_timer.start()
	update_revert_label()

func on_revert_tick() -> void:
	if _view == null:
		return
	_view.revert_seconds_remain -= 1.0
	update_revert_label()
	if _view.revert_seconds_remain <= 0:
		on_revert_resolution_pressed()

func update_revert_label() -> void:
	if _view != null and _view._label_revert_countdown != null:
		UIIntermediary.resolve(_view._label_revert_countdown, "ui.fe15.graphics.revert_countdown", {"seconds": int(_view.revert_seconds_remain)})

func on_confirm_resolution_pressed() -> void:
	if _view == null:
		return
	_view.is_in_resolution_revert_countdown = false
	if _view._panel_revert_popup != null:
		_view._panel_revert_popup.visible = false
	if _view._revert_timer != null:
		_view._revert_timer.stop()

func on_revert_resolution_pressed() -> void:
	if _view == null:
		return
	_view.is_in_resolution_revert_countdown = false
	if _view._panel_revert_popup != null:
		_view._panel_revert_popup.visible = false
	if _view._revert_timer != null:
		_view._revert_timer.stop()
	_view.selected_resolution = "1920x1080"
	if _view._option_resolution != null:
		for i in range(_view._option_resolution.item_count):
			if _view._option_resolution.get_item_text(i) == _view.selected_resolution:
				_view._option_resolution.select(i)
				break

func on_reset_keys_pressed() -> void:
	if _view != null and _view._label_gamepad_hint != null:
		UIIntermediary.resolve(_view._label_gamepad_hint, "ui.fe15.keys.reset_hint")

func on_language_selected(index: int) -> void:
	if _view != null:
		var lang_codes := ["zh_CN", "zh_TW", "en_US", "ja_JP"]
		if index >= 0 and index < lang_codes.size():
			_view.selected_locale = lang_codes[index]

## 应用语言按钮：触发多语言热更换（UIIntermediary.switch_locale）
func on_apply_language_pressed() -> void:
	if _view == null or _view._option_language == null:
		return
	var idx: int = _view._option_language.selected
	var lang_codes := ["zh_CN", "zh_TW", "en_US", "ja_JP"]
	if idx >= 0 and idx < lang_codes.size():
		_view.selected_locale = lang_codes[idx]
		# 触发实时多语言就地热更换
		UIIntermediary.switch_locale(_view.selected_locale)

func on_toggle_combat_numbers(checked: bool) -> void:
	if _view != null: _view.toggle_combat_numbers = checked

func on_toggle_floating_text(checked: bool) -> void:
	if _view != null: _view.toggle_floating_text = checked

func on_toggle_vibration(checked: bool) -> void:
	if _view != null: _view.toggle_vibration = checked

func on_toggle_auto_save(checked: bool) -> void:
	if _view != null: _view.toggle_auto_save = checked

func on_toggle_bloom(checked: bool) -> void:
	if _view != null: _view.toggle_bloom = checked

func on_toggle_motion_blur(checked: bool) -> void:
	if _view != null: _view.toggle_motion_blur = checked

## 绑定各 Tab 信号
func connect_signals() -> void:
	if _view == null:
		return
	_view._slider_master.value_changed.connect(on_master_volume_changed)
	_view._slider_bgm.value_changed.connect(on_bgm_volume_changed)
	_view._slider_se.value_changed.connect(on_se_volume_changed)
	_view._check_mute_master.toggled.connect(on_mute_master_toggled)
	_view._check_mute_bgm.toggled.connect(on_mute_bgm_toggled)
	_view._check_mute_se.toggled.connect(on_mute_se_toggled)

	_view._option_resolution.item_selected.connect(on_resolution_selected)
	_view._option_quality.item_selected.connect(on_quality_selected)
	_view._check_fullscreen.toggled.connect(on_fullscreen_toggled)
	_view._check_vsync.toggled.connect(on_vsync_toggled)
	_view._btn_apply_graphics.pressed.connect(on_apply_graphics_pressed)
	_view._btn_confirm_resolution.pressed.connect(on_confirm_resolution_pressed)
	_view._btn_revert_resolution.pressed.connect(on_revert_resolution_pressed)

	_view._btn_reset_keys.pressed.connect(on_reset_keys_pressed)

	_view._option_language.item_selected.connect(on_language_selected)
	_view._btn_apply_language.pressed.connect(on_apply_language_pressed)

	_view._check_combat_numbers.toggled.connect(on_toggle_combat_numbers)
	_view._check_floating_text.toggled.connect(on_toggle_floating_text)
	_view._check_vibration.toggled.connect(on_toggle_vibration)
	_view._check_auto_save.toggled.connect(on_toggle_auto_save)
	_view._check_bloom.toggled.connect(on_toggle_bloom)
	_view._check_motion_blur.toggled.connect(on_toggle_motion_blur)
