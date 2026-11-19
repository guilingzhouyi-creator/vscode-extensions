# ==============================================================================
# 模块归属: 性能基准层 (Benchmarks · 持久化往返基线)
# 文件路径: res://benchmarks/bench_persistence.gd
# 架构定位: Persistence Throughput Benchmark Suite
# 依赖与触发: 触发方: bench_runner.gd | 上游: SaveManager, GameConfig | 下游: BenchHarness
# 职责说明: 量化 SaveManager 存档往返与底层 JSON / SHA-256 原语吞吐；探针存档用后即删（幂等）。
# 退出语义与设计依据: 返回 { category, metrics } 标准基准字典 | 依据: 无残留探针测试契约
# ==============================================================================

## BenchPersistence：存档往返序列化与完整性校验吞吐基准套件
class_name BenchPersistence extends RefCounted

const BENCH_SAVE_NAME: String = "bench_throughput_probe"

## 往返结果回写区（bind 按值捕获字典副本，无法回写外层局部变量，故用静态区）
static var _last_roundtrip: Dictionary = {}

## 执行持久化链路基准测试并返回度量结果集合
static func run_benchmarks() -> Dictionary:
	var metrics: Array = []
	GameConfig.ensure_loaded()

	var payload := _build_payload()
	var json_str := JSON.stringify(payload, "\t")

	metrics.append(BenchHarness.measure(
		"JSON.stringify 存档信封序列化", 20_000,
		func(): JSON.stringify(payload, "\t")
	))
	var json_parser := JSON.new()
	metrics.append(BenchHarness.measure(
		"JSON.parse 存档信封反序列化", 20_000,
		func(): json_parser.parse(json_str)
	))
	metrics.append(BenchHarness.measure(
		"SaveManager.compute_sha256 完整性签名", 20_000,
		func(): SaveManager.compute_sha256(json_str)
	))

	# 完整 保存→读取 往返（含原子写 + SHA-256 校验），迭代压低避免磁盘抖动
	metrics.append(BenchHarness.measure(
		"SaveManager save+load 往返", 30,
		Callable(BenchPersistence, "_roundtrip_once").bind(payload)
	))
	if not _last_roundtrip.get("success", false) or not _last_roundtrip.get("verified", false):
		push_warning("BenchPersistence: 往返校验未通过，基准结果不可信: %s" % str(_last_roundtrip))

	_cleanup_probe()
	return { "category": "持久化 (Persistence)", "metrics": metrics }

## 单次 保存→读取 往返（结果写入静态区 _last_roundtrip 供校验）
static func _roundtrip_once(payload: Dictionary) -> void:
	SaveManager.save_game(BENCH_SAVE_NAME, payload)
	_last_roundtrip = SaveManager.load_game(BENCH_SAVE_NAME)

static func _build_payload() -> Dictionary:
	# 模拟中等规模玩家存档：钱包 + 60 格背包 + 时钟 + 状态
	var wallet := CharacterWalletEntity.new()
	wallet.copper = 1234
	wallet.silver = 56
	wallet.gold = 7
	wallet.mana_monocrystals = 3
	var items: Array = []
	for i in range(60):
		items.append({ "uid": "item_%04d" % i, "tid": "iron_sword", "count": (i % 9) + 1 })
	return {
		"wallet": {
			"copper": wallet.copper, "silver": wallet.silver,
			"gold": wallet.gold, "platinum": wallet.platinum,
			"monocrystals": wallet.mana_monocrystals
		},
		"inventory": items,
		"clock": { "combat_tick": 123456, "calendar_days": 33, "calendar_years": 2 }
	}

## 删除基准探针存档（保持环境干净、可重复执行）
static func _cleanup_probe() -> void:
	var save_dir: String = GameConfig.get_string("infrastructure.persistence", "save_dir", "user://saves/")
	var ext: String = GameConfig.get_string("infrastructure.persistence", "save_extension", ".kalar_save")
	var probe := save_dir + BENCH_SAVE_NAME + ext
	if FileAccess.file_exists(probe):
		DirAccess.remove_absolute(probe)
