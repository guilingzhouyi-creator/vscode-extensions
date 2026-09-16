# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/currency_economy/currency_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/currency.json | 信号: EventBus 领域广播
# 职责说明: 铜/银/金/白金换算比率、物理负重约束与战略能源魔单晶本位。 换算比率与单币质量由 config/currency.json 驱动，代码零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CharacterWalletEntity extends RefCounted

const COIN_COPPER: String = "copper"
const COIN_SILVER: String = "silver"
const COIN_GOLD: String = "gold"
const COIN_PLATINUM: String = "platinum"
const COIN_MONOCRYSTAL: String = "monocrystal"
const COIN_MANA_MONOCRYSTALS: String = "mana_monocrystals"

## 合法币种字段（apply_delta 的键域；新增币种时在此登记）
const CURRENCY_FIELDS: Array[String] = [COIN_COPPER, COIN_SILVER, COIN_GOLD, COIN_PLATINUM, COIN_MANA_MONOCRYSTALS]

var copper: int = 0
var silver: int = 0
var gold: int = 0
var platinum: int = 0
var mana_monocrystals: int = 0 # 战略能源高阶本位货币

func get_total_copper_value() -> int:
	return (
		copper * _rate(COIN_COPPER) +
		silver * _rate(COIN_SILVER) +
		gold * _rate(COIN_GOLD) +
		platinum * _rate(COIN_PLATINUM)
	)

func calculate_total_currency_mass_kg() -> float:
	return (
		float(copper) * _mass_kg(COIN_COPPER) +
		float(silver) * _mass_kg(COIN_SILVER) +
		float(gold) * _mass_kg(COIN_GOLD) +
		float(platinum) * _mass_kg(COIN_PLATINUM) +
		float(mana_monocrystals) * _mass_kg(COIN_MONOCRYSTAL)
	)

# ==============================================================================
# 负债与赤字状态（支持突破下界）
# ==============================================================================

## 是否处于负债/赤字状态（折合铜币总资产小于 0）
func is_in_debt() -> bool:
	return get_total_copper_value() < 0

## 获取净负债额（折合铜币数；非负数，无负债时返回 0）
func get_net_debt_copper() -> int:
	var total = get_total_copper_value()
	return abs(total) if total < 0 else 0

## 允许突破下界的强制记账扣款（违约/罚金/欠款直接借记铜币赤字）
func incur_debt(debt_copper: int) -> Dictionary:
	if debt_copper <= 0:
		return {"success": false, "error_code": "NEGATIVE_AMOUNT"}
	var max_debt := maxi(0, GameConfig.get_int("domains.currency", "debt/max_debt_copper", 1000000000))
	if get_net_debt_copper() + debt_copper > max_debt:
		return {"success": false, "error_code": "DEBT_LIMIT_EXCEEDED"}
	copper -= debt_copper
	return {"success": true, "debt_delta": debt_copper}

# ==============================================================================
# 账本操作（全域钱包变更统一入口）
# ==============================================================================

## 多币种增减统一入口：键 ∈ CURRENCY_FIELDS，值为整数增量（负数即扣减）。
## 纯账本操作：不发事件、不做余额校验——带领域前置判定的定向扣减由调用方
## 先行检定后调用；需要「总额折算 + 阶梯扣除」语义时使用 try_spend。
func apply_delta(delta: Dictionary) -> Dictionary:
	return apply_transaction(delta, false)

## 统一钱包提交边界。普通奖励只允许非负增量；扣款/追缴必须明确声明 signed。
func apply_transaction(delta: Dictionary, allow_signed: bool = false) -> Dictionary:
	if delta == null:
		return {"success": false, "error_code": "INVALID_DELTA"}
	var key_err := _validate_transaction_keys(delta)
	if not key_err.is_empty():
		return key_err

	var calc_result := _calculate_transaction_values(delta, allow_signed)
	if not bool(calc_result.get("ok", false)):
		return Dictionary(calc_result.get("error", {}))

	var next_values: Dictionary = calc_result.get("values", {})
	if allow_signed and not _validate_debt_limit(next_values):
		return {"success": false, "error_code": "DEBT_LIMIT_EXCEEDED"}

	from_dictionary(next_values)
	return {"success": true, "delta": delta.duplicate(true)}

## 校验增量键名合法性（必须属于 CURRENCY_FIELDS）
func _validate_transaction_keys(delta: Dictionary) -> Dictionary:
	for key in delta.keys():
		if not CURRENCY_FIELDS.has(str(key)):
			return {"success": false, "error_code": "UNKNOWN_CURRENCY", "currency": str(key)}
	return {}

## 计算交易后余额并执行类型/符号/溢出校验
func _calculate_transaction_values(delta: Dictionary, allow_signed: bool) -> Dictionary:
	var next_values := to_dictionary()
	for field in CURRENCY_FIELDS:
		if not delta.has(field):
			continue
		var check := _apply_field_delta(int(next_values[field]), delta[field], allow_signed)
		if not bool(check.get("ok", false)):
			return {"ok": false, "error": {"success": false, "error_code": check.get("error_code", ""), "currency": field}}
		next_values[field] = int(check.get("result", 0))
	return {"ok": true, "values": next_values}

## 校验并计算单币种字段增量
func _apply_field_delta(current: int, val: Variant, allow_signed: bool) -> Dictionary:
	if not (val is int or val is float):
		return {"ok": false, "error_code": "INVALID_AMOUNT"}
	var amount := int(val)
	if not allow_signed and amount < 0:
		return {"ok": false, "error_code": "NEGATIVE_AMOUNT"}
	var candidate: int = current + amount
	if _is_overflow(amount, current, candidate):
		return {"ok": false, "error_code": "AMOUNT_OVERFLOW"}
	return {"ok": true, "result": candidate}

## 检测整数加减是否发生数值溢出
func _is_overflow(amount: int, current: int, candidate: int) -> bool:
	if amount > 0 and candidate < current:
		return true
	if amount < 0 and candidate > current:
		return true
	return false

## 校验负债上限是否超额
func _validate_debt_limit(values: Dictionary) -> bool:
	var max_debt := maxi(0, GameConfig.get_int("domains.currency", "debt/max_debt_copper", 1000000000))
	var copper_total := int(values.copper) * _rate(COIN_COPPER) + int(values.silver) * _rate(COIN_SILVER) + int(values.gold) * _rate(COIN_GOLD) + int(values.platinum) * _rate(COIN_PLATINUM)
	return -copper_total <= max_debt

func to_dictionary() -> Dictionary:
	return {"copper": copper, "silver": silver, "gold": gold, "platinum": platinum, "mana_monocrystals": mana_monocrystals}

func from_dictionary(values: Dictionary) -> void:
	for field in CURRENCY_FIELDS:
		if values.has(field):
			set(field, int(values[field]))

## 按铜币总价的阶梯支出：足额才扣（铜→银→金→白金，高等级币拆零找零回铜币）。
## 返回 false 时钱包分文未动（含防御性中途不足分支，正常情况下由总额预检保证不触发）。
## 注意与「单/双币种定向扣减」的语义差异：本方法按折算总额扣，银不够金来凑；
## 想要保持「只看指定币种字段」的判定请继续使用显式字段操作。
func try_spend(cost_copper: int) -> bool:
	if cost_copper <= 0:
		return false
	var total_val = get_total_copper_value()
	if total_val < cost_copper:
		return false

	var remaining_to_deduct = cost_copper

	var deduct_copper = min(copper, remaining_to_deduct)
	copper -= deduct_copper
	remaining_to_deduct -= deduct_copper

	if remaining_to_deduct > 0:
		remaining_to_deduct = _deduct_ladder("silver", remaining_to_deduct)

	if remaining_to_deduct > 0:
		remaining_to_deduct = _deduct_ladder("gold", remaining_to_deduct)

	if remaining_to_deduct > 0:
		remaining_to_deduct = _deduct_ladder("platinum", remaining_to_deduct)

	if remaining_to_deduct > 0:
		return false
	return true

## 在单个金属层级上按汇率扣减；超额找零回铜币，返回剩余未清偿金额
func _deduct_ladder(metal: String, remaining_to_deduct: int) -> int:
	# 汇率来自配置且可热重载，为 0 时下面的除法会产出 inf/NaN 并污染钱包结算
	var rate := maxi(1, GameConfig.get_int("domains.currency", "rates/" + metal, 1))
	var available: int = get(metal)
	var metal_needed = int(ceil(float(remaining_to_deduct) / float(rate)))
	var deduct_metal = min(available, metal_needed)
	set(metal, available - deduct_metal)
	var metal_val = deduct_metal * rate
	if metal_val > remaining_to_deduct:
		copper += (metal_val - remaining_to_deduct)
		return 0
	return remaining_to_deduct - metal_val

# ==============================================================================
# 配置读取
# ==============================================================================

func _rate(metal: String) -> int:
	# L3（Phase 55）：折算率非负下限（Inv-VD-2）——键缺失/写 0 时 0 折算，防负数错乘放大债务
	return maxi(0, GameConfig.get_int("domains.currency", "rates/" + metal, 1))

func _mass_kg(metal: String) -> float:
	return GameConfig.get_float("domains.currency", "coin_mass_kg/" + metal, 0.010)
