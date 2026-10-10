# VS Code 扩展高发故障谱系与排错断点

## 一、 激活期故障 (Activation Failures)
- **表现**：扩展加载超时、命令在调色板报错 `command not found`。
- **排查断点**：
  1. 检查 `package.json` 中的 `activationEvents` 是否已匹配触发条件（VS Code 1.74+ 支持按需声明）；
  2. 检查 `activate()` 函数内部是否存在未捕获的 Promise 挂起或同步死锁。

## 二、 Webview 通信受阻 (IPC Failures)
- **表现**：面板空白、点击无响应、状态栏不刷新。
- **排查断点**：
  1. 打开 Webview 开发者工具（`Developer: Open Webview Developer Tools`）；
  2. 检查 CSP（内容安全策略）是否阻断了脚本或内联样式；
  3. 检查 `postMessage` 与 `onDidReceiveMessage` 消息协议是否版本漂移。

## 三、 进程退出异步丢数据
- **表现**：重启编辑器后刚才记录的数据丢失。
- **排查断点**：
  1. `deactivate()` 必须返回 Promise 并确保持久化刷盘完成；
  2. 依赖追加日志（Journal）保障断电级安全。
