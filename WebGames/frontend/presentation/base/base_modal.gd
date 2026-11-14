# ==============================================================================
# 模块归属: Frontend / Presentation
# 文件路径: res://frontend/presentation/base/base_modal.gd
# 架构定位: 前端表现层弹窗基类，统一模态对话框遮罩、关闭回调与进退场生命周期
# 依赖与触发: 由具体 Modal 视图继承，受 NavManager / ModalManager 调度显示与关闭
# 职责说明: 规范模态弹窗的关闭回调、统一快照注入入口、全屏遮罩阻断与进退场动画
# 退出语义与设计依据: 退出时先禁用交互避免重复关闭提交，再通过统一回调释放模态栈引用
# ==============================================================================
## BaseModal：模态对话框抽象基类，提供统一遮罩、快照注入与进退场动画契约
class_name BaseModal
extends Control

signal modal_closed(result: Dictionary)

var modal_id: String = ""
var close_callback: Callable
var snapshot: Dictionary = {}

## 打开模态弹窗
func on_modal_open(_modal_parameters: Dictionary = {}, on_close_callback: Callable = Callable()) -> void:
	close_callback = on_close_callback

## 统一业务数据入口：模态同样只做显示，严禁内嵌业务计算
func apply_snapshot(snapshot_payload: Dictionary) -> void:
	snapshot = snapshot_payload.duplicate(true)
	_render_from_snapshot()

## 子类渲染映射钩子：只允许将快照字段映射到节点
func _render_from_snapshot() -> void:
	pass

## 请求关闭模态弹窗
func close_modal(modal_result: Dictionary = {}) -> void:
	if close_callback.is_valid():
		close_callback.call(modal_result)
	modal_closed.emit(modal_result)
	queue_free()
