# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 视图模型: 角色与主页HUD三层模型解耦
# 文件路径: res://frontend/view_models/character_hud_view_model.gd
# 职责: 落地 Transport DTO ➔ Frontend Domain Model ➔ Reactive ViewModel 三层契约，
#       提供零除安全守卫与货币四级资产格式化，严禁表现层直接暴露底层传输字段
# ==============================================================================
class_name CharacterHudDecoupled
extends RefCounted

const DesignTokens = preload("res://frontend/theme/design_tokens.gd")

## 1. 传输层载荷模型 (严格与传输契约对齐)
class CharacterTransportDTO extends RefCounted:
	var character_id: String = ""
	var nickname: String = ""
	var level_raw: int = 1
	var hp_current: float = 0.0
	var hp_maximum: float = 1.0
	var ap_current: float = 0.0
	var ap_maximum: float = 1.0
	var coins_copper_total: int = 0
	var mana_monocrystals: int = 0

## 2. 前端充血领域模型 (带前端实体校验与计算规则)
class CharacterDomainModel extends RefCounted:
	var id: String = ""
	var name: String = ""
	var level: int = 1
	var current_hp: float = 0.0
	var max_hp: float = 1.0
	var ap_current: float = 0.0
	var ap_max: float = 1.0
	var gold: int = 0
	var silver: int = 0
	var copper: int = 0
	var monocrystals: int = 0

	## 生命值百分比求解 (零除与极端负数防御守卫)
	func get_health_ratio() -> float:
		var safe_max: float = maxf(max_hp, 1.0)
		return clampf(current_hp / safe_max, 0.0, 1.0)

	## 行动力百分比求解 (零除与极端负数防御守卫)
	func get_action_ratio() -> float:
		var safe_max: float = maxf(ap_max, 1.0)
		return clampf(ap_current / safe_max, 0.0, 1.0)

	## 转换自 DTO
	static func from_dto(dto: CharacterTransportDTO) -> CharacterDomainModel:
		var model := CharacterDomainModel.new()
		model.id = dto.character_id
		model.name = dto.nickname
		model.level = maxi(1, dto.level_raw)
		model.current_hp = dto.hp_current
		model.max_hp = maxf(1.0, dto.hp_maximum)
		model.ap_current = dto.ap_current
		model.ap_max = maxf(1.0, dto.ap_maximum)
		model.monocrystals = maxi(0, dto.mana_monocrystals)

		# 铜币折算为金/银/铜三元组
		var total_copper: int = maxi(0, dto.coins_copper_total)
		model.gold = total_copper / 10000
		var rem: int = total_copper % 10000
		model.silver = rem / 100
		model.copper = rem % 100
		return model

## 3. 视图模型 (面向 UI 渲染的呈现包装)
class CharacterHUDViewModel extends RefCounted:
	signal property_changed(prop_name: String, new_val: Variant)

	var character_id: String = ""
	var name_text: String = ""
	var level_badge: String = "Lv.1"
	var hp_display_text: String = "100 / 100"
	var hp_progress_ratio: float = 1.0
	var hp_bar_color: Color = DesignTokens.COLOR_SUCCESS
	var wallet_formatted_string: String = "0 金 0 银 0 铜"
	var monocrystals_text: String = "0"

	## 响应式驱动更新
	func update_from_domain(domain: CharacterDomainModel) -> void:
		if domain == null:
			return
		character_id = domain.id
		name_text = domain.name
		level_badge = "Lv.%d" % domain.level
		# R-08：先经有限性守卫 + clamp（上限 ≥1）再取整，杜绝 current_hp 未 clamp 与 int(NAN)/int(INF) 异常整数
		var safe_cur: float = domain.current_hp if is_finite(domain.current_hp) else 0.0
		var safe_max: float = domain.max_hp if (is_finite(domain.max_hp) and domain.max_hp >= 1.0) else 1.0
		hp_display_text = "%d / %d" % [int(clampf(safe_cur, 0.0, safe_max)), int(safe_max)]
		hp_progress_ratio = domain.get_health_ratio()

		# 血量危险阈值自动换色
		if hp_progress_ratio < 0.25:
			hp_bar_color = DesignTokens.COLOR_ERROR
		elif hp_progress_ratio < 0.50:
			hp_bar_color = DesignTokens.COLOR_WARNING
		else:
			hp_bar_color = DesignTokens.COLOR_SUCCESS

		wallet_formatted_string = "%d 金 %d 银 %d 铜" % [domain.gold, domain.silver, domain.copper]
		monocrystals_text = str(domain.monocrystals)

		property_changed.emit("all", null)
