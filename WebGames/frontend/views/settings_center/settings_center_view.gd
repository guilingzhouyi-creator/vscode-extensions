# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端第15卷: 设置中心系统视图控制器
# 文件路径: res://frontend/views/settings_center/settings_center_view.gd
# 职责: 音画视效滑块、分辨率15秒回滚倒计时框、按键重映射与多语言切换
#       骨架阶段：纯 UI 交互，不接 EventBus，所有逻辑本地闭环
# ==============================================================================
class_name SettingsCenterView
extends BaseScreen

const KTabBar = preload("res://frontend/components/k_tab_bar.gd")
const SettingsCenterTabsClass = preload("res://frontend/views/settings_center/settings_center_tabs.gd")

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

# 回滚倒计时计时器与子委托控制器
var _revert_timer: Timer
var _tabs = null

# ==============================================================================
# 公开交互方法（白模测试契约：滑块/分辨率倒计时/语言热切）
# ==============================================================================

## 白模测试契约桩：注入三路音量值（经统一快照入口）
func set_volumes(master: float, bgm: float, se: float) -> void:
	apply_snapshot({"volume_master": master , "volume_bgm": bgm, "volume_se": se})

## 统一快照渲染映射：音量三轨 → 视图状态
func _render_from_snapshot() -> void:
	if snapshot.has("volume_master"):
		volume_master = float(snapshot.get("volume_master", volume_master))
		volume_bgm = float(snapshot.get("volume_bgm", volume_bgm))
		volume_se = float(snapshot.get("volume_se", volume_se))
	if _tabs != null:
		_tabs.refresh_volume_labels()

## 白模测试契约桩：应用分辨率并启动 15 秒回滚倒计时
func apply_resolution_with_countdown(resolution: String) -> void:
	selected_resolution = resolution
	is_in_resolution_revert_countdown = true
	revert_seconds_remain = GameConfig.get_float("frontend.views", "fe15_settings_center/revert_timeout_seconds", 15.0)
	if _tabs != null:
		_tabs.start_revert_countdown()

## 白模测试契约桩：确认分辨率变更（终止回滚倒计时）
func confirm_resolution_change() -> void:
	is_in_resolution_revert_countdown = false
	if _tabs != null:
		_tabs.on_confirm_resolution_pressed()

## 白模测试契约桩：切换语言（记录并同步热切换）
func switch_locale(locale: String) -> void:
	selected_locale = locale
	UIIntermediary.switch_locale(locale)

# ==============================================================================
# 生命周期
# ==============================================================================

func _ready() -> void:
	_tabs = SettingsCenterTabsClass.new()
	_tabs.setup(self)

	_apply_theme()
	_init_all_text()
	_tabs.init_audio_tab()
	_tabs.init_graphics_tab()
	_tabs.init_keys_tab()
	_tabs.init_language_tab()
	_tabs.init_toggles_tab()
	_tabs.init_about_tab()
	_connect_signals()
	_tabs.connect_signals()
	UIIntermediary.adapt_view(self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		UIIntermediary.clear_view_bindings(self)

func _apply_theme() -> void:
	var tm := ThemeManager.get_instance()
	if tm.theme != null:
		theme = tm.theme

func _init_all_text() -> void:
	var title_label: Label = get_node_or_null("MainLayout/HeaderPanel/HeaderHBox/TitleLabel")
	if title_label != null:
		UIIntermediary.resolve(title_label, "ui.fe15.header.title")
	if _btn_back != null:
		UIIntermediary.resolve(_btn_back, "ui.fe15.header.back")
	if _tab_container != null:
		KTabBar.init_titles(_tab_container, PackedStringArray([
			"ui.fe15.tab.audio", "ui.fe15.tab.graphics", "ui.fe15.tab.keys",
			"ui.fe15.tab.language", "ui.fe15.tab.toggles", "ui.fe15.tab.about",
		]))

func _connect_signals() -> void:
	if _btn_back != null:
		_btn_back.pressed.connect(_on_back_pressed)
	if _tab_container != null:
		_tab_container.tab_changed.connect(_on_tab_changed)

func _on_tab_changed(tab_index: int) -> void:
	NavManager.get_instance().show_toast("切换设置分类", NavTypes.ToastLevel.INFO, 1.0)

func _on_back_pressed() -> void:
	self.back()
