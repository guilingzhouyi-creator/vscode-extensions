# 聊天斜杠指令与开发直发通道 (`chat_command`)

> 对应源码：`backend/domains/chat_command/`（4 个 `.gd`）。提供斜杠命令词法分析、全域命令注册表、带记忆的最近 GM 指令有界 MRU 补全池，以及面向开发/测试场景的表驱动快捷兑换通路。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与并存契约 |
| :--- | :--- | :--- | :--- |
| [chat_command_parser.gd](../../../../backend/domains/chat_command/chat_command_parser.gd) | `ChatCommandParser` | 斜杠命令词法解析器 | `parse_input_line()` 解析 `/cmd arg1 arg2` 与参数类型推导 |
| [command_registry_engine.gd](../../../../backend/domains/chat_command/command_registry_engine.gd) | `CommandRegistryEngine` | 指令注册与补全中枢 | `register_command()`、`unregister_command()`、`dispatch_command()`、`get_autocomplete_suggestions()` |
| [gm_command_index.gd](../../../../backend/domains/chat_command/gm_command_index.gd) | `GmCommandIndexSolver` | MRU 历史记录与分页补全 | `record_usage()`、`query()`、`next_page()`、`prev_page()`、`apply_recent_completion()`（按 `gm_index/*` 控制 20 条上限与分页缓冲池） |
| [reward_dispatch_pipeline.gd](../../../../backend/domains/chat_command/reward_dispatch_pipeline.gd) | `RewardDispatchPipeline` | 开发直发测试兑换管线 | `redeem_cdkey()`（与 `cdkey_voucher` 为刻意并存的双契约，不可混淆或互吞） |

---

## 二、关联配置与验证

- **配置映射**：`domains.chat_command.core` 与 `narratives.chat_command`。
- **测试入口**：[test_chat_command.gd](../../../../tests/unit/domains/test_chat_command.gd)。
