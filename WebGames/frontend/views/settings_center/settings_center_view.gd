# ==============================================================================
# 模块归属: frontend.views.settings_center
# 文件路径: res://frontend/views/settings_center/settings_center_view.gd
# 架构定位: 设置中心视图主控脚本，协调音画视效、分辨率回滚、按键重置与多语言切换
# 依赖与触发: 依赖 BaseScreen / KTabBar / SettingsCenterTabs / GameConfig；由视图生命周期触发
# 职责说明: 管理设置中心主界面控件与公共状态属性，并将各分页初始化与交互委托给标签控制器
# 退出语义与设计依据: 点击返回调用 back() 退出界面；本地设置修改先同步状态再触发界面提示
# ==============================================================================
## 设置中心主视图控制器，管理音频、画质、按键、多语言与功能开关面板
class_name SettingsCenterView
extends BaseScreen

const SettingsCenterTabsClass = preload("res://frontend/views/settings_center/settings_center_tabs.gd")

# ------------------------------------------------------------------------------
# 配置默认值（视图内常量默认配置，业务数值经 apply_snapshot 注入，不直读 GameConfig）
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
@onready var slider_master: HSlider = %SliderMasterVolume
@onready var slider_background_music: HSlider = %SliderBGMVolume
@onready var slider_sound_effect: HSlider = %SliderSEVolume
@onready var label_master_value: Label = %LabelMasterVal
@onready var label_background_music_value: Label = %LabelBGMVal
@onready var label_sound_effect_value: Label = %LabelSEVal
@onready var check_mute_master: CheckBox = %CheckMuteMaster
@onready var check_mute_background_music: CheckBox = %CheckMuteBGM
@onready var check_mute_sound_effect: CheckBox = %CheckMuteSE

# --- 画质设置 Tab ---
@onready var option_resolution: OptionButton = %OptionResolution
@onready var option_quality: OptionButton = %OptionQuality
@onready var check_fullscreen: CheckBox = %CheckFullscreen
@onready var check_vsync: CheckBox = %CheckVSync
@onready var apply_graphics_button: Button = %BtnApplyGraphics
@onready var panel_revert_popup: PanelContainer = %PanelRevertPopup
@onready var label_revert_countdown: Label = %LabelRevertCountdown
@onready var confirm_resolution_button: Button = %BtnConfirmResolution
@onready var revert_resolution_button: Button = %BtnRevertResolution

# --- 按键设置 Tab ---
@onready var reset_keys_button: Button = %BtnResetKeys
@onready var label_gamepad_hint: Label = %LabelGamepadHint

# --- 语言设置 Tab ---
@onready var option_language: OptionButton = %OptionLanguage
@onready var apply_language_button: Button = %BtnApplyLanguage

# --- 功能开关 Tab ---
@onready var check_combat_numbers: CheckBox = %CheckCombatNumbers
@onready var check_floating_text: CheckBox = %CheckFloatingText
@onready var check_vibration: CheckBox = %CheckVibration
@onready var check_auto_save: CheckBox = %CheckAutoSave
@onready var check_bloom: CheckBox = %CheckBloom
@onready var check_motion_blur: CheckBox = %CheckMotionBlur

# --- 关于 Tab ---
@onready var label_version: Label = %LabelVersion
@onready var label_engine: Label = %LabelEngine
@onready var label_copyright: Label = %LabelCopyright

# --- 全局 ---
@onready var _back_button: Button = %BtnBack

# 回滚倒计时计时器与子委托控制器
var revert_timer: Timer
var _tabs: Variant = null

# ==============================================================================
# 公开交互方法（外部视图契约：滑块/分辨率倒计时/语言热切）
# ==============================================================================

## 注入三路音量值（经统一快照入口刷新状态）
func set_volumes(master_volume: float, background_music_volume: float, sound_effect_volume: float) -> void:
	apply_snapshot({"volume_master": master_volume, "volume_bgm": background_music_volume, "volume_se": sound_effect_volume})

## 统一快照渲染映射：音量三轨 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("volume_master"):
		volume_master = float(snapshot.get("volume_master", volume_master))
		volume_bgm = float(snapshot.get("volume_bgm", volume_bgm))
		volume_se = float(snapshot.get("volume_se", volume_se))
	if _tabs != null:
		_tabs.refresh_volume_labels()

## 应用分辨率并启动 15 秒回滚倒计时
func apply_resolution_with_countdown(resolution: String) -> void:
	selected_resolution = resolution
	is_in_resolution_revert_countdown = true
	revert_seconds_remain = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)
	if _tabs != null:
		_tabs.start_revert_countdown()

## 确认分辨率变更并终止回滚倒计时
func confirm_resolution_change() -> void:
	is_in_resolution_revert_countdown = false
	ServiceLocator.get_instance().game_settings().confirm_resolution_async("", "", func(_confirm_reply: Dictionary) -> void:
		pass
	)
	if _tabs != null:
		_tabs.on_confirm_resolution_pressed()

## 切换语言记录并同步触发实时热切换与设置持久化
func switch_locale(locale: String) -> void:
	selected_locale = locale
	UIIntermediary.switch_locale(locale)
	ServiceLocator.get_instance().game_settings().apply_settings_async("", "", {"locale": locale}, func(_apply_reply: Dictionary) -> void:
		pass
	)

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	_tabs = _register_owned_subcontroller(SettingsCenterTabsClass.new())
	_tabs.setup(self)

	_apply_theme()
	_init_all_text()
	ServiceLocator.get_instance().game_settings().get_settings_async("", "", func(settings_reply: Dictionary) -> void:
		var settings_map: Dictionary = settings_reply.get("settings", settings_reply.get("data", settings_reply)) as Dictionary
		if bool(settings_reply.get("success", false)) and not settings_map.is_empty():
			apply_snapshot(settings_map)
	)
	_tabs.init_audio_tab()
	_tabs.init_graphics_tab()
	_tabs.init_keys_tab()
	_tabs.init_language_tab()
	_tabs.init_toggles_tab()
	_tabs.init_about_tab()
	_connect_signals()
	_tabs.connect_signals()
	UIIntermediary.adapt_view(self)

func _apply_theme() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme

func _init_all_text() -> void:
	var title_label: Label = get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel")
	if title_label != null:
		UIIntermediary.resolve(title_label, "ui.fe15.header.title")
	if _back_button != null:
		UIIntermediary.resolve(_back_button, "ui.fe15.header.back")
	if _tab_container != null:
		KTabBar.init_titles(_tab_container, PackedStringArray([
			"ui.fe15.tab.audio", "ui.fe15.tab.graphics", "ui.fe15.tab.keys",
			"ui.fe15.tab.language", "ui.fe15.tab.toggles", "ui.fe15.tab.about",
		]))

func _connect_signals() -> void:
	if _back_button != null:
		connect_managed(_back_button.pressed, _on_back_pressed)
	if _tab_container != null:
		connect_managed(_tab_container.tab_changed, _on_tab_changed)

func _on_tab_changed(tab_index: int) -> void:
	if tab_index == 0 and _tabs != null:
		_tabs.refresh_volume_labels()
	elif tab_index == 5 and _tabs != null:
		_tabs.init_about_tab()

func _on_back_pressed() -> void:
	self.back()
