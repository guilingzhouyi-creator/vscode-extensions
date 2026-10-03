---
name: batch-commit
description: >-
  工作区大型改动分批原子提交与门禁离线预审工作流。当工作区累积了跨架构层次（文档、底层契约、基础设施、配置表、业务逻辑、静态治理）的大型改动时，
  指导 Agent 按依赖拓扑拆分批次、生成结构化提交说明、执行离线门禁预审（pre-flight）并按序原子提交。
---

# batch-commit — 大型改动分批原子提交与门禁预审工作流

本技能规范了跨域大型改动的分批原子提交、门禁离线预审以及双重回归闭环的标准工程化作业流程。

---

## 一、 适用场景与触发条件

当出现以下任一场景时，严禁使用单次巨石提交（Monolithic Commit），必须激活本分批提交工作流：
1. **跨层改动堆叠**：同时涉及文档/案卷索引、底层存储/契约抽象、通用基础设施、配置表同构化、业务领域实现或静态审查治理；
2. **改动文件较多**：暂存区改动涉及超过 15 个文件或跨越 2 个以上顶层架构域；
3. **高敏回滚需求**：改动包含底层数据结构重构，需保证每个提交点均可独立 `git bisect`、编译并 100% 通过测试。

---

## 二、 依赖拓扑分批标准顺序

分批规划必须严格遵守自底向上、解耦可读的拓扑依赖顺序：

```
[第 1 批: docs(archive)]  ───> 规范历史案卷物理命名、全宗目录与顶层索引
          │
          ▼
[第 2 批: feat(persistence)] ─> 底层存储抽象契约、接口定义与流式加载管道
          │
          ▼
[第 3 批: feat(infrastructure)] > 高承压对象池、内存重用与无头装配流水线
          │
          ▼
[第 4 批: feat(config)]  ────> 统一配置资源索引中心与解码解码器
          │
          ▼
[第 5 批: refactor(config)] ──> 配置表 1:1 同构目录化迁移与泛化动态路由
          │
          ▼
[第 6 批: refactor(quality)] ─> 静态审查治理、热点循环降维与控制流平铺
```

---

## 三、 标准分批执行四步闭环 (S-P-C-V)

对每个规划批次，必须严格循环执行以下 4 步：

### Step 1: 显式精准暂存 (`git add`)
严禁裸调 `git add .` 或 `git add -A`。必须显式列出属于当前批次的文件列表：
```powershell
git add path/to/file1.gd path/to/file2.json
```
*注：若有处于 `.gitignore` 规则边界但确需入库的治理脚本，使用 `git add -f <file>` 显式添加。*

### Step 2: 提交信息编写与离线预审 (`commit-msg-gate`)
在本地临时目录（如 scratch 目录）中创建提交信息文件 `commit_batch_N.txt`，必须满足以下硬性条件：
- **标题**：`<type>(<scope>): <简述>`（长度 5~80 字符，不以句号结尾）；
- **正文**：包含 `[Why]`、`[Added]`、`[Changed]`、`[Fixed]`、`[Verification]` 等标准区块；
- **字数**：非轻量提交正文非空白字数 $\ge 30$；
- **零黑话**：正文绝对严禁出现 `phase\d+`、`st\d+`、`p\d+`、`wip`、`temp` 等施工代号。归档案卷编号转换为纯粹产品价值表述；
- **规则反虚构**：提及的规则 ID 必须在 `scripts/common/rule-catalog.json` 中真实存在。

**离线预审指令**：
```powershell
pwsh -File scripts/ps1/commit-msg-gate.ps1 "$dir\commit_batch_N.txt"
```
*必须获得 `Commit-Msg 生产级格式与结构化内容校验全部 PASS！` 方可推进。*

### Step 3: 暂存区物理卫生预审 (`pre-commit-gate`)
在调用 `git commit` 前，先手动触发 Pre-Commit 门禁脚本进行预审：
```powershell
pwsh -File scripts/ps1/pre-commit-gate.ps1
```
*预审看守：零空文件、换行符契约（ps1 严格 CRLF，其余严格 LF）、密钥防泄漏、行数红线预算及 AST 切片复杂度。*

#### 暂存区 AST 切片复杂度阻断自愈指引 (AST Complexity Remediation)
当预审报告 `[ADV-CMP-001]` (CC > 15) 或 `[ADV-NST-001]` (Depth > 4) 阻断时，严格按以下两步平铺控制流：
1. **卫语句提前返回 (Guard Clauses)**:
   - 将嵌套在 `try-catch` 或顶层循环分支内的深层多路分支改为逆向断言提前 `return` 或 `continue`；
2. **纯判定提取 (Pure Predicate Extraction)**:
   - 将复合正则匹配、路径豁免检测或特征判定提取为独立的模块级纯函数（如 `isExemptTestPath`、`detectVacuousTrampoline`），单函数保持单一职责与 0 外部状态依赖；
3. **重新暂存与二次预审**:
   - 重构后运行 `git add <file>` 重新暂存，再次调用 `pre-commit-gate.ps1`，直至全部通过。

### Step 4: 原子提交与状态推进 (`git commit`)
使用准备好的说明文件进行提交，严禁带 `--no-verify`：
```powershell
git commit -F "$dir\commit_batch_N.txt"
```
提交完成后调用 `git status -s` 核查工作树剩余文件，继续推进下一批。

---

## 四、 最终全域双重回归验收

全部批次提交完成、工作树完全 clean 之后，必须同次执行工作区双重全量验证：
1. **跨域全量静态审查门禁**：
   ```powershell
   python WebGames/scripts/py/audit_runner.py
   # 断言 20/20 PASS
   ```
2. **引擎无头回归测试套件**：
   ```powershell
   pwsh .\WebGames\scripts\ps1\test-run.ps1
   # 断言 115/115 套件 100% PASS
   ```
