# 跨平台子进程隔离与严格错误捕获规范

## 一、 子进程工作目录显式绑定 (`-WorkingDirectory`)

在父脚本调用子项目命令时，严禁依赖当前工作目录（CWD）：
- **错误方式**：`npm test --prefix auto-refactor`（部分配置解析器与 Jest 会读取父目录的根配置，引发误判）；
- **PowerShell 正确方式**：
  ```powershell
  Start-Process -FilePath "npm" -ArgumentList "test" -WorkingDirectory (Join-Path $repoRoot "auto-refactor") -NoNewWindow -PassThru -Wait
  ```
- **Bash 正确方式**：
  ```bash
  (cd "$REPO_ROOT/auto-refactor" && npm test)
  ```

---

## 二、 Bash 退出码平铺捕获 (`set -euo pipefail`)

在声明了 `set -euo pipefail` 的严格脚本中：
- 裸调可能失败并需要断言非 0 退出码的命令会导致脚本提前隐式中断崩溃；
- **标准平铺捕获模式**：
  ```bash
  STATUS=0
  command_that_may_fail || STATUS=$?
  if [[ "$STATUS" -eq 0 ]]; then
      echo "Expected non-zero exit code!" >&2
      exit 1
  fi
  ```
