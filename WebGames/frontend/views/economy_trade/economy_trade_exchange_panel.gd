# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 第5卷 货币兑换与资源水池面板控制器)
# 文件路径: res://frontend/views/economy_trade/economy_trade_exchange_panel.gd
# 架构定位: Presentation Sub-Panel Delegate
# 依赖与触发: 上游: EconomyTradeTabs, EconomyTradeView
#           下游: KStatusBarClass, UIIntermediary, ServiceLocator, NavManager
# 职责说明: 承接货币兑换、资源水池初始化展示及物价/资源进度条行池化构建。
# 退出语义与设计依据: 表现层多页签拆分与进度条行节点池化复用契约
# ==============================================================================
## EconomyTradeExchangePanel：第5卷货币兑换与资源水池子面板控制器
class_name EconomyTradeExchangePanel
extends BaseScreen

const KStatusBarClass = preload("res://frontend/components/k_status_bar.gd")

var _view: Variant = null

## 绑定所属经济与交易主视图控制器
func setup(view: BaseScreen) -> void:
	_view = view

# ==============================================================================
# Tab 6: 货币兑换 (EXCHANGE)
# ==============================================================================

## 初始化货币兑换 Tab：源/目标选项 + 默认金币→银币 + 汇率显示首刷
func init_exchange_tab() -> void:
	if _view == null or _view.option_exchange_source == null:
		return
	_view.option_exchange_source.clear()
	_view.option_exchange_target.clear()
	for key in _view.exchange_currency_keys:
		_view.option_exchange_source.add_item(UIIntermediary.text(key))
		_view.option_exchange_target.add_item(UIIntermediary.text(key))
	if _view.option_exchange_source.item_count > 0:
		_view.option_exchange_source.select(0)
	if _view.option_exchange_target.item_count > 1:
		_view.option_exchange_target.select(1)
	_view.spin_exchange_amount.value = 1
	refresh_exchange_display()

## 货币索引 → 铜币基准值（0 金币/1 银币/2 铜币/3 魔单晶，越界回退 1）
func _get_currency_copper_value(index: int) -> int:
	return ServiceLocator.get_instance().economy().get_currency_copper(index)

func _read_exchange_selection() -> Dictionary:
	if _view == null or _view.option_exchange_source == null:
		return {}
	var source_index: int = _view.option_exchange_source.selected
	var target_index: int = _view.option_exchange_target.selected
	if source_index < 0 or target_index < 0:
		return {}
	return {
		"src_idx": source_index,
		"tgt_idx": target_index,
		"src_name": _view.option_exchange_source.get_item_text(source_index),
		"tgt_name": _view.option_exchange_target.get_item_text(target_index),
		"amount": int(_view.spin_exchange_amount.value)
	}

## 刷新兑换显示：汇率与结果换算（源/目标铜币比值）
func refresh_exchange_display() -> void:
	var selection_summary := _read_exchange_selection()
	if selection_summary.is_empty():
		return
	var source_copper: int = _get_currency_copper_value(int(selection_summary["src_idx"]))
	var target_copper: int = _get_currency_copper_value(int(selection_summary["tgt_idx"]))
	var economy := ServiceLocator.get_instance().economy()
	var rate: float = economy.calculate_exchange_rate(source_copper, target_copper)
	var amount: int = int(selection_summary["amount"])
	var converted_amount: float = economy.calculate_exchange_result(amount, rate)
	UIIntermediary.resolve(_view.label_exchange_rate, "ui.fe05.exchange.rate", {"source": selection_summary["src_name"], "rate": "%.4f" % rate, "target": selection_summary["tgt_name"]})
	UIIntermediary.resolve(_view.label_exchange_result, "ui.fe05.exchange.result", {"amount": amount, "source": selection_summary["src_name"], "result": "%.2f" % converted_amount, "target": selection_summary["tgt_name"]})

## 源币种下拉切换时刷新兑换预览
func on_exchange_source_selected(_index: int) -> void:
	refresh_exchange_display()

## 目标币种下拉切换时刷新兑换预览
func on_exchange_target_selected(_index: int) -> void:
	refresh_exchange_display()

## 兑换数量微调变化时刷新兑换预览
func on_exchange_amount_changed(_amount_value: float) -> void:
	refresh_exchange_display()

## 提交货币兑换请求并同步钱包货币余额显示
func on_exchange_confirm_pressed() -> void:
	var selection_summary := _read_exchange_selection()
	if selection_summary.is_empty():
		return
	var source_index := int(selection_summary.get("src_idx", 0))
	var target_index := int(selection_summary.get("tgt_idx", 0))
	var amount := int(selection_summary.get("amount", 0))
	var economy := ServiceLocator.get_instance().economy()
	var rate := economy.calculate_exchange_rate(_get_currency_copper_value(source_index), _get_currency_copper_value(target_index))
	var converted := int(round(economy.calculate_exchange_result(amount, rate)))
	var exchange_payload := {"delta_gold": (-amount if source_index == 0 else (converted if target_index == 0 else 0)), "delta_crystals": (-amount if source_index == 3 else (converted if target_index == 3 else 0)), "wallet_gold": _view.wallet_gold}
	var transaction_reply := economy.dispatch_economy_action("EXCHANGE_CURRENCY", exchange_payload)
	var transaction_table: Dictionary = transaction_reply.get("data", transaction_reply) as Dictionary
	if transaction_table.has("wallet_gold"):
		_view.wallet_gold = int(transaction_table.get("wallet_gold", _view.wallet_gold))
	if transaction_table.has("wallet_mana_monocrystals"):
		_view.wallet_mana_monocrystals = int(transaction_table.get("wallet_mana_monocrystals", _view.wallet_mana_monocrystals))
	_view._refresh_wallet_display()
	NavManager.get_instance().show_toast(UIIntermediary.text("ui.fe05.exchange.confirm_toast", {
		"amount": selection_summary["amount"], "source": selection_summary["src_name"], "target": selection_summary["tgt_name"]
	}), NavTypes.ToastLevel.INFO)

# ==============================================================================
# Tab 7: 资源水池 (RESOURCE_POOL) 与共享进度条行池化构建
# ==============================================================================

## 初始化资源水池 Tab：Mock 模式填充示例资源池，实网模式保持空态等待快照
func init_resource_pool_tab() -> void:
	if _view == null:
		return
	if ServiceLocator.get_mode() == "mock":
		_view.resource_pools = [
			{"name": "ui.fe05.commodity.wood", "current": 1200, "max": 2000, "rate": 15}, {"name": "ui.fe05.commodity.iron_ore", "current": 800, "max": 1500, "rate": 8},
			{"name": "ui.fe05.commodity.mana_crystal", "current": 45, "max": 100, "rate": 2}, {"name": "ui.fe05.commodity.herbs", "current": 320, "max": 500, "rate": 5}
		]
	else:
		_view.resource_pools = []
	populate_resource_pools()

## 填充资源池行（名称/存量条/存量/速率，池化复用已有行节点）
func populate_resource_pools() -> void:
	if _view == null or _view.resource_pool_box == null:
		return
	for pool_index in range(_view.resource_pools.size()):
		var pool: Dictionary = _view.resource_pools[pool_index]
		var bar_row := acquire_bar_row(_view.resource_pool_box, pool_index, [140, 90, 70], 100.0, true)
		bar_row.visible = true
		(bar_row.get_child(0) as Label).text = UIIntermediary.text(str(pool.get("name", "ui.fe05.unknown")))
		var progress_bar := bar_row.get_child(1) as ProgressBar
		progress_bar.max_value = float(pool.get("max", 100))
		progress_bar.value = float(pool.get("current", 0))
		(bar_row.get_child(2) as Label).text = UIIntermediary.text("ui.fe05.resource.stock", {"current": int(pool.get("current", 0)), "max": int(pool.get("max", 0))})
		(bar_row.get_child(3) as Label).text = UIIntermediary.text("ui.fe05.resource.rate", {"rate": int(pool.get("rate", 0))})
	for extra_index in range(_view.resource_pools.size(), _view.resource_pool_box.get_child_count()):
		_view.resource_pool_box.get_child(extra_index).visible = false

## 获取或创建带进度条的池化行节点（物价走势与资源池共享行构建器，循环外分配）
static func acquire_bar_row(container_box: VBoxContainer, index: int, column_widths: Array, default_max: float, expand_row: bool = false) -> HBoxContainer:
	if index < container_box.get_child_count():
		return container_box.get_child(index) as HBoxContainer
	var bar_row := HBoxContainer.new()
	bar_row.alignment = BoxContainer.ALIGNMENT_BEGIN
	if expand_row:
		bar_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var first_label := Label.new()
	first_label.custom_minimum_size = Vector2(int(column_widths[0]), 0)
	bar_row.add_child(first_label)
	var progress_bar: ProgressBar = KStatusBarClass.create_bar(0.0, default_max, Vector2(200, 24))
	progress_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar_row.add_child(progress_bar)
	for column_index in range(1, column_widths.size()):
		_add_row_label(bar_row, int(column_widths[column_index]))
	container_box.add_child(bar_row)
	return bar_row

static func _add_row_label(row_container: HBoxContainer, min_width: int) -> void:
	var label_node := Label.new()
	label_node.custom_minimum_size = Vector2(min_width, 0)
	row_container.add_child(label_node)
