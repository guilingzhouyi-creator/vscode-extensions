---
name: defensive-security-and-taint-safety
description: >-
  防御性安全、污点数据流溯源与破坏性操作守卫规范。指导 Agent 落实递归删除三步污点守卫 (GUARD-DESTR-001)、
  只读自动变量防遮蔽 (GUARD-VAR-001)、前后端暴露面隔离 (SEC-EXP-001) 与生产构建洁净度 (PROD-HYG-001)。
---

# defensive-security-and-taint-safety — 防御性安全、污点数据流与破坏性操作守卫规范

本技能确立了工作区在跨平台脚本、文件系统操作、子进程派生、前后端打包边界与凭证管理中的**零信任污点数据流（Taint Dataflow）思维与刚性安全守卫**。回答「在执行任何不可逆副作用或跨边界暴露前，必须完成哪些安全证明」。

---

## 一、 适用场景与触发条件

在以下任一研发或审查场景中，必须激活本技能：
1. **编写或修改含文件删除、目录清空、覆盖移动的代码或脚本**（`rm -rf`、`Remove-Item -Recurse`、`fs.rmSync`、`shutil.rmtree`）；
2. **编写 PowerShell / Bash 脚本处理路径拼接、环境变量展开或循环删除**；
3. **设计客户端/Webview 暴露接口、打包配置（`.vsix` / 前端 Bundle）或环境变量注入**；
4. **排查 `GUARD-DESTR-001`、`GUARD-VAR-001`、`SEC-*`、`PROD-*`、`EXT-DIR-001` 门禁阻断**。

---

## 二、 破坏性文件操作三步污点守卫 (`GUARD-DESTR-001` / `EXT-DIR-001`)

递归删除是工作区破坏半径最大的不可逆操作。静态分析器 `shell-safety` 与守卫 `scripts/common/validate-destructive-ops.js` 会沿**变量赋值链与循环迭代器别名**追踪污点源。任何递归删除操作前必须完成以下**三步前置证明**：

| 防御步骤 | 刚性验证条件 | 典型致命反模式（一票否决） |
| :--- | :--- | :--- |
| **1. 非空与去根校验** | 目标变量非空、非空白，且绝不等于 `/`、`\`、`~`、`$HOME`、`$env:USERPROFILE` 或盘符根目录 `C:\` | `rm -rf "$TARGET_DIR/"`（当 `$TARGET_DIR` 未定义或为空时直接退化为 `rm -rf /`） |
| **2. 规范化绝对路径解析** | 必须先经 `path.resolve` / `Resolve-Path` / `realpath -m` 消除 `..` 路径穿越 | `fs.rmSync(path.join(base, userInput), { recursive: true })` 未拦截 `../../` |
| **3. 沙箱前缀与深度断言** | 规范化路径必须严格以受控沙箱根目录（`REPO_ROOT` 或 `os.tmpdir()`）外加 `/` 开头，且相对深度 $\ge 1$ | 直接对由 `$HOME` 派生的别名变量（如 `$d = $HOME; foreach ($x in $d) { rm -rf $x }`）执行删除 |

- **PowerShell `rm` 包装器双路守卫**：在 `scripts/ps1/lib/linux-parity.ps1` 中，无论走 GNU `rm.exe` 还是降级 `Remove-Item`，都必须在调用前执行 `Assert-SafeRecursiveRemoveTarget` 守卫。

---

## 三、 宿主只读变量防遮蔽与命令注入隔离 (`GUARD-VAR-001` / `SH-SEC-001` / `PS-SEC-001`)

1. **严禁写入或遮蔽 PowerShell 只读自动变量 (`GUARD-VAR-001`)**：
   - `$HOME`、`$PID`、`$PWD`、`$PSHome`、`$args`、`$input`、`$_`、`$?`、`$LASTEXITCODE`、`$MyInvocation`、`$PSBoundParameters`、`$true`、`$false`、`$null` 属于宿主保留自动变量；
   - 严禁作为赋值左值、`param()` 形参名、`foreach ($HOME in ...)` 循环变量或 `catch` 绑定变量（在真实宿主上会抛出 `VariableNotWritable` 致命异常或污染全局会话）。
2. **零动态代码拼接执行 (`SEC-VUL-001` / `PS-SEC-001` / `SH-SEC-001`)**：
   - 严禁使用 `eval`、`new Function()`、`Invoke-Expression` (`iex`) 或将未转义变量拼入 `child_process.exec`；
   - 子进程调用一律使用参数数组分离形式（`execFile` / `spawn(cmd, argsArray)` / PowerShell 标准参数传递）。

---

## 四、 前后端暴露面隔离与生产构建洁净度 (`SEC-EXP-*` / `PROD-HYG-*`)

1. **客户端暴露面五条铁律 (`SEC-EXP-001` ~ `SEC-EXP-005`)**：
   - **禁止服务端密钥/内部配置进前端包 (`SEC-EXP-001` / `SEC-LEAK-001`)**：私钥、数据库连接串与内部管理端点严禁被打包进 Webview 或前端产物；
   - **禁止以 UI 隐藏代替权限校验 (`SEC-EXP-002`)**：前端 CSS 隐藏或条件渲染不具备任何安全边界效力，权限校验必须在后端/宿主侧强制执行；
   - **禁止打包实验或调试路由 (`SEC-EXP-004` / `SEC-EXP-005`)**：生产构建必须剥离 `__debug`、测试桩与未鉴权内部诊断端点。
2. **生产构建洁净度 (`PROD-HYG-001` ~ `PROD-HYG-003`)**：
   - 发布产物严禁残留调试 `console.log` / 未决 `TODO`（`PROD-HYG-001`）、严禁外泄内联或独立 `.map` Sourcemap（`PROD-HYG-002`）、严禁将 `process.env` 全量对象序列化注入客户端包（`PROD-HYG-003`）。
3. **高熵凭证零硬编码 (`secret-detected` / `high-entropy-token` / `HC-SECRET`)**：
   - 源码、测试夹具与技能模板中严禁出现真实 API Key、Bearer Token 或私钥块；测试用伪造凭证必须使用明显低熵占位符（如 `test-placeholder-token-0000`）。

---

## 五、 本地预审命令

```powershell
# 1. 运行跨语言破坏性文件操作与只读变量遮蔽守卫
node scripts/common/validate-destructive-ops.js

# 2. 运行安全沙箱清理样板与内存负样本自检探针
node .agents/skills/defensive-security-and-taint-safety/templates/safe-sandbox-cleanup.js

# 3. 运行 Linux 命令面与 rm 双路前置守卫一致性校验
node scripts/common/validate-shell-parity.js
```

---

## 六、 关联深水区参考与实操样板

- [taint-dataflow-and-exposure-boundaries.md](references/taint-dataflow-and-exposure-boundaries.md)：赋值链/循环别名污点传播判定规则、跨语言路径沙箱守卫范式与前后端暴露面审计清单；
- [safe-sandbox-cleanup.js](templates/safe-sandbox-cleanup.js)：内置三步污点证明与正反双向自检探针的安全沙箱递归清理标准样板。
