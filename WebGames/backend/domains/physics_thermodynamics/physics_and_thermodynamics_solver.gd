# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/physics_and_thermodynamics_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 动量守恒与刃口侵彻伤害方程、始源直驱 vs 咒术两步相变能损方程。 动能系数与相变损耗参数由 config/domains/combat.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PhysicsAndThermodynamicsSolver：Headless Discrete Solver / Numerical Calculator
class_name PhysicsAndThermodynamicsSolver extends RefCounted

## 侵彻求解静态参数缓存（模式：配置热重载版本推进自动失效重建）。
## calculate_penetration_damage 每击原本 3 次 GameConfig 路径查找（kinetic 段）——
## 缓存后每击仅一次版本比对 + 字段复制（动词常数仍走 get_verb 字典引用）。
class KineticParams extends RefCounted:
	var energy_coefficient: float = 0.5
	var mass_floor: float = 0.1
	var velocity_floor: float = 0.1
	var min_loss_floor: float = 0.001
	var primordial_step1_loss: float = 0.03
	var incantation_step1_base: float = 0.25
	var incantation_step1_per_sentence: float = 0.03
	var incantation_step1_min: float = 0.25
	var incantation_step1_max: float = 0.50
	var step2_base: float = 0.10
	var step2_per_meter: float = 0.01
	var step2_min: float = 0.10
	var step2_max: float = 0.30

static var _kinetic_cache: KineticParams = null
static var _kinetic_config_version: int = -1

## kinetic 参数缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_kinetic_cache() -> KineticParams:
	var config_version: int = GameConfig.config_reload_version()
	if _kinetic_cache != null and _kinetic_config_version == config_version:
		return _kinetic_cache
	var kinetic_parameters := KineticParams.new()
	kinetic_parameters.energy_coefficient = GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.5)
	kinetic_parameters.mass_floor = GameConfig.get_float("domains.combat", "kinetic/mass_floor", 0.1)
	kinetic_parameters.velocity_floor = GameConfig.get_float("domains.combat", "kinetic/velocity_floor", 0.1)
	kinetic_parameters.min_loss_floor = GameConfig.get_float("domains.combat", "phase_transition/primordial_min_loss_floor", 0.001)
	kinetic_parameters.primordial_step1_loss = GameConfig.get_float("domains.combat", "phase_transition/primordial_step1_loss", 0.03)
	kinetic_parameters.incantation_step1_base = GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_base", 0.25)
	kinetic_parameters.incantation_step1_per_sentence = GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_per_sentence", 0.03)
	kinetic_parameters.incantation_step1_min = GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_min", 0.25)
	kinetic_parameters.incantation_step1_max = GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_max", 0.50)
	kinetic_parameters.step2_base = GameConfig.get_float("domains.combat", "phase_transition/step2_base", 0.10)
	kinetic_parameters.step2_per_meter = GameConfig.get_float("domains.combat", "phase_transition/step2_per_meter", 0.01)
	kinetic_parameters.step2_min = GameConfig.get_float("domains.combat", "phase_transition/step2_min", 0.10)
	kinetic_parameters.step2_max = GameConfig.get_float("domains.combat", "phase_transition/step2_max", 0.30)
	_kinetic_cache = kinetic_parameters
	_kinetic_config_version = config_version
	return kinetic_parameters

## 物理动量侵彻伤害求解器
## D_phys = 0.5 * m * v^2 * k_mom * (1 + k_edge * S_edge) / (1 + Armor_eff)
static func calculate_penetration_damage(
	weapon_mass_kg: float,
	velocity_meters_per_second: float,
	verb_id: String,
	edge_sharpness: float,
	effective_armor: float
) -> float:
	var verb: Variant = PhysicalVerbRegistry.get_verb(verb_id)
	var momentum_coefficient: float = verb.get("k_mom", 1.0)
	var edge_coefficient: float = verb.get("k_edge", 1.0)

	var kinetic_parameters := _ensure_kinetic_cache()
	var kinetic_energy: Variant = kinetic_parameters.energy_coefficient * max(kinetic_parameters.mass_floor, weapon_mass_kg) * pow(max(kinetic_parameters.velocity_floor, velocity_meters_per_second), 2.0)
	var sharpness_boost: float = 1.0 + edge_coefficient * maxf(0.0, edge_sharpness)
	var armor_divisor: float = 1.0 + maxf(0.0, effective_armor)

	return (kinetic_energy * momentum_coefficient * sharpness_boost) / armor_divisor

## 热力学两步相变能损求解器
## 第一步相变损耗: 自由态 -> 构型态 (始源 1~5%, 咒术 25~50%)
## 第二步相变损耗: 构型态 -> 投影释放态 (10~30%)
static func calculate_mana_phase_transition_loss(
	raw_mana_input: float,
	is_primordial: bool,
	sentence_count: int,
	projection_distance_meters: float
) -> Dictionary:
	var kinetic_parameters := _ensure_kinetic_cache()
	var step1_loss_ratio: float
	if is_primordial:
		step1_loss_ratio = maxf(kinetic_parameters.min_loss_floor, kinetic_parameters.primordial_step1_loss)
	else:
		step1_loss_ratio = clampf(
			kinetic_parameters.incantation_step1_base + kinetic_parameters.incantation_step1_per_sentence * float(sentence_count),
			kinetic_parameters.incantation_step1_min,
			kinetic_parameters.incantation_step1_max
		)

	var step2_loss_ratio: float = clampf(
		kinetic_parameters.step2_base + kinetic_parameters.step2_per_meter * maxf(0.0, projection_distance_meters),
		kinetic_parameters.step2_min,
		kinetic_parameters.step2_max
	)
	var total_loss_ratio := clampf(1.0 - (1.0 - step1_loss_ratio) * (1.0 - step2_loss_ratio), kinetic_parameters.min_loss_floor, 0.9999)
	var effective_energy_output := raw_mana_input * (1.0 - total_loss_ratio)

	return {
		"raw_input": raw_mana_input,
		"step1_loss_ratio": step1_loss_ratio,
		"step2_loss_ratio": step2_loss_ratio,
		"total_loss_ratio": total_loss_ratio,
		"effective_output": effective_energy_output
	}
