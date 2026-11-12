# 全局音画设置与独立持久化 (`game_settings`)

> 对应源码：`backend/domains/game_settings/`（3 个 `.gd`）。管理独立于角色存档的 `settings.kalar_cfg` 全局音画与缩放配置，提供数值钳制与分辨率变更 15 秒黑屏安全自动回滚保护。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [game_settings_aggregate.gd](../../../../backend/domains/game_settings/game_settings_aggregate.gd) | `GameSettingsAggregate` | 全局设置聚合根 | 维护音频分轨音量、UI 缩放与渲染开关；提供 `serialize()`/`deserialize()` |
| [settings_apply_driver.gd](../../../../backend/domains/game_settings/settings_apply_driver.gd) | `SettingsApplyDriver` | 热应用与回滚驱动 | `validate_and_sanitize()`、`apply_resolution_with_revert_guard()`、`confirm_settings_applied()`、`tick_revert_timer()`（超时回退 `fallback_width/height`） |
| [settings_persistence_service.gd](../../../../backend/domains/game_settings/settings_persistence_service.gd) | `SettingsPersistenceService` | 设置独立存盘服务 | `save_to_memory_string()`、`load_from_memory_string()`、`save_to_file()`、`load_from_file()` |

---

## 二、关联配置、存档与验证

- **配置与存档**：`domains.game_settings.core`、`narratives.game_settings`；支持热重载可存档策略 `full`（序列化类 `SettingsPersistenceService`）。
- **测试入口**：[test_game_settings.gd](../../../../tests/unit/domains/test_game_settings.gd)。
