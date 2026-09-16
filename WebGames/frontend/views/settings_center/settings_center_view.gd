# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第15卷: 设置中心系统视图控制器
# 文件路径: res://frontend/views/settings_center/settings_center_view.gd
# 职责: 音画视效滑块、分辨率15秒回滚倒计时框、按键重映射与多语言切换
#       骨架阶段：纯 UI 交互，不接 EventBus，所有逻辑本地闭环
# ==============================================================================
class_name SettingsCenterView
extends BaseScreen

# ------------------------------------------------------------------------------
# 配置默认值（骨架阶段视图内常量兜底，业务数值经 apply_snapshot 注入，不直读 GameConfig）
# ------------------------------------------------------------------------------
var volume_master: float = 1.0
var volume_bgm: float = 0.8
var volume_se: float = 1.0

var mute_master: bool = false
var mute_bgm: bool = false
var mute_se: bool = false

var selected_resolution: String = "1920x1080"
var selected_quality: String = "high"
var is_fullscreen: bool = false
var is_vsync: bool = true
var is_in_resolution_revert_countdown: bool = false
var revert_seconds_remain: float = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)

var selected_locale: String = "zh_CN"

# 功能开关默认值
var toggle_combat_numbers: bool = true
var toggle_floating_text: bool = true
var toggle_vibration: bool = true
var toggle_auto_save: bool = true
var toggle_bloom: bool = false
var toggle_motion_blur: bool = false

# ------------------------------------------------------------------------------
# 节点引用（通过 unique_name_in_owner 获取）
# ------------------------------------------------------------------------------
@onready var _tab_container: TabContainer = %TabContainer

# --- 音频设置 Tab ---
@onready var _slider_master: HSlider = %SliderMasterVolume
@onready var _slider_bgm: HSlider = %SliderBGMVolume
@onready var _slider_se: HSlider = %SliderSEVolume
@onready var _label_master_val: Label = %LabelMasterVal
@onready var _label_bgm_val: Label = %LabelBGMVal
@onready var _label_se_val: Label = %LabelSEVal
@onready var _check_mute_master: CheckBox = %CheckMuteMaster
@onready var _check_mute_bgm: CheckBox = %CheckMuteBGM
@onready var _check_mute_se: CheckBox = %CheckMuteSE

# --- 画质设置 Tab ---
@onready var _option_resolution: OptionButton = %OptionResolution
@onready var _option_quality: OptionButton = %OptionQuality
@onready var _check_fullscreen: CheckBox = %CheckFullscreen
@onready var _check_vsync: CheckBox = %CheckVSync
@onready var _btn_apply_graphics: Button = %BtnApplyGraphics
@onready var _panel_revert_popup: PanelContainer = %PanelRevertPopup
@onready var _label_revert_countdown: Label = %LabelRevertCountdown
@onready var _btn_confirm_resolution: Button = %BtnConfirmResolution
@onready var _btn_revert_resolution: Button = %BtnRevertResolution

# --- 按键设置 Tab ---
@onready var _btn_reset_keys: Button = %BtnResetKeys
@onready var _label_gamepad_hint: Label = %LabelGamepadHint

# --- 语言设置 Tab ---
@onready var _option_language: OptionButton = %OptionLanguage
@onready var _btn_apply_language: Button = %BtnApplyLanguage

# --- 功能开关 Tab ---
@onready var _check_combat_numbers: CheckBox = %CheckCombatNumbers
@onready var _check_floating_text: CheckBox = %CheckFloatingText
@onready var _check_vibration: CheckBox = %CheckVibration
@onready var _check_auto_save: CheckBox = %CheckAutoSave
@onready var _check_bloom: CheckBox = %CheckBloom
@onready var _check_motion_blur: CheckBox = %CheckMotionBlur

# --- 关于 Tab ---
@onready var _label_version: Label = %LabelVersion
@onready var _label_engine: Label = %LabelEngine
@onready var _label_copyright: Label = %LabelCopyright

# --- 全局 ---
@onready var _btn_back: Button = %BtnBack

# 回滚倒计时计时器
var _revert_timer: Timer

# ==============================================================================
# 公开交互方法（白模测试契约：滑块/分辨率倒计时/语言热切）
# ==============================================================================

## 白模测试契约桩：注入三路音量值（经统一快照入口）
func set_volumes(master: float, bgm: float, se: float) -> void:
	apply_snapshot({"volume_master": master, "volume_bgm": bgm, "volume_se": se})

## 统一快照渲染映射（P81）：音量三轨 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("volume_master"):
		volume_master = float(snapshot.get("volume_master", volume_master))
		volume_bgm = float(snapshot.get("volume_bgm", volume_bgm))
		volume_se = float(snapshot.get("volume_se", volume_se))

## 白模测试契约桩：应用分辨率并启动 15 秒回滚倒计时
func apply_resolution_with_countdown(resolution: String) -> void:
	selected_resolution = resolution
	is_in_resolution_revert_countdown = true
	revert_seconds_remain = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)

## 白模测试契约桩：确认分辨率变更（终止回滚倒计时）
func confirm_resolution_change() -> void:
	is_in_resolution_revert_countdown = false

## 白模测试契约桩：切换语言（仅记录选中 locale）
func switch_locale(locale: String) -> void:
	selected_locale = locale

# ==============================================================================
# 生命周期
# ==============================================================================
## 生命周期初始化：主题/六 Tab 装配/信号绑定/视觉适配（骨架零接线）
func _ready() -> void:
	_apply_theme()
	_init_all_text()
	_init_audio_tab()
	_init_graphics_tab()
	_init_keys_tab()
	_init_language_tab()
	_init_toggles_tab()
	_init_about_tab()
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
# 静态文案初始化（头部标题 + Tab 标题）
# ==============================================================================
## 初始化头部标题/返回按钮与六 Tab 标题（i18n 全驱动）
func _init_all_text() -> void:
	# 头部标题与返回按钮
	var title_label: Label = $"MainLayout/HeaderPanel/HeaderHBox/TitleLabel"
	UIIntermediary.resolve(title_label, "ui.fe15.header.title")
	UIIntermediary.resolve(_btn_back, "ui.fe15.header.back")
	# Tab 标题
	UIIntermediary.resolve_tab(_tab_container, 0, "ui.fe15.tab.audio")
	UIIntermediary.resolve_tab(_tab_container, 1, "ui.fe15.tab.graphics")
	UIIntermediary.resolve_tab(_tab_container, 2, "ui.fe15.tab.keys")
	UIIntermediary.resolve_tab(_tab_container, 3, "ui.fe15.tab.language")
	UIIntermediary.resolve_tab(_tab_container, 4, "ui.fe15.tab.toggles")
	UIIntermediary.resolve_tab(_tab_container, 5, "ui.fe15.tab.about")

# ==============================================================================
# 信号绑定（零接线：所有信号在本地脚本闭环，不接 EventBus）
# ==============================================================================
## 绑定本地 UI 交互信号（零接线：音频/画质/按键/语言/功能开关全部本地闭环）
func _connect_signals() -> void:
	# 返回按钮
	_btn_back.pressed.connect(_on_back_pressed)

	# Tab 切换
	_tab_container.tab_changed.connect(_on_tab_changed)

	# 音频
	_slider_master.value_changed.connect(_on_master_volume_changed)
	_slider_bgm.value_changed.connect(_on_bgm_volume_changed)
	_slider_se.value_changed.connect(_on_se_volume_changed)
	_check_mute_master.toggled.connect(_on_mute_master_toggled)
	_check_mute_bgm.toggled.connect(_on_mute_bgm_toggled)
	_check_mute_se.toggled.connect(_on_mute_se_toggled)

	# 画质
	_option_resolution.item_selected.connect(_on_resolution_selected)
	_option_quality.item_selected.connect(_on_quality_selected)
	_check_fullscreen.toggled.connect(_on_fullscreen_toggled)
	_check_vsync.toggled.connect(_on_vsync_toggled)
	_btn_apply_graphics.pressed.connect(_on_apply_graphics_pressed)
	_btn_confirm_resolution.pressed.connect(_on_confirm_resolution_pressed)
	_btn_revert_resolution.pressed.connect(_on_revert_resolution_pressed)

	# 按键
	_btn_reset_keys.pressed.connect(_on_reset_keys_pressed)

	# 语言
	_option_language.item_selected.connect(_on_language_selected)
	_btn_apply_language.pressed.connect(_on_apply_language_pressed)

	# 功能开关
	_check_combat_numbers.toggled.connect(_on_toggle_combat_numbers)
	_check_floating_text.toggled.connect(_on_toggle_floating_text)
	_check_vibration.toggled.connect(_on_toggle_vibration)
	_check_auto_save.toggled.connect(_on_toggle_auto_save)
	_check_bloom.toggled.connect(_on_toggle_bloom)
	_check_motion_blur.toggled.connect(_on_toggle_motion_blur)

# ==============================================================================
# 各 Tab 初始化
# ==============================================================================
## 初始化音频 Tab：文案 + 三路滑块/静音回填 + 音量标签刷新
func _init_audio_tab() -> void:
	# 文案
	var section: Label = $"MainLayout/TabContainer/音频设置/SectionLabel"
	UIIntermediary.resolve(section, "ui.fe15.audio.section")
	var master_label: Label = $"MainLayout/TabContainer/音频设置/MasterRow/Label"
	UIIntermediary.resolve(master_label, "ui.fe15.audio.master")
	var bgm_label: Label = $"MainLayout/TabContainer/音频设置/BGMRow/Label"
	UIIntermediary.resolve(bgm_label, "ui.fe15.audio.bgm")
	var se_label: Label = $"MainLayout/TabContainer/音频设置/SERow/Label"
	UIIntermediary.resolve(se_label, "ui.fe15.audio.se")
	UIIntermediary.resolve(_check_mute_master, "ui.fe15.audio.mute")
	UIIntermediary.resolve(_check_mute_bgm, "ui.fe15.audio.mute")
	UIIntermediary.resolve(_check_mute_se, "ui.fe15.audio.mute")
	# 数据
	_slider_master.value = volume_master
	_slider_bgm.value = volume_bgm
	_slider_se.value = volume_se
	_refresh_volume_labels()

## 初始化画质 Tab：文案 + 分辨率/画质档位选项回填 + 全屏/垂直同步 + 回滚弹窗隐藏
func _init_graphics_tab() -> void:
	# 文案
	var section: Label = $"MainLayout/TabContainer/画质设置/SectionLabel"
	UIIntermediary.resolve(section, "ui.fe15.graphics.section")
	var resolution_label: Label = $"MainLayout/TabContainer/画质设置/ResolutionRow/Label"
	UIIntermediary.resolve(resolution_label, "ui.fe15.graphics.resolution")
	var quality_label: Label = $"MainLayout/TabContainer/画质设置/QualityRow/Label"
	UIIntermediary.resolve(quality_label, "ui.fe15.graphics.quality")
	UIIntermediary.resolve(_check_fullscreen, "ui.fe15.graphics.fullscreen")
	UIIntermediary.resolve(_check_vsync, "ui.fe15.graphics.vsync")
	UIIntermediary.resolve(_btn_apply_graphics, "ui.fe15.graphics.apply")
	UIIntermediary.resolve(_btn_confirm_resolution, "ui.fe15.graphics.confirm_resolution")
	UIIntermediary.resolve(_btn_revert_resolution, "ui.fe15.graphics.revert_resolution")
	# 分辨率选项
	_option_resolution.clear()
	var resolutions := ["1280x720", "1920x1080", "2560x1440", "3840x2160"]
	for i in range(resolutions.size()):
		_option_resolution.add_item(resolutions[i])
		if resolutions[i] == selected_resolution:
			_option_resolution.select(i)
	# 画质档位
	_option_quality.clear()
	var quality_keys := ["low", "medium", "high", "ultra"]
	for i in range(quality_keys.size()):
		_option_quality.add_item(UIIntermediary.text("ui.fe15.graphics.quality_" + quality_keys[i]))
		if quality_keys[i] == selected_quality:
			_option_quality.select(i)
	_check_fullscreen.button_pressed = is_fullscreen
	_check_vsync.button_pressed = is_vsync
	# 回滚弹窗默认隐藏
	_panel_revert_popup.visible = false

## 初始化按键 Tab：8 行按键标签 + 鼠标左键 + 重置按钮/手柄提示（i18n）
func _init_keys_tab() -> void:
	# 文案
	var section: Label = $"MainLayout/TabContainer/按键设置/SectionLabel"
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
		var lbl: Label = get_node(entry.path)
		UIIntermediary.resolve(lbl, entry.key)
	# 鼠标左键按钮
	var mouse_left_btn: Button = get_node(key_base + "/KeyRow5/KeyBtn")
	UIIntermediary.resolve(mouse_left_btn, "ui.fe15.keys.mouse_left")
	# 重置按钮与手柄提示
	UIIntermediary.resolve(_btn_reset_keys, "ui.fe15.keys.reset")
	UIIntermediary.resolve(_label_gamepad_hint, "ui.fe15.keys.gamepad_hint")

## 初始化语言 Tab：文案 + 四语言选项回填选中 locale
func _init_language_tab() -> void:
	# 文案
	var section: Label = $"MainLayout/TabContainer/语言设置/SectionLabel"
	UIIntermediary.resolve(section, "ui.fe15.language.section")
	var lang_label: Label = $"MainLayout/TabContainer/语言设置/LanguageRow/Label"
	UIIntermediary.resolve(lang_label, "ui.fe15.language.label")
	UIIntermediary.resolve(_btn_apply_language, "ui.fe15.language.apply")
	# 语言选项
	_option_language.clear()
	var langs := [
		{"code": "zh_CN", "name_key": "ui.fe15.language.zh_CN"},
		{"code": "zh_TW", "name_key": "ui.fe15.language.zh_TW"},
		{"code": "en_US", "name_key": "ui.fe15.language.en_US"},
		{"code": "ja_JP", "name_key": "ui.fe15.language.ja_JP"},
	]
	for i in range(langs.size()):
		_option_language.add_item(UIIntermediary.text(langs[i]["name_key"]))
		if langs[i]["code"] == selected_locale:
			_option_language.select(i)

## 初始化功能开关 Tab：文案 + 六开关回填默认值
func _init_toggles_tab() -> void:
	# 文案
	var section: Label = $"MainLayout/TabContainer/功能开关/SectionLabel"
	UIIntermediary.resolve(section, "ui.fe15.toggles.section")
	UIIntermediary.resolve(_check_combat_numbers, "ui.fe15.toggles.combat_numbers")
	UIIntermediary.resolve(_check_floating_text, "ui.fe15.toggles.floating_text")
	UIIntermediary.resolve(_check_vibration, "ui.fe15.toggles.vibration")
	UIIntermediary.resolve(_check_auto_save, "ui.fe15.toggles.auto_save")
	UIIntermediary.resolve(_check_bloom, "ui.fe15.toggles.bloom")
	UIIntermediary.resolve(_check_motion_blur, "ui.fe15.toggles.motion_blur")
	# 数据
	_check_combat_numbers.button_pressed = toggle_combat_numbers
	_check_floating_text.button_pressed = toggle_floating_text
	_check_vibration.button_pressed = toggle_vibration
	_check_auto_save.button_pressed = toggle_auto_save
	_check_bloom.button_pressed = toggle_bloom
	_check_motion_blur.button_pressed = toggle_motion_blur

## 初始化关于 Tab：版本/引擎/版权文案（引擎版本动态读取）
func _init_about_tab() -> void:
	# 文案
	var section: Label = $"MainLayout/TabContainer/关于/SectionLabel"
	UIIntermediary.resolve(section, "ui.fe15.about.section")
	UIIntermediary.resolve(_label_version, "ui.fe15.about.version")
	UIIntermediary.resolve(_label_engine, "ui.fe15.about.engine", {"version": Engine.get_version_info()["string"]})
	UIIntermediary.resolve(_label_copyright, "ui.fe15.about.copyright")

# ==============================================================================
# 音频 Tab 信号处理
# ==============================================================================
## 主音量滑块变化：更新状态并刷新音量标签
func _on_master_volume_changed(value: float) -> void:
	volume_master = value
	_refresh_volume_labels()

## BGM 音量滑块变化：更新状态并刷新音量标签
func _on_bgm_volume_changed(value: float) -> void:
	volume_bgm = value
	_refresh_volume_labels()

## SE 音量滑块变化：更新状态并刷新音量标签
func _on_se_volume_changed(value: float) -> void:
	volume_se = value
	_refresh_volume_labels()

## 主静音开关：更新状态并锁止主音量滑块
func _on_mute_master_toggled(checked: bool) -> void:
	mute_master = checked
	_slider_master.editable = not checked

## BGM 静音开关：更新状态并锁止 BGM 滑块
func _on_mute_bgm_toggled(checked: bool) -> void:
	mute_bgm = checked
	_slider_bgm.editable = not checked

## SE 静音开关：更新状态并锁止 SE 滑块
func _on_mute_se_toggled(checked: bool) -> void:
	mute_se = checked
	_slider_se.editable = not checked

## 刷新三路音量百分比标签
func _refresh_volume_labels() -> void:
	UIIntermediary.resolve(_label_master_val, "ui.fe15.audio.volume_value", {"percent": int(volume_master * 100)})
	UIIntermediary.resolve(_label_bgm_val, "ui.fe15.audio.volume_value", {"percent": int(volume_bgm * 100)})
	UIIntermediary.resolve(_label_se_val, "ui.fe15.audio.volume_value", {"percent": int(volume_se * 100)})

# ==============================================================================
# 画质 Tab 信号处理
# ==============================================================================
## 分辨率选项选中：记录所选分辨率
func _on_resolution_selected(index: int) -> void:
	selected_resolution = _option_resolution.get_item_text(index)

## 画质档位选中：记录所选画质档
func _on_quality_selected(index: int) -> void:
	var quality_keys := ["low", "medium", "high", "ultra"]
	if index >= 0 and index < quality_keys.size():
		selected_quality = quality_keys[index]

## 全屏开关：记录状态
func _on_fullscreen_toggled(checked: bool) -> void:
	is_fullscreen = checked

## 垂直同步开关：记录状态
func _on_vsync_toggled(checked: bool) -> void:
	is_vsync = checked

## 应用画质按钮：骨架阶段触发 15 秒回滚倒计时
func _on_apply_graphics_pressed() -> void:
	# 骨架阶段：触发 15 秒回滚倒计时弹窗
	_start_revert_countdown()

## 启动分辨率回滚倒计时：置倒计时态、显示弹窗、懒建并启动 1s 计时器
func _start_revert_countdown() -> void:
	is_in_resolution_revert_countdown = true
	revert_seconds_remain = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)
	_panel_revert_popup.visible = true

	if _revert_timer == null:
		_revert_timer = Timer.new()
		_revert_timer.wait_time = 1.0
		_revert_timer.autostart = false
		_revert_timer.timeout.connect(_on_revert_tick)
		add_child(_revert_timer)
	_revert_timer.start()

	_update_revert_label()

## 倒计时秒针：递减并刷新标签，归零触发回滚
func _on_revert_tick() -> void:
	revert_seconds_remain -= 1.0
	_update_revert_label()
	if revert_seconds_remain <= 0:
		_on_revert_resolution_pressed()

## 刷新回滚倒计时标签（剩余秒数）
func _update_revert_label() -> void:
	UIIntermediary.resolve(_label_revert_countdown, "ui.fe15.graphics.revert_countdown", {"seconds": int(revert_seconds_remain)})

## 确认分辨率：终止倒计时并隐藏弹窗、停表
func _on_confirm_resolution_pressed() -> void:
	is_in_resolution_revert_countdown = false
	_panel_revert_popup.visible = false
	if _revert_timer != null:
		_revert_timer.stop()

## 回滚分辨率：终止倒计时、隐藏弹窗、重置为默认分辨率（骨架桩）
func _on_revert_resolution_pressed() -> void:
	is_in_resolution_revert_countdown = false
	_panel_revert_popup.visible = false
	if _revert_timer != null:
		_revert_timer.stop()
	# 骨架阶段：回滚到之前的分辨率（此处仅重置选项为默认值）
	selected_resolution = "1920x1080"
	for i in range(_option_resolution.item_count):
		if _option_resolution.get_item_text(i) == selected_resolution:
			_option_resolution.select(i)
			break

# ==============================================================================
# 按键 Tab 信号处理
# ==============================================================================
## 重置按键按钮：骨架阶段仅刷新手柄提示文案
func _on_reset_keys_pressed() -> void:
	# 骨架阶段：重置按键提示
	UIIntermediary.resolve(_label_gamepad_hint, "ui.fe15.keys.reset_hint")

# ==============================================================================
# 语言 Tab 信号处理
# ==============================================================================
## 语言选项选中：骨架阶段仅记录选择不立即切换（占位）
func _on_language_selected(index: int) -> void:
	var lang_codes := ["zh_CN", "zh_TW", "en_US", "ja_JP"]
	if index >= 0 and index < lang_codes.size():
		selected_locale = lang_codes[index]

## 应用语言按钮：骨架阶段仅更新内部 locale 状态
func _on_apply_language_pressed() -> void:
	var idx := _option_language.selected
	# 骨架阶段：仅更新内部状态
	var lang_codes := ["zh_CN", "zh_TW", "en_US", "ja_JP"]
	if idx >= 0 and idx < lang_codes.size():
		selected_locale = lang_codes[idx]

# ==============================================================================
# 功能开关 Tab 信号处理
# ==============================================================================
## 战斗数字开关：记录状态
func _on_toggle_combat_numbers(checked: bool) -> void:
	toggle_combat_numbers = checked

## 飘字开关：记录状态
func _on_toggle_floating_text(checked: bool) -> void:
	toggle_floating_text = checked

## 震动开关：记录状态
func _on_toggle_vibration(checked: bool) -> void:
	toggle_vibration = checked

## 自动存档开关：记录状态
func _on_toggle_auto_save(checked: bool) -> void:
	toggle_auto_save = checked

## 泛光效果开关：记录状态
func _on_toggle_bloom(checked: bool) -> void:
	toggle_bloom = checked

## 动态模糊开关：记录状态
func _on_toggle_motion_blur(checked: bool) -> void:
	toggle_motion_blur = checked

# ==============================================================================
# 全局信号处理
# ==============================================================================
## 主 Tab 切换：骨架阶段占位（预留）
func _on_tab_changed(tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换设置分类", NavTypes.ToastLevel.INFO, 1.0)

## 返回按钮：经 ViewRouter 弹出视图回退上一级
func _on_back_pressed() -> void:
	# 右下角返回按钮：通过 ViewRouter 返回上一视图
	var router := ViewRouter.get_instance()
	if router != null:
		router.pop_view()
