# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_assembler.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 以 config/infrastructure/domains.json 领域清单为唯一事实来源，把各领域 聚合的 serialize() 产物按清单顺序组装成 SaveManager 的 payload.data， 读取时校验 format_version、经迁移链后回灌各领域静态 deserialize。 清单顺序输出保证 data 键序稳定——这是存档 SHA-256 字节稳定的前提。  扩展约定（新增可存档领域 = 三步，零改动扩散到本文件）: 1. 领域聚合实现实例方法 serialize() -> Dictionary； 2. 领域类实现静态方法 deserialize(d: Dictionary)； 3. 调用方把聚合实例注册进 providers、把 Callable(ItemEntity, "deserialize") 形态的静态反序列化器注册进 consumers。 未注册的领域自然不参与存档；providers 中注册但聚合缺 serialize 的记入 skipped。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GameSaveAssembler extends RefCounted

## 逐版本迁移注册表：键 = 来源版本号，值 = { "to": 目标版本, "fn": Callable }。
## v1 全域同版为空表；未来升版在此登记迁移函数即可，读取路径无需改动。
static var _migrations: Dictionary = {}

static func register_migration(from_version: String, to_version: String, migrate: Callable) -> void:
	_migrations[from_version] = { "to": to_version, "fn": migrate }

static func has_migration(from_version: String) -> bool:
	return _migrations.has(from_version)

static func get_migration(from_version: String) -> Dictionary:
	return _migrations.get(from_version, {})

## 组装 payload.data：按清单顺序收集已注册领域的 serialize() 产物。
## providers: { 领域 id -> 聚合实例（须实现 serialize()） }；未注册领域自然排除。
## 返回 { "data": Dictionary（可直接作 SaveManager.save_game 的 payload["data"]）,
##        "saved": 已收集领域, "skipped": 注册但缺 serialize 的领域 }
static func build_save_payload(providers: Dictionary) -> Dictionary:
	var data := {}
	var saved: Array[String] = []
	var skipped: Array[String] = []
	for entry in _manifest_entries():
		var id := String(entry.get("id", ""))
		if not providers.has(id):
			continue
		var agg: Variant = providers[id]
		if agg == null or not agg.has_method("serialize"):
			skipped.append(id)
			continue
		data[id] = agg.serialize()
		saved.append(id)
	return { "data": data, "saved": saved, "skipped": skipped }

## 回灌存档数据：按清单顺序调用各领域静态 deserialize（经 Callable 统一形态）。
## consumers: { 领域 id -> Callable }，如 Callable(ItemEntity, "deserialize")。
## 返回 { "restored": {领域 id -> 实例}, "missing": 存档有数据但未注册的领域,
##        "skipped": 注册了但反序列化返回 null 的领域 }
static func apply_save_data(data: Dictionary, consumers: Dictionary) -> Dictionary:
	var restored := {}
	var missing: Array[String] = []
	var skipped: Array[String] = []
	for entry in _manifest_entries():
		var id := String(entry.get("id", ""))
		if not data.has(id):
			continue
		if not consumers.has(id):
			missing.append(id)
			continue
		var deserializer: Variant = consumers[id]
		if not deserializer is Callable:
			skipped.append(id)
			continue
		var obj: Variant = (deserializer as Callable).call(data[id])
		if obj == null:
			skipped.append(id)
			continue
		restored[id] = obj
	return { "restored": restored, "missing": missing, "skipped": skipped }

## 存档版本兼容校验与链式迁移：将 save_version 迁移到当前配置版本。
## 空版本（legacy 档）视作兼容原样通过；异版且无迁移链 → 明确不兼容并给出 error。
## 返回 { "compatible": bool, "version": 最终版本, "data": 处理后数据 [, "error"] }
static func migrate_save_data(data: Dictionary, save_version: String) -> Dictionary:
	var current := GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	if save_version.is_empty() or save_version == current:
		return { "compatible": true, "version": current, "data": data }
	var working := data
	var ver := save_version
	var visited: Array[String] = []
	while ver != current:
		if visited.has(ver):
			return { "compatible": false, "version": ver, "data": working, "error": "MIGRATION_CYCLE" }
		visited.append(ver)
		if not _migrations.has(ver):
			return { "compatible": false, "version": ver, "data": working, "error": "NO_MIGRATION_PATH" }
		var step: Dictionary = _migrations[ver]
		working = step["fn"].call(working)
		ver = String(step["to"])
	return { "compatible": true, "version": current, "data": working }

## 装配差集校验（Phase 31 S2）：按清单检查 providers 注册但 consumers 缺失（或
## 非 Callable）的领域差集——差集非空视为装配不平衡（未注册领域不能静默丢失）。
## 返回 { "balanced": bool, "providers_without_consumer": Array[String],
##        "registered_count": int, "unregistered_ids": Array[String] }
static func validate_registration(providers: Dictionary, consumers: Dictionary) -> Dictionary:
	var providers_without_consumer: Array[String] = []
	var registered_count := 0
	for entry in _manifest_entries():
		var id := String(entry.get("id", ""))
		if not providers.has(id):
			continue
		registered_count += 1
		var consumer: Variant = consumers.get(id)
		if consumer == null or not (consumer is Callable):
			providers_without_consumer.append(id)
	return {
		"balanced": providers_without_consumer.is_empty(),
		"providers_without_consumer": providers_without_consumer,
		"registered_count": registered_count,
		"unregistered_ids": providers_without_consumer
	}

## 清单条目（只读 domains.json 的 domains 数组；读取失败返回空数组即全域跳过）
static func _manifest_entries() -> Array:
	return GameConfig.get_array("infrastructure.domains", "domains", [])


## UID 单轨迁移判定器：只读递归扫描存档 payload 中实例物品 item_uid 的
## 旧档前缀（LGC_，读 domains.item_namespace_registry uid/legacy_prefixes）计数。
## 连续 2 个存档版本计数恒 0 即迁移完成，后续批次退役五点兼容路径并注销 W-01/W-03。
static func audit_legacy_uid(payload_data: Dictionary) -> Dictionary:
	var prefixes: Array = GameConfig.get_array(
		"domains.item_namespace_registry", "uid/legacy_prefixes", ["LGC_"])
	var report := {"total_instances": 0, "legacy_uid_count": 0, "legacy_prefixes": prefixes, "legacy_samples": []}
	_scan_uid_node(payload_data, prefixes, report)
	report["migration_complete"] = int(report["legacy_uid_count"]) == 0
	return report

## 递归扫描：含 item_uid 键的字典计一实例；前缀命中计一 legacy（样本截前 5 条）
static func _scan_uid_node(node: Variant, prefixes: Array, report: Dictionary) -> void:
	if node is Dictionary:
		var d: Dictionary = node
		if d.has("item_uid"):
			report["total_instances"] = int(report["total_instances"]) + 1
			var uid := String(d.get("item_uid", ""))
			for p in prefixes:
				if uid.begins_with(String(p)):
					report["legacy_uid_count"] = int(report["legacy_uid_count"]) + 1
					if (report["legacy_samples"] as Array).size() < 5:
						(report["legacy_samples"] as Array).append(uid)
					break
		for v in d.values():
			_scan_uid_node(v, prefixes, report)
	elif node is Array:
		for v in node:
			_scan_uid_node(v, prefixes, report)
