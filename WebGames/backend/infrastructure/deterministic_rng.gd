# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Deterministic Randomness)
# 文件路径: res://backend/infrastructure/deterministic_rng.gd
# 架构定位: Deterministic PRNG Engine
# 依赖与触发: 上游: CombatCore, LootTable, DropResolver | 下游: 无 | 配置: 无 | 信号: 无
# 职责说明: 以配置驱动的 LCG 提供可复现随机源，取代 Godot 全局 randf()/randi()。  为什么不能用全局 randf()/randi(): 全局随机依赖引擎内部状态，未显式 seed 时每次进程启动序列都不同， 导致抽卡、属性掷骰、强化成败等结果不可复现、不可回放， 与本项目「全域确定性」的核心契约直接冲突。  用法: var rng := DeterministicRNG.from_seed(12345)   # 独立实例，完全隔离 rng.randf(); rng.randi_range(1, 6); rng.pick(arr)  DeterministicRNG.global().randf()              # 共享实例（业务默认入口） DeterministicRNG.reseed_global(seed)           # 整局复现开关  LCG 常数（multiplier / increment / mask / 默认种子）由 config/domains/deterministic.json 的 lcg.* 驱动。
# 退出语义与设计依据: 确定性离散随机数规范
# ==============================================================================

## DeterministicRNG：Deterministic PRNG Engine
class_name DeterministicRNG extends RefCounted

# ==============================================================================
# 一、实例状态
# ==============================================================================

static var _global: DeterministicRNG = null

var _state: int = 1

## LCG 参数实例固化快照（Inv-DF-5）——set_seed 或首次推进时一次性读取，
## 避免运行期 reload_config 静默改变同种子序列并破坏整局复现契约
var _lcg_multiplier_snapshot: int = 0
var _lcg_increment_snapshot: int = 0
var _lcg_mask_snapshot: int = 0

func _init(seed_value: int = 1) -> void:
	set_seed(seed_value)

## 以显式种子构造独立实例（同种子必然产生同序列）
static func from_seed(seed_value: int) -> DeterministicRNG:
	var rng := DeterministicRNG.new()
	rng.set_seed(seed_value)
	return rng

## 共享实例：业务代码默认入口，可通过 reseed_global 实现整局复现
static func global() -> DeterministicRNG:
	if _global == null:
		_global = DeterministicRNG.new()
		_global.set_seed(_default_seed())
	return _global

## 重设共享实例种子，使后续全部随机可复现（回放 / 存档续局入口）
static func reseed_global(seed_value: int) -> void:
	global().set_seed(seed_value)

## 可选 RNG 参数归一（全域统一注入约定，业务签名统一为 rng: DeterministicRNG = null）：
##   传实例     -> 原样返回（十连等批量场景必须共用同一实例，序列才连续可复现）
##   传 int > 0 -> 以该种子创建独立实例（单次调用完全可复现）
##   null / 0 / 其他 -> 回退共享实例 global()
static func resolve(rng_or_seed: Variant = null) -> DeterministicRNG:
	if rng_or_seed is DeterministicRNG:
		return rng_or_seed
	if rng_or_seed is int:
		var seed_value: int = rng_or_seed
		if seed_value > 0:
			return from_seed(seed_value)
	return global()

static func _default_seed() -> int:
	return GameConfig.get_int("domains.deterministic", "lcg/global_default_seed", 20240917)

# ==============================================================================
# 三、种子与状态推进
# ==============================================================================

## 设置种子；0 非法（LCG 会退化为常数序列），内部归一为 1
func set_seed(seed_value: int) -> void:
	_ensure_lcg_params()
	var mask := _lcg_mask_snapshot
	_state = seed_value & mask
	if _state == 0:
		_state = 1

## 获取当前状态机或实体的当前状态值
func get_state() -> int:
	return _state

## 推进并返回下一个内部状态（LCG 参数取实例固化快照）
func next_state() -> int:
	_ensure_lcg_params()
	_state = (_state * _lcg_multiplier_snapshot + _lcg_increment_snapshot) & _lcg_mask_snapshot
	return _state

# ==============================================================================
# 四、确定性随机取值
# ==============================================================================

## [0.0, 1.0) 浮点；分母取 mask+1 保证精度（约 4.7e-10）
func randf() -> float:
	_ensure_lcg_params()
	return float(next_state()) / float(_lcg_mask_snapshot + 1)

## [min_value, max_value) 浮点
func randf_range(min_value: float, max_value: float) -> float:
	# 显式 self.randf()：类方法名与 Godot 全局函数 randf() 同名，
	# 裸调用会被解析为全局函数（非确定性且不推进 _state）
	return min_value + self.randf() * (max_value - min_value)

## [min_value, max_value] 闭区间整数（含两端）
func randi_range(min_value: int, max_value: int) -> int:
	if max_value <= min_value:
		return min_value
	# 用 randf 全精度高位缩放替代 state % range 低比特取模（Inv-RG-1）：
	# LCG 低比特每步翻转，偶数区间下直接取模会导致奇偶严格交替
	var span := max_value - min_value + 1
	var scaled := int(self.randf() * float(span))
	return mini(max_value, min_value + scaled) # float 舍入边界钳回 max_value（仍恰好消费 1 次 next_state）

## 从数组等概率取一个元素；空数组返回 null（不产生模零崩溃）
func pick(items: Array) -> Variant:
	if items.is_empty():
		return null
	# 用高位缩放索引替代 state % size 低比特路径，避免偶数容量下索引奇偶交替
	var item_index := int(self.randf() * float(items.size()))
	return items[mini(items.size() - 1, item_index)]

## 按 weight_key 字段加权随机选取（确定性：本实例 LCG 驱动，非全局 randf）。
## 权重 <= 0 的词条不参与选取；总权重非正时退化为均匀 pick（零除保护）。
func pick_weighted(pool: Array, weight_key: String = "weight") -> Variant:
	if pool.is_empty():
		return null
	var total_weight := 0.0
	var last_positive: Variant = null
	for entry in pool:
		var entry_dict: Dictionary = entry
		var entry_weight := float(entry_dict.get(weight_key, 1.0))
		if entry_weight > 0.0:
			total_weight += entry_weight
			last_positive = entry
	if total_weight <= 0.0:
		return pick(pool)
	var roll := self.randf() * total_weight
	var accumulated_weight := 0.0
	for entry in pool:
		var entry_dict: Dictionary = entry
		var entry_weight := float(entry_dict.get(weight_key, 1.0))
		if entry_weight <= 0.0:
			continue
		accumulated_weight += entry_weight
		if roll < accumulated_weight:
			return entry
	return last_positive

# ==============================================================================
# 五、配置读取（一次性固化）
# ==============================================================================

## LCG 参数首次使用或设种子时固化快照；此后不再读配置。
## 以 _lcg_mask_snapshot == 0 作为「未固化」哨兵（默认 mask 恒 > 0）。
func _ensure_lcg_params() -> void:
	if _lcg_mask_snapshot != 0:
		return
	_lcg_multiplier_snapshot = GameConfig.get_int("domains.deterministic", "lcg/multiplier", 1103515245)
	_lcg_increment_snapshot = GameConfig.get_int("domains.deterministic", "lcg/increment", 12345)
	_lcg_mask_snapshot = GameConfig.get_int("domains.deterministic", "lcg/mask", 2147483647)
