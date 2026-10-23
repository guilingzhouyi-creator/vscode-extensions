# 跨语言污点数据流溯源、破坏性路径守卫与暴露面隔离深水区指南

本指南详述 `GUARD-DESTR-001`、`GUARD-VAR-001`、`EXT-DIR-001`、`SEC-EXP-*` 与 `PROD-HYG-*` 的静态污点追踪原理与防御范式。

---

## 一、 破坏性删除的污点传播模型 (`GUARD-DESTR-001`)

静态分析器 `shell-safety` 与 `scripts/common/validate-destructive-ops.js` 不仅检查直接字面量（如 `rm -rf /`），还维护**局部符号污点表（Taint Symbol Table）**追踪三类间接传播：

1. **直接污染源（Taint Sources）**：
   - 字面量根或家目录：`/`、`/*`、`~`、`~/*`、`C:\`、`..`、`.`；
   - 环境变量与宿主路径：`$HOME`、`${HOME}`、`$env:HOME`、`$env:USERPROFILE`、`$env:SystemRoot`；
   - 未带默认值守卫的空展开：`"$UNSET_VAR/"`（展开后等价于 `/`）。
2. **赋值链传递（Assignment Propagation）**：
   - 若 `target = $HOME` 或 `sub = "$target"`，则 `target` 与 `sub` 均被标记为 `TAINTED_ROOT_OR_HOME`；
3. **循环迭代器别名传递（Loop Alias Propagation）**：
   - 在 `for item in $tainted_list` 或 `foreach ($item in $tainted)` 中，循环变量 `item` 继承集合的污点标记，后续 `rm -rf "$item"` 立即触发 `GUARD-DESTR-001` 阻断。

### 合法的净室沙箱模式（Sanitized Sink Pattern）
必须通过显式固定前缀 + 非空子目录名断言切断污点：
```bash
# Bash 安全删除模式：参数非空断言 + realpath 规范化 + 沙箱前缀锁定
SANDBOX_ROOT="$(realpath -m "$REPO_ROOT/.sandbox-tmp")"
TARGET_PATH="$(realpath -m "$SANDBOX_ROOT/${ RUN_ID:?RUN_ID must not be empty }")"
if [[ "$TARGET_PATH" == "$SANDBOX_ROOT/"* && "$TARGET_PATH" != "$SANDBOX_ROOT" ]]; then
  rm -rf -- "$TARGET_PATH"
fi
```

---

## 二、 PowerShell 只读自动变量黑名单 (`GUARD-VAR-001`)

以下自动变量由 PowerShell 运行时内核维护，任何左值赋值、`param()` 声明或 `foreach` 循环变量重名均被 `GUARD-VAR-001` 一票否决：

| 类别 | 禁止覆写的只读自动变量 | 推荐替代命名 |
| :--- | :--- | :--- |
| **宿主与用户目录** | `$HOME`, `$PSHome`, `$PWD` | `$userHomeDir`, `$workDir`, `$targetDir` |
| **进程与执行状态** | `$PID`, `$?`, `$LASTEXITCODE`, `$Error` | `$childPid`, `$isOk`, `$exitCode`, `$errRecord` |
| **调用上下文与管道** | `$args`, `$input`, `$_`, `$PSItem`, `$MyInvocation`, `$PSBoundParameters`, `$PSScriptRoot` | `$cliArgs`, `$stdinText`, `$item`, `$invocationInfo` |
| **常量字面量** | `$true`, `$false`, `$null` | 严禁重绑定 |

---

## 三、 前后端与扩展包暴露面边界审计清单 (`SEC-EXP-*` / `PROD-HYG-*`)

在打包 VS Code 扩展（`workspace-timing`）或前端视图组件时，逐项核查：
1. **环境变量白名单投影（`PROD-HYG-003`）**：禁止 `definePlugin({ 'process.env': JSON.stringify(process.env) })`，只允许显式挑选非敏感构建常量（如 `NODE_ENV`）；
2. **Sourcemap 隔离（`PROD-HYG-002`）**：生产打包配置必须关闭外发 sourcemap 或在 `.vscodeignore` 中显式排除 `**/*.map`；
3. **消息通道双向校验（`SEC-VUL-002` / `SEC-EXP-002`）**：Webview `postMessage` 传入宿主的所有指令必须经判别联合 Schema 校验，严禁直接信任前端传入的文件路径或命令参数。
