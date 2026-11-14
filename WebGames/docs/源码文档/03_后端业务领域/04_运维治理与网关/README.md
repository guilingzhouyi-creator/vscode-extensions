# 04 运维治理与网关集群

> 本集群收录持久化与双域存储协议、世界网关与模式隔离、GM 审计与资产追缴、全局设置、灰度熔断、i18n 本地化、事件驱动音频、红点通知、维护公告、旁路遥测与事件抽取、多硬件输入共 **12 个**后端业务领域（合计 81 个 `.gd` 文件）。

---

## 领域目录索引

| 文档 | 领域 ID (`domains.json`) | 脚本数 | 配置主表 | 测试入口 |
| :--- | :--- | :---: | :--- | :--- |
| [persistence_protocol.md](persistence_protocol.md) | `persistence_protocol` | 28 | `infrastructure.persistence`（豁免复用） | [test_persistence_protocol.gd](../../../../tests/unit/domains/test_persistence_protocol.gd) |
| [world_gateway.md](world_gateway.md) | `world_gateway` | 16 | `domains.world_gateway.core` | [test_world_gateway.gd](../../../../tests/unit/domains/test_world_gateway.gd) |
| [admin_sandbox.md](admin_sandbox.md) | `admin_sandbox` | 6 | `infrastructure.admin`（豁免复用） | [test_admin_sandbox.gd](../../../../tests/unit/domains/test_admin_sandbox.gd) |
| [game_settings.md](game_settings.md) | `game_settings` | 4 | `domains.game_settings.core` | [test_game_settings.gd](../../../../tests/unit/domains/test_game_settings.gd) |
| [feature_toggle_canary.md](feature_toggle_canary.md) | `feature_toggle_canary` | 3 | `domains.feature_toggle_canary.core` | [test_feature_toggle_canary.gd](../../../../tests/unit/domains/test_feature_toggle_canary.gd) |
| [localization_i18n.md](localization_i18n.md) | `localization_i18n` | 5 | `domains.localization_i18n.core` | [test_localization_i18n.gd](../../../../tests/unit/domains/test_localization_i18n.gd) |
| [event_driven_audio.md](event_driven_audio.md) | `event_driven_audio` | 3 | `domains.event_driven_audio.core` | [test_event_driven_audio.gd](../../../../tests/unit/domains/test_event_driven_audio.gd) |
| [notification_red_dot.md](notification_red_dot.md) | `notification_red_dot` | 3 | `domains.notification_red_dot.core` | [test_notification_red_dot.gd](../../../../tests/unit/domains/test_notification_red_dot.gd) |
| [bulletin_board_maintenance.md](bulletin_board_maintenance.md) | `bulletin_board_maintenance` | 3 | `domains.bulletin_board_maintenance.core` | [test_bulletin_board_maintenance.gd](../../../../tests/unit/domains/test_bulletin_board_maintenance.gd) |
| [telemetry_account_lifecycle.md](telemetry_account_lifecycle.md) | `telemetry_account_lifecycle` | 3 | `domains.telemetry_account_lifecycle.core` | [test_telemetry_account_lifecycle.gd](../../../../tests/unit/domains/test_telemetry_account_lifecycle.gd) |
| [event_extractor.md](event_extractor.md) | `event_extractor` | 2 | `domains.event_extractor.core` | [test_event_extractor.gd](../../../../tests/unit/domains/test_event_extractor.gd) |
| [hardware_input.md](hardware_input.md) | `hardware_input` | 5 | `domains.hardware_input.core` | [test_hardware_input.gd](../../../../tests/unit/domains/test_hardware_input.gd) |
