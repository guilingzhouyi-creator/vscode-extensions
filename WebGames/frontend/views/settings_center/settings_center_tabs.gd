# ==============================================================================
# 模块归属: frontend.views.settings_center
# 文件路径: res://frontend/views/settings_center/settings_center_tabs.gd
# 架构定位: 设置中心标签页子控制器，负责六大设置分页的控件装配与交互处理
# 依赖与触发: 依赖 BaseScreen / UIIntermediary / GameConfig；由 SettingsCenterView 按生命周期调用
# 职责说明: 承接音频、画质、按键、多语言、功能开关与关于页面的初始化及信号回调
# 退出语义与设计依据: 随宿主视图同步销毁；标签状态变更写回宿主公共属性并同步刷新界面提示
# ==============================================================================
## 设置中心分页子控制器，封装音频、画质、按键、语言、开关与关于面板逻辑
class_name SettingsCenterTabs
extends BaseScreen

var _view: Variant = null

## 绑定宿主设置中心视图实例
func setup(host_view: BaseScreen) -> void:
	_view = host_view

# ==============================================================================
# 各 Tab 初始化
# ==============================================================================

## 初始化音频 Tab：文案 + 三路滑块/静音回填 + 音量标签刷新
func init_audio_tab() -> void:
	if _view == null:
		return
	var section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/SectionLabel")
	if section_label != null:
		UIIntermediary.resolve(section_label, "ui.fe15.audio.section")
	var master_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/MasterRow/Label")
	if master_label != null:
		UIIntermediary.resolve(master_label, "ui.fe15.audio.master")
	var background_music_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/BGMRow/Label")
	if background_music_label != null:
		UIIntermediary.resolve(background_music_label, "ui.fe15.audio.bgm")
	var sound_effect_label: Label = _view.get_node_or_null("MainLayout/TabContainer/音频设置/SERow/Label")
	if sound_effect_label != null:
		UIIntermediary.resolve(sound_effect_label, "ui.fe15.audio.se")
	if _view.check_mute_master != null:
		UIIntermediary.resolve(_view.check_mute_master, "ui.fe15.audio.mute")
		UIIntermediary.resolve(_view.check_mute_background_music, "ui.fe15.audio.mute")
		UIIntermediary.resolve(_view.check_mute_sound_effect, "ui.fe15.audio.mute")
		_view.slider_master.value = _view.volume_master
		_view.slider_background_music.value = _view.volume_bgm
		_view.slider_sound_effect.value = _view.volume_se
	refresh_volume_labels()

## 初始化画质 Tab：文案 + 分辨率/画质档位选项回填 + 全屏/垂直同步 + 回滚弹窗隐藏
func init_graphics_tab() -> void:
	if _view == null:
		return
	var section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/画质设置/SectionLabel")
	if section_label != null:
		UIIntermediary.resolve(section_label, "ui.fe15.graphics.section")
	var resolution_label: Label = _view.get_node_or_null("MainLayout/TabContainer/画质设置/ResolutionRow/Label")
	if resolution_label != null:
		UIIntermediary.resolve(resolution_label, "ui.fe15.graphics.resolution")
	var quality_label: Label = _view.get_node_or_null("MainLayout/TabContainer/画质设置/QualityRow/Label")
	if quality_label != null:
		UIIntermediary.resolve(quality_label, "ui.fe15.graphics.quality")
	if _view.check_fullscreen != null:
		UIIntermediary.resolve(_view.check_fullscreen, "ui.fe15.graphics.fullscreen")
		UIIntermediary.resolve(_view.check_vsync, "ui.fe15.graphics.vsync")
		UIIntermediary.resolve(_view.apply_graphics_button, "ui.fe15.graphics.apply")
		UIIntermediary.resolve(_view.confirm_resolution_button, "ui.fe15.graphics.confirm_resolution")
		UIIntermediary.resolve(_view.revert_resolution_button, "ui.fe15.graphics.revert_resolution")

		_view.option_resolution.clear()
		var resolutions := ["1280x720", "1920x1080", "2560x1440", "3840x2160"]
		for resolution_index in range(resolutions.size()):
			_view.option_resolution.add_item(resolutions[resolution_index])
			if resolutions[resolution_index] == _view.selected_resolution:
				_view.option_resolution.select(resolution_index)

		_view.option_quality.clear()
		var quality_keys := ["low", "medium", "high", "ultra"]
		for quality_index in range(quality_keys.size()):
			_view.option_quality.add_item(UIIntermediary.text("ui.fe15.graphics.quality_" + quality_keys[quality_index]))
			if quality_keys[quality_index] == _view.selected_quality:
				_view.option_quality.select(quality_index)

		_view.check_fullscreen.button_pressed = _view.is_fullscreen
		_view.check_vsync.button_pressed = _view.is_vsync
		_view.panel_revert_popup.visible = false

## 初始化按键 Tab：8 行按键标签 + 鼠标左键 + 重置按钮/手柄提示（i18n）
func init_keys_tab() -> void:
	if _view == null:
		return
	var section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/按键设置/SectionLabel")
	if section_label != null:
		UIIntermediary.resolve(section_label, "ui.fe15.keys.section")
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
	for key_row_entry in key_row_labels:
		var row_label: Label = _view.get_node_or_null(key_row_entry.path)
		if row_label != null:
			UIIntermediary.resolve(row_label, key_row_entry.key)
	var mouse_left_button: Button = _view.get_node_or_null(key_base + "/KeyRow5/KeyBtn")
	if mouse_left_button != null:
		UIIntermediary.resolve(mouse_left_button, "ui.fe15.keys.mouse_left")
	if _view.reset_keys_button != null:
		UIIntermediary.resolve(_view.reset_keys_button, "ui.fe15.keys.reset")
		UIIntermediary.resolve(_view.label_gamepad_hint, "ui.fe15.keys.gamepad_hint")

## 初始化语言 Tab：文案 + 四语言选项回填选中 locale
func init_language_tab() -> void:
	if _view == null:
		return
	var section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/语言设置/SectionLabel")
	if section_label != null:
		UIIntermediary.resolve(section_label, "ui.fe15.language.section")
	var language_label: Label = _view.get_node_or_null("MainLayout/TabContainer/语言设置/LanguageRow/Label")
	if language_label != null:
		UIIntermediary.resolve(language_label, "ui.fe15.language.label")
	if _view.apply_language_button != null:
		UIIntermediary.resolve(_view.apply_language_button, "ui.fe15.language.apply")
		_view.option_language.clear()
		var language_entries := [
			{"code": "zh_CN", "name_key": "ui.fe15.language.zh_CN"},
			{"code": "en_US", "name_key": "ui.fe15.language.en_US"},
		]
		for language_index in range(language_entries.size()):
			_view.option_language.add_item(UIIntermediary.text(language_entries[language_index]["name_key"]))
			if language_entries[language_index]["code"] == _view.selected_locale:
				_view.option_language.select(language_index)

## 初始化功能开关 Tab：文案 + 六开关回填默认值
func init_toggles_tab() -> void:
	if _view == null:
		return
	var section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/功能开关/SectionLabel")
	if section_label != null:
		UIIntermediary.resolve(section_label, "ui.fe15.toggles.section")
	if _view.check_combat_numbers != null:
		UIIntermediary.resolve(_view.check_combat_numbers, "ui.fe15.toggles.combat_numbers")
		UIIntermediary.resolve(_view.check_floating_text, "ui.fe15.toggles.floating_text")
		UIIntermediary.resolve(_view.check_vibration, "ui.fe15.toggles.vibration")
		UIIntermediary.resolve(_view.check_auto_save, "ui.fe15.toggles.auto_save")
		UIIntermediary.resolve(_view.check_bloom, "ui.fe15.toggles.bloom")
		UIIntermediary.resolve(_view.check_motion_blur, "ui.fe15.toggles.motion_blur")

		_view.check_combat_numbers.button_pressed = _view.toggle_combat_numbers
		_view.check_floating_text.button_pressed = _view.toggle_floating_text
		_view.check_vibration.button_pressed = _view.toggle_vibration
		_view.check_auto_save.button_pressed = _view.toggle_auto_save
		_view.check_bloom.button_pressed = _view.toggle_bloom
		_view.check_motion_blur.button_pressed = _view.toggle_motion_blur

## 初始化关于 Tab：版本握手读取/引擎/版权文案
func init_about_tab() -> void:
	if _view == null:
		return
	var section_label: Label = _view.get_node_or_null("MainLayout/TabContainer/关于/SectionLabel")
	if section_label != null:
		UIIntermediary.resolve(section_label, "ui.fe15.about.section")
	if _view.label_version != null:
		UIIntermediary.resolve(_view.label_version, "ui.fe15.about.version")
		UIIntermediary.resolve(_view.label_engine, "ui.fe15.about.engine", {"version": Engine.get_version_info()["string"]})
		UIIntermediary.resolve(_view.label_copyright, "ui.fe15.about.copyright")
		ServiceLocator.get_instance().version().check_version_async(func(version_reply: Dictionary) -> void:
			if _view == null or not is_instance_valid(_view) or _view.label_version == null:
				return
			var version_text := str(version_reply.get("version", version_reply.get("client_version", "")))
			if not version_text.is_empty():
				_view.label_version.text = "%s (%s)" % [UIIntermediary.text("ui.fe15.about.version"), version_text]
		)

# ==============================================================================
# 交互信号处理
# ==============================================================================

## 刷新三路音量百分比显示标签
func refresh_volume_labels() -> void:
	if _view == null or _view.label_master_value == null:
		return
	UIIntermediary.resolve(_view.label_master_value, "ui.fe15.audio.volume_value", {"percent": int(_view.volume_master * 100)})
	UIIntermediary.resolve(_view.label_background_music_value, "ui.fe15.audio.volume_value", {"percent": int(_view.volume_bgm * 100)})
	UIIntermediary.resolve(_view.label_sound_effect_value, "ui.fe15.audio.volume_value", {"percent": int(_view.volume_se * 100)})

func _apply_audio_bus_volume(linear_value: float) -> void:
	if AudioServer.get_bus_count() > 0:
		AudioServer.set_bus_volume_db(0, linear_to_db(clampf(linear_value, 0.001, 1.0)))

## 处理主音量滑块变化、同步音频总线并刷新显示标签
func on_master_volume_changed(volume_value: float) -> void:
	if _view != null:
		_view.volume_master = volume_value
		_apply_audio_bus_volume(volume_value)
		ServiceLocator.get_instance().game_settings().apply_settings_async("", "", {"volume_master": volume_value}, func(_reply: Dictionary) -> void:
			pass
		)
		refresh_volume_labels()

## 处理背景音乐音量滑块变化并刷新显示标签
func on_bgm_volume_changed(volume_value: float) -> void:
	if _view != null:
		_view.volume_bgm = volume_value
		refresh_volume_labels()

## 处理音效音量滑块变化并刷新显示标签
func on_se_volume_changed(volume_value: float) -> void:
	if _view != null:
		_view.volume_se = volume_value
		refresh_volume_labels()

## 切换主音量静音状态并锁定对应滑块
func on_mute_master_toggled(is_muted: bool) -> void:
	if _view != null:
		_view.mute_master = is_muted
		if _view.slider_master != null:
			_view.slider_master.editable = not is_muted

## 切换背景音乐静音状态并锁定对应滑块
func on_mute_bgm_toggled(is_muted: bool) -> void:
	if _view != null:
		_view.mute_bgm = is_muted
		if _view.slider_background_music != null:
			_view.slider_background_music.editable = not is_muted

## 切换音效静音状态并锁定对应滑块
func on_mute_se_toggled(is_muted: bool) -> void:
	if _view != null:
		_view.mute_se = is_muted
		if _view.slider_sound_effect != null:
			_view.slider_sound_effect.editable = not is_muted

## 更新当前选中的屏幕分辨率字符串
func on_resolution_selected(option_index: int) -> void:
	if _view != null and _view.option_resolution != null:
		_view.selected_resolution = _view.option_resolution.get_item_text(option_index)

## 更新当前选中的画质档位标识
func on_quality_selected(option_index: int) -> void:
	if _view != null:
		var quality_keys := ["low", "medium", "high", "ultra"]
		if option_index >= 0 and option_index < quality_keys.size():
			_view.selected_quality = quality_keys[option_index]

## 切换全屏显示状态开关
func on_fullscreen_toggled(is_enabled: bool) -> void:
	if _view != null:
		_view.is_fullscreen = is_enabled

## 切换垂直同步开关状态
func on_vsync_toggled(is_enabled: bool) -> void:
	if _view != null:
		_view.is_vsync = is_enabled

## 应用画质设置：持久化设置并弹出分辨率回滚确认倒计时
func on_apply_graphics_pressed() -> void:
	if _view != null:
		ServiceLocator.get_instance().game_settings().apply_settings_async("", "", {
			"resolution": _view.selected_resolution,
			"quality": _view.selected_quality,
			"fullscreen": _view.is_fullscreen,
			"vsync": _view.is_vsync,
		}, func(_reply: Dictionary) -> void:
			pass
		)
	start_revert_countdown()

## 启动分辨率变更回滚倒计时并显示确认弹窗
func start_revert_countdown() -> void:
	if _view == null:
		return
	_view.is_in_resolution_revert_countdown = true
	_view.revert_seconds_remain = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)
	if _view.panel_revert_popup != null:
		_view.panel_revert_popup.visible = true

	if _view.revert_timer == null and _view.is_inside_tree():
		_view.revert_timer = Timer.new()
		_view.revert_timer.wait_time = 1.0
		_view.revert_timer.autostart = false
		connect_managed(_view.revert_timer.timeout, on_revert_tick)
		_view.add_child(_view.revert_timer)
	if _view.revert_timer != null:
		_view.revert_timer.start()
	update_revert_label()

## 每秒递减回滚倒计时，归零时自动恢复默认分辨率
func on_revert_tick() -> void:
	if _view == null:
		return
	_view.revert_seconds_remain -= 1.0
	update_revert_label()
	if _view.revert_seconds_remain <= 0:
		on_revert_resolution_pressed()

## 刷新回滚弹窗剩余秒数提示文案
func update_revert_label() -> void:
	if _view != null and _view.label_revert_countdown != null:
		UIIntermediary.resolve(_view.label_revert_countdown, "ui.fe15.graphics.revert_countdown", {"seconds": int(_view.revert_seconds_remain)})

func _dismiss_revert_popup() -> void:
	_view.is_in_resolution_revert_countdown = false
	if _view.panel_revert_popup != null:
		_view.panel_revert_popup.visible = false
	if _view.revert_timer != null:
		_view.revert_timer.stop()

## 确认保留当前分辨率变更、持久化确认回执并关闭回滚弹窗
func on_confirm_resolution_pressed() -> void:
	if _view == null:
		return
	ServiceLocator.get_instance().game_settings().confirm_resolution_async("", "", func(_reply: Dictionary) -> void:
		pass
	)
	_dismiss_revert_popup()

## 回滚分辨率至默认 1920x1080 并关闭确认弹窗
func on_revert_resolution_pressed() -> void:
	if _view == null:
		return
	_dismiss_revert_popup()
	_view.selected_resolution = "1920x1080"
	if _view.option_resolution != null:
		for option_index in range(_view.option_resolution.item_count):
			if _view.option_resolution.get_item_text(option_index) == _view.selected_resolution:
				_view.option_resolution.select(option_index)
				break

## 重置按键绑定，调用设置重置服务并刷新手柄与键位重置提示
func on_reset_keys_pressed() -> void:
	ServiceLocator.get_instance().game_settings().reset_defaults_async("", "", func(_reply: Dictionary) -> void:
		pass
	)
	if _view != null and _view.label_gamepad_hint != null:
		UIIntermediary.resolve(_view.label_gamepad_hint, "ui.fe15.keys.reset_hint")

const _SUPPORTED_LOCALES: Array[String] = ["zh_CN", "en_US"]

## 记录下拉框选中的语言代码
func on_language_selected(option_index: int) -> void:
	if _view != null:
		if option_index >= 0 and option_index < _SUPPORTED_LOCALES.size():
			_view.selected_locale = _SUPPORTED_LOCALES[option_index]

## 应用语言按钮：触发多语言热更换（UIIntermediary.switch_locale）
func on_apply_language_pressed() -> void:
	if _view == null or _view.option_language == null:
		return
	var selected_index: int = _view.option_language.selected
	if selected_index >= 0 and selected_index < _SUPPORTED_LOCALES.size():
		_view.selected_locale = _SUPPORTED_LOCALES[selected_index]
		# 触发实时多语言就地热更换
		UIIntermediary.switch_locale(_view.selected_locale)

## 切换战斗伤害数字显示开关
func on_toggle_combat_numbers(is_enabled: bool) -> void:
	if _view != null:
		_view.toggle_combat_numbers = is_enabled

## 切换飘字提示显示开关
func on_toggle_floating_text(is_enabled: bool) -> void:
	if _view != null:
		_view.toggle_floating_text = is_enabled

## 切换手柄震动反馈开关
func on_toggle_vibration(is_enabled: bool) -> void:
	if _view != null:
		_view.toggle_vibration = is_enabled

## 切换自动存档功能开关
func on_toggle_auto_save(is_enabled: bool) -> void:
	if _view != null:
		_view.toggle_auto_save = is_enabled

## 切换泛光后处理开关
func on_toggle_bloom(is_enabled: bool) -> void:
	if _view != null:
		_view.toggle_bloom = is_enabled

## 切换动态模糊开关
func on_toggle_motion_blur(is_enabled: bool) -> void:
	if _view != null:
		_view.toggle_motion_blur = is_enabled

## 绑定各 Tab 信号
func connect_signals() -> void:
	if _view == null:
		return
	connect_managed(_view.slider_master.value_changed, on_master_volume_changed)
	connect_managed(_view.slider_background_music.value_changed, on_bgm_volume_changed)
	connect_managed(_view.slider_sound_effect.value_changed, on_se_volume_changed)
	connect_managed(_view.check_mute_master.toggled, on_mute_master_toggled)
	connect_managed(_view.check_mute_background_music.toggled, on_mute_bgm_toggled)
	connect_managed(_view.check_mute_sound_effect.toggled, on_mute_se_toggled)

	connect_managed(_view.option_resolution.item_selected, on_resolution_selected)
	connect_managed(_view.option_quality.item_selected, on_quality_selected)
	connect_managed(_view.check_fullscreen.toggled, on_fullscreen_toggled)
	connect_managed(_view.check_vsync.toggled, on_vsync_toggled)
	connect_managed(_view.apply_graphics_button.pressed, on_apply_graphics_pressed)
	connect_managed(_view.confirm_resolution_button.pressed, on_confirm_resolution_pressed)
	connect_managed(_view.revert_resolution_button.pressed, on_revert_resolution_pressed)

	connect_managed(_view.reset_keys_button.pressed, on_reset_keys_pressed)

	connect_managed(_view.option_language.item_selected, on_language_selected)
	connect_managed(_view.apply_language_button.pressed, on_apply_language_pressed)

	connect_managed(_view.check_combat_numbers.toggled, on_toggle_combat_numbers)
	connect_managed(_view.check_floating_text.toggled, on_toggle_floating_text)
	connect_managed(_view.check_vibration.toggled, on_toggle_vibration)
	connect_managed(_view.check_auto_save.toggled, on_toggle_auto_save)
	connect_managed(_view.check_bloom.toggled, on_toggle_bloom)
	connect_managed(_view.check_motion_blur.toggled, on_toggle_motion_blur)
