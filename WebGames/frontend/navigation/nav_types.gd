# ==============================================================================
# 模块归属: Frontend / Navigation
# 文件路径: res://frontend/navigation/nav_types.gd
# 架构定位: 前端导航契约定义模块，提供全屏 ID、弹窗标识与转场枚举常量
# 依赖与触发: 作为纯值类型被 NavManager、AppBootstrap 与各视图控制器引用
# 职责说明: 定义 Screen/Modal 标识、转场枚举与导航事件契约
# 退出语义与设计依据: 无状态静态常量与枚举定义，不持有节点引用，不产生退出清理副作用
# ==============================================================================
## NavTypes：前端导航路由与转场类型契约定义
class_name NavTypes
extends RefCounted

## 视口层级枚举
enum LayerLevel {
	BACKGROUND = -10,
	SCREEN = 0,
	HUD = 10,
	MODAL = 50,
	OVERLAY = 80,
	DEBUG = 100
}

## 转场动效类型
enum TransitionType {
	NONE,
	FADE,
	SLIDE_LEFT,
	SLIDE_RIGHT
}

## 标准轻提示等级
enum ToastLevel {
	INFO,
	SUCCESS,
	WARNING,
	ERROR
}
