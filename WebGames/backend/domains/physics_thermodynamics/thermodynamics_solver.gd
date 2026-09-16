# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/thermodynamics_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 动量守恒与刃口侵彻伤害方程、始源直驱 vs 咒术两步相变能损方程。 动能系数与相变损耗参数由 config/domains/combat.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name PhysicsAndThermodynamicsSolver extends RefCounted

## 侵彻求解静态参数缓存（Phase 64 P2 模式：配置热重载版本推进自动失效重建）。
## calculate_penetration_damage 每击原本 3 次 GameConfig 路径查找（kinetic 段）——
## 缓存后每击仅一次版本比对 + 字段复制（动词常数仍走 get_verb 字典引用）。
class KineticParams extends RefCounted:
	var energy_coef: float = 0.5
	var mass_floor: float = 0.1
	var velocity_floor: float = 0.1

static var _kinetic_cache: KineticParams = null
static var _kinetic_config_version: int = -1

## kinetic 参数缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_kinetic_cache() -> void:
	if _kinetic_cache != null and _kinetic_config_version == GameConfig.config_reload_version():
		return
	var p := KineticParams.new()
	p.energy_coef = GameConfig.get_float("domains.combat", "kinetic/energy_coef", 0.5)
	p.mass_floor = GameConfig.get_float("domains.combat", "kinetic/mass_floor", 0.1)
	p.velocity_floor = GameConfig.get_float("domains.combat", "kinetic/velocity_floor", 0.1)
	_kinetic_cache = p
	_kinetic_config_version = GameConfig.config_reload_version()

## 物理动量侵彻伤害求解器
## D_phys = 0.5 * m * v^2 * k_mom * (1 + k_edge * S_edge) / (1 + Armor_eff)
static func calculate_penetration_damage(
	weapon_mass_kg: float,
	velocity_m_s: float,
	verb_id: String,
	edge_sharpness: float,
	effective_armor: float
) -> float:
	var verb = PhysicalVerbRegistry.get_verb(verb_id)
	var k_mom: float = verb.get("k_mom", 1.0)
	var k_edge: float = verb.get("k_edge", 1.0)

	_ensure_kinetic_cache()
	var p := _kinetic_cache
	var kinetic_energy = p.energy_coef * max(p.mass_floor, weapon_mass_kg) * pow(max(p.velocity_floor, velocity_m_s), 2.0)
	var sharpness_boost = 1.0 + k_edge * max(0.0, edge_sharpness)
	var armor_divisor = 1.0 + max(0.0, effective_armor)

	return (kinetic_energy * k_mom * sharpness_boost) / armor_divisor

## 热力学两步相变能损求解器
## 第一步相变损耗: 自由态 -> 构型态 (始源 1~5%, 咒术 25~50%)
## 第二步相变损耗: 构型态 -> 投影释放态 (10~30%)
static func calculate_mana_phase_transition_loss(
	raw_mana_input: float,
	is_primordial: bool,
	sentence_count: int,
	projection_distance_m: float
) -> Dictionary:
	var min_loss_floor: float = GameConfig.get_float("domains.combat", "phase_transition/primordial_min_loss_floor", 0.001)
	var eta_1: float
	if is_primordial:
		var primordial_loss: float = GameConfig.get_float("domains.combat", "phase_transition/primordial_step1_loss", 0.03) # 始源直驱仅 3% 能损
		eta_1 = maxf(min_loss_floor, primordial_loss)
	else:
		eta_1 = clamp(
			GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_base", 0.25)
			+ GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_per_sentence", 0.03) * float(sentence_count),
			GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_min", 0.25),
			GameConfig.get_float("domains.combat", "phase_transition/incantation_step1_max", 0.50)
		)

	var eta_2: float = clamp(
		GameConfig.get_float("domains.combat", "phase_transition/step2_base", 0.10)
		+ GameConfig.get_float("domains.combat", "phase_transition/step2_per_meter", 0.01) * max(0.0, projection_distance_m),
		GameConfig.get_float("domains.combat", "phase_transition/step2_min", 0.10),
		GameConfig.get_float("domains.combat", "phase_transition/step2_max", 0.30)
	)
	var total_loss_ratio = clampf(1.0 - (1.0 - eta_1) * (1.0 - eta_2), min_loss_floor, 0.9999)
	var effective_energy_output = raw_mana_input * (1.0 - total_loss_ratio)

	return {
		"raw_input": raw_mana_input,
		"step1_loss_ratio": eta_1,
		"step2_loss_ratio": eta_2,
		"total_loss_ratio": total_loss_ratio,
		"effective_output": effective_energy_output
	}
