# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端导航层: 路由与视口类型契约
# 文件路径: res://frontend/navigation/nav_types.gd
# 职责: 定义 Screen/Modal 标识、转场枚举与导航事件契约
# ==============================================================================
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
