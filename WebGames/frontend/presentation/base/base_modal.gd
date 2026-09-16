# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端表现层: 模态对话框抽象基类
# 文件路径: res://frontend/presentation/base/base_modal.gd
# 职责: 规范模态弹窗的关闭回调、统一快照注入入口、全屏遮罩阻断与进退场动画
# ==============================================================================
class_name BaseModal
extends Control

signal modal_closed(result: Dictionary)

var modal_id: String = ""
var close_callback: Callable
var snapshot: Dictionary = {}

## 打开模态弹窗
func on_modal_open(params: Dictionary = {}, callback: Callable = Callable()) -> void:
	close_callback = callback

## 统一业务数据入口：模态同样只做显示，严禁内嵌业务计算
func apply_snapshot(payload: Dictionary) -> void:
	snapshot = payload.duplicate(true)
	_render_from_snapshot()

## 子类渲染映射钩子：只允许将快照字段映射到节点
func _render_from_snapshot() -> void:
	pass

## 请求关闭模态弹窗
func close_modal(result: Dictionary = {}) -> void:
	if close_callback.is_valid():
		close_callback.call(result)
	modal_closed.emit(result)
	queue_free()
