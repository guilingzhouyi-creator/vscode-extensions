# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/dto/localization_i18n_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 承载全域多语言国际化运行状态快照与跨域只读查询结构
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## LocalizationI18nDTO：Value Object DTO / Data Transport Model
class_name LocalizationI18nDTO
extends RefCounted

var current_locale: String = "zh_CN"
var fallback_locale: String = "en_US"
var supported_locales: Array = ["zh_CN", "en_US", "ja_JP", "zh_TW"]
var loaded_locales: Array = []
var total_keys_count: int = 0
var missing_name_keys_count: int = 0
var is_cjk: bool = true

## 导出为标准传输字典
func to_dto() -> Dictionary:
    return {
        "current_locale": current_locale,
        "fallback_locale": fallback_locale,
        "supported_locales": supported_locales.duplicate(),
        "loaded_locales": loaded_locales.duplicate(),
        "total_keys_count": total_keys_count,
        "missing_name_keys_count": missing_name_keys_count,
        "is_cjk": is_cjk
    }

## 从字典数据重建 DTO 对象
static func from_dto(data: Dictionary) -> LocalizationI18nDTO:
    var dto := LocalizationI18nDTO.new()
    dto.current_locale = String(data.get("current_locale", "zh_CN"))
    dto.fallback_locale = String(data.get("fallback_locale", "en_US"))
    dto.supported_locales = Array(data.get("supported_locales", ["zh_CN", "en_US", "ja_JP", "zh_TW"]))
    dto.loaded_locales = Array(data.get("loaded_locales", []))
    dto.total_keys_count = int(data.get("total_keys_count", 0))
    dto.missing_name_keys_count = int(data.get("missing_name_keys_count", 0))
    dto.is_cjk = bool(data.get("is_cjk", true))
    return dto
