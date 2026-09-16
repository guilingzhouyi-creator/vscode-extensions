# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端设计系统: 设计令牌规范 (Design Tokens)
# 文件路径: res://frontend/theme/design_tokens.gd
# 职责: 集中定义全域色彩语义、8px 栅格间距、排版字阶、动效时长与视口层级常量，
#       消灭所有前端业务组件与场景中的魔法值硬编码。
# ==============================================================================
class_name DesignTokens
extends RefCounted

# ==============================================================================
# 一、语义色彩体系 (Semantic Colors)
# ==============================================================================

# 主色与交互高亮
const COLOR_PRIMARY: Color = Color(0.29, 0.45, 0.70, 1.0)        # #4A72B2
const COLOR_PRIMARY_HOVER: Color = Color(0.36, 0.52, 0.77, 1.0)  # #5B84C4
const COLOR_ACCENT_GOLD: Color = Color(1.0, 0.84, 0.0, 1.0)       # #FFD700
const COLOR_ACCENT_CRIT: Color = Color(1.0, 0.30, 0.30, 1.0)      # #FF4D4D

# 状态反馈色
const COLOR_SUCCESS: Color = Color(0.32, 0.77, 0.10, 1.0)         # #52C41A
const COLOR_WARNING: Color = Color(0.98, 0.68, 0.08, 1.0)         # #FAAD14
const COLOR_ERROR: Color = Color(0.96, 0.13, 0.18, 1.0)           # #F5222D
const COLOR_INFO: Color = Color(0.09, 0.56, 1.0, 1.0)             # #1890FF

# 文本梯度色
const COLOR_TEXT_PRIMARY: Color = Color(1.0, 1.0, 1.0, 1.0)       # #FFFFFF
const COLOR_TEXT_SECONDARY: Color = Color(0.69, 0.70, 0.72, 1.0)  # #B0B3B8
const COLOR_TEXT_MUTED: Color = Color(0.40, 0.40, 0.42, 1.0)      # #65676B
const COLOR_TEXT_DISABLED: Color = Color(0.31, 0.31, 0.31, 1.0)   # #4E4F50

# 表面底色与卡片
const COLOR_SURFACE_BASE: Color = Color(0.12, 0.12, 0.14, 1.0)    # #1E1E24
const COLOR_SURFACE_PANEL: Color = Color(0.16, 0.17, 0.20, 1.0)   # #2A2B32
const COLOR_SURFACE_CARD: Color = Color(0.20, 0.21, 0.24, 1.0)    # #33353E
const COLOR_BACKDROP_MASK: Color = Color(0.0, 0.0, 0.0, 0.65)     # 65% 半透明黑色遮罩

# 道具品质色阶 (白/绿/蓝/紫/橙)
const COLOR_QUALITY_COMMON: Color = Color(0.75, 0.75, 0.75, 1.0)
const COLOR_QUALITY_UNCOMMON: Color = Color(0.20, 0.80, 0.30, 1.0)
const COLOR_QUALITY_RARE: Color = Color(0.20, 0.50, 1.0, 1.0)
const COLOR_QUALITY_EPIC: Color = Color(0.65, 0.25, 0.95, 1.0)
const COLOR_QUALITY_LEGENDARY: Color = Color(1.0, 0.55, 0.0, 1.0)

# ── 主题兜底色板（R-18 单一真源）─────────────────────────────────────────────
# ThemeManager 的 DEFAULT_* 与 views 的展示语义色一律引用本组，杜绝各自复写；
# 取值与收敛前逐位一致，保证 A6「可见性等价对照」零差异。
const COLOR_BG_DEFAULT: Color = Color(0.06, 0.08, 0.12, 1.0)         # 根背景兜底
const COLOR_SURFACE_DEFAULT: Color = Color(0.10, 0.14, 0.20, 1.0)    # 面板/卡片兜底
const COLOR_BORDER_DEFAULT: Color = Color(0.18, 0.25, 0.35, 1.0)     # 描边兜底
const COLOR_BUTTON_PRESSED: Color = Color(0.20, 0.30, 0.45, 1.0)     # 按钮按下态

# ── 视图展示语义色板（R-18：全部消费方引用本组）─────────────────────────────
const COLOR_TEXT_DEFAULT: Color = Color(0.88, 0.91, 0.95, 1.0)       # 主文本
const COLOR_TEXT_MUTED_DEFAULT: Color = Color(0.56, 0.62, 0.72, 1.0) # 次要文本
const COLOR_ACCENT_DEFAULT: Color = Color(0.38, 0.75, 0.98, 1.0)     # 交互高亮
const COLOR_SUCCESS_DEFAULT: Color = Color(0.20, 0.83, 0.60, 1.0)    # 成功反馈
const COLOR_WARNING_DEFAULT: Color = Color(0.95, 0.78, 0.26, 1.0)    # 警告反馈
const COLOR_DANGER_DEFAULT: Color = Color(0.97, 0.53, 0.53, 1.0)     # 危险反馈

# ── 半透明遮罩 / 描边 / 灰化（R-18）────────────────────────────────────────
const COLOR_OVERLAY_DIM: Color = Color(0.0, 0.0, 0.0, 0.4)           # Loading 半透明遮罩
const COLOR_TEXT_OUTLINE: Color = Color(0.0, 0.0, 0.0, 0.8)          # 飘字描边
const COLOR_DISABLED_DIM: Color = Color(0.5, 0.5, 0.5, 0.6)          # 破损/禁用灰化
const COLOR_CONTENT_LOCKED: Color = Color(0.4, 0.4, 0.4, 1.0)        # 未发现内容灰化
const COLOR_RARITY_EPIC: Color = Color(0.60, 0.45, 0.95, 1.0)        # 视图稀有度色阶（史诗）

# ==============================================================================
# 二、8px 栅格间距体系 (Spacing Grid)
# ==============================================================================

const SPACING_ZERO: int = 0
const SPACING_XS: int = 4
const SPACING_SM: int = 8
const SPACING_MD: int = 16
const SPACING_LG: int = 24
const SPACING_XL: int = 32
const SPACING_XXL: int = 48

# ==============================================================================
# 三、排版字阶体系 (Typography Scale)
# ==============================================================================

const FONT_SIZE_CAPTION: int = 12
const FONT_SIZE_BODY: int = 14
const FONT_SIZE_TITLE_SM: int = 16
const FONT_SIZE_TITLE_MD: int = 20
const FONT_SIZE_TITLE_LG: int = 28
const FONT_SIZE_HEADLINE: int = 36

# ==============================================================================
# 四、动效与缓动时长 (Motion Scale)
# ==============================================================================

const DURATION_FAST: float = 0.15     # 按钮轻微缩放 / 悬停高亮
const DURATION_NORMAL: float = 0.25   # 弹窗弹出 / 抽屉侧滑
const DURATION_SLOW: float = 0.45     # 全屏黑屏转场 / 场景切入
const DEBOUNCE_DELAY: float = 0.30    # 按钮防连击去抖时间

# ==============================================================================
# 五、有界容量常量 (Bounded Capacity)
# ==============================================================================

const SCENE_CACHE_MAX: int = 32       # 场景实例缓存条目上限（FIFO 逐出）
const BATTLE_LOG_MAX: int = 200       # 战报日志条目上限（超出裁最旧）

# ==============================================================================
# 六、视口 CanvasLayer Z-Index 严格规约（唯一真源 / R-19）
# ──────────────────────────────────────────────────────────────────────────────
# 本组为层级唯一权威定义：nav_types.LayerLevel 与 app_root.tscn 六层数值均与之一致
# （BACKGROUND=-10 / SCREEN=0 / HUD=10 / MODAL=50 / OVERLAY=80 / DEBUG=100）。
# 收敛前 design_tokens 另声明 OVERLAY=100 / DEBUG=120 且 DRAWER=30 / POPOVER=70 /
# TOAST=85——与场景实际层位冲突且 DRAWER/POPOVER/TOAST 无对应真实层，属幽灵常量，
# 已依 TC-P82-S3-03「六层级数值三方一致、幽灵常量 0」一并删除。
# ==============================================================================

const Z_INDEX_BACKGROUND: int = -10   # 动态星空 / 城镇背景
const Z_INDEX_SCREEN: int = 0         # 18 大主屏容器
const Z_INDEX_HUD: int = 10           # 玩家血条、小地图、快捷栏
const Z_INDEX_MODAL: int = 50         # 业务模态框 / 二级确认框
const Z_INDEX_OVERLAY: int = 80       # 全屏阻塞 Loading / 重连遮罩 / 轻提示层
const Z_INDEX_DEBUG: int = 100        # 性能 FPS / GM 控制台
