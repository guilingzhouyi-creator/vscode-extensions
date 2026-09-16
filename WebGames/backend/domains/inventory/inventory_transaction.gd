# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/inventory_transaction.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 保存库存、装备槽和钱包的变更前快照，提供幂等提交与失败回滚； 领域服务负责输入预检，本组件不创建隐式依赖或执行业务规则。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name InventoryTransaction extends RefCounted

# ==============================================================================
# 一、事务状态
# ==============================================================================

var transaction_id: String = ""
var _inventory: WearableInventoryAggregate = null
var _wallet: CharacterWalletEntity = null
var _catalog: ItemRegistryCatalog = null
var _inventory_snapshot: Dictionary = {}
var _wallet_values: Dictionary = {}
var _committed: bool = false

static var _completed: Dictionary = {}

# ==============================================================================
# 二、构造与幂等提交
# ==============================================================================

## S3-03 有界保留：幂等提交记录超容量时按插入序裁剪最旧记录（内存有界，防无限增长）
static func prune_completed(max_records: int = -1) -> void:
	if max_records < 0:
		max_records = GameConfig.get_int("infrastructure.admin", "idempotency/max_records", 1000)
	if max_records <= 0:
		return
	var keys := _completed.keys()
	var idx := 0
	while _completed.size() > max_records and idx < keys.size():
		_completed.erase(keys[idx])
		idx += 1

## 事务构造：快照变更前状态（库存深快照 + 钱包值），供回滚还原
func _init(
	p_transaction_id: String = "",
	inventory: WearableInventoryAggregate = null,
	wallet: CharacterWalletEntity = null,
	catalog: ItemRegistryCatalog = null
) -> void:
	transaction_id = p_transaction_id
	_inventory = inventory
	_wallet = wallet
	_catalog = catalog
	if inventory != null:
		_inventory_snapshot = inventory.snapshot()
	if wallet != null:
		_wallet_values = wallet.to_dictionary()

## 事务绑定的物品注册表引用
func get_catalog() -> ItemRegistryCatalog:
	return _catalog

## 幂等判定：事务 ID 是否已完成（空 ID 恒非重复）
func is_duplicate() -> bool:
	return not transaction_id.is_empty() and _completed.has(transaction_id)

## 提交：记录幂等结果（有界表），重复提交返回首次结果
func commit(result: Dictionary = {}) -> Dictionary:
	if transaction_id.is_empty():
		_committed = true
		return result
	if _completed.has(transaction_id):
		return _completed[transaction_id]
	_committed = true
	_completed[transaction_id] = result.duplicate(true)
	return result

# ==============================================================================
# 三、回滚与重置
# ==============================================================================

## 回滚：恢复库存与钱包变更前快照，返回失败结果字典
func rollback(error_code: String = "TRANSACTION_ROLLED_BACK") -> Dictionary:
	if _inventory != null:
		_inventory.restore(_inventory_snapshot)
	if _wallet != null:
		_wallet.from_dictionary(_wallet_values)
	return {"success": false, "error_code": error_code, "rolled_back": true, "transaction_id": transaction_id}

## 清空全部幂等记录（测试/重置场景）
static func clear_completed() -> void:
	_completed.clear()
