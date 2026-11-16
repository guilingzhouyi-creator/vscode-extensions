# 卡拉尔伴侣跨进程 IPC 客户端示例 (Companion IPC v1)

本目录提供与引擎本地回环服务 `CompanionIPCServer` 对接的最小零依赖客户端参考实现，遵循协议版本 `kalar.companion.ipc.v1`。

## 1. 传输与鉴权契约

- **监听端点**：默认仅绑定 `127.0.0.1:19420`（测试或嵌入式工具亦可通过环境变量 / `--port` 指定动态空闲端口）。
- **帧格式**：单行 UTF-8 JSON 对象并以换行符 `\n` 结尾。
- **鉴权规则**：连接建立后须先通过 `auth` 指令或首帧携带 `"auth_token"` 完成常量时间口令验证（推荐通过 `KALAR_COMPANION_TOKEN` 环境变量或 `--token` 传入，切勿硬编码凭证）。

## 2. 支持的 IPC 指令方法

| 方法名 | 参数示例 | 职责说明 |
| :--- | :--- | :--- |
| `auth` | `{"auth_token": "..."}` | 执行连接级会话口令鉴权 |
| `ping` | `{}` | 探测服务存活状态与绑定端口 |
| `get_observation` | `{}` | 拉取当前推演节点与可交互选项快照 |
| `step` | `{"choice_id": "..."}` | 向推演会话提交单步抉择推进 |
| `rollback` | `{}` | 回滚至上一稳定历史快照节点 |
| `inspect_blackbox` | `{}` | 提取黑匣子最近诊断转储与事件尾迹 |
| `hot_reload_poll` | `{}` | 触发 MOD 目录增量扫描与热重载校验 |
| `hot_reload_status` | `{}` | 查询当前热重载监听状态与重载计数 |

## 3. 快速运行示例

```bash
# Python 标准库客户端演练
python WebGames/mod_sdk/examples/companion_ipc/companion_ipc_client.py --port 19420 --token "$KALAR_COMPANION_TOKEN" --demo

# Node.js 内置 net 模块客户端演练
node WebGames/mod_sdk/examples/companion_ipc/companion_ipc_client.mjs --port 19420 --token "$KALAR_COMPANION_TOKEN" --demo
```
