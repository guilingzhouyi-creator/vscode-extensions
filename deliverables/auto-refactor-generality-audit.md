# auto-refactor 规则泛化性审计 + 惰性物化可行性（深入审查）

**语料**：本项目 `src`（128 个 `.ts` / 40,194 行 / 1.71 MB）
**方法**：插桩计数 + 隔离计时 + 声明-实现一致性比对。全部数字为实测，推断项已明确标注。

---

## 一、直接回答：规则**没有**泛化

三个层面都未泛化，且已有一条**今天就在生效**的误报作为铁证。

### 1.1 词法规范未泛化（有确凿在效误报）

| 事实 | 实测 |
| :--- | :--- |
| 读取**掩码视图** `ctx.masked` 的规则文件 | **1 个**（`compressionBounds.ts`，即我上一轮修的 CMP 家族） |
| 读取**原文** `ctx.lines` 的规则文件 | **9 个**（codeLogic / debugLogging / exceptionSafety / fileStructure / maintainability / performance / sanitization / standardization / typeSystem） |

**在效误报（已核实）**：`GOV-SAN-001`（LexicalHygieneRule，扫 TODO/FIXME/XXX/HACK 等标记词）在本仓库
自身产生 **8 条命中，且 8/8 全部落在散文行**（掩码视图为空、原文非空的行）。其中一条：

```
GOV-SAN-001  src/analyzers/hygiene.ts:11
 *   TODO/FIXME/XXX/HACK/unimplemented markers, HYG-STB-002 jargon such as pN/stN/phase N/wip
```

`hygiene.ts:11` 是**一句在列举这些标记词的 JSDoc**——规则命中了**描述自己的文档**。这与上一轮在
CMP-\* 消除的"注释/字符串污染"是**同一缺陷类**，只是没有随规范一起迁移。

### 1.2 语言声明未泛化（14/23 条声称全语言适用）

运行时过滤只看 `GovernanceRule.languages`（`registry.ts:127`，未声明 ⇒ **不过滤**）。实测：

| 项 | 实测 |
| :--- | :--- |
| 规则总数 | 23 |
| **未声明 `languages`（对全部 7 种语言生效）** | **14** |
| 已声明（按语言收窄） | 9（其中 6 条为 `typescript,javascript`） |
| 各语言活跃规则数 | ts 22 / js 21 / python 15 / rust 15 / gdscript 14 / shell 14 / powershell 14 |

未声明语言范围的 14 条：`GOV-STD-001`、`GOV-STD-002`、`GOV-FIL-001`、`GOV-FIL-002`、`GOV-LOG-001`、
`GOV-LOG-002`、`GOV-TYP-001`、`GOV-TYP-002`、`GOV-DBG-001`、`GOV-PRF-001`、`GOV-PRF-002`、`GOV-MNT-001`、
`GOV-MNT-002`、`GOV-SAN-001`。

**其中至少两条声明与实现明显不符**（依据各文件自己的文件头）：`typeSystem.ts` 头部自述
"GOV-TYP-001 flags **GDScript** `var name =`…"、"GOV-TYP-002 requires return annotations on
**GDScript** functions and **Python** `def`"，但两条都**未声明语言范围**，因此会在 TS/JS/Rust 文件上被调用。
*推断（待验证）*：它们靠 `checkNode` 内部的 `lang === 'gdscript'` 分支兜住，所以未必产生误报——但
**声明范围与实证范围不一致本身就是规范缺失**，与我上一轮对 CMP 做的"声明范围 ≤ 已证范围"是同一条规范
的未落实处。同时它也是**性能问题**：每条规则在每种语言上都被调用。

### 1.3 形态未泛化（架构层，且与性能直接相关）

实测四条节点级规则的判据（`checkNode` 首行）：

| 规则 | 实际判据 |
| :--- | :--- |
| `GOV-STD-001` | `kind === ControlFlow \|\| Function \|\| Method` |
| `GOV-LOG-001` | `node.functionLike` |
| `GOV-LOG-002` | `kind === Method \|\| Function` |
| `GOV-TYP-002` | `node.functionLike`（+ `supportsStaticTyping`） |

三条规则拿到 AST 节点后**只用来取 `start.line` / `end.line`**，随后回到**原文** `ctx.lines` 做正则：

- `GOV-LOG-002`：`ctx.lines.slice(startLine - 1, endLine).join(' ')` 再匹配 `PASSTHROUGH_RE`
- `GOV-TYP-002`：`ctx.lines[startLine - 1]`
- `GOV-STD-001`：`ctx.lines` 的起止行区间

**它们是穿着"节点规则"外衣的文件规则**：为一个纯词法任务付了整棵 AST 的物化代价（见第二节），
并且继承了 1.1 的原文污染问题。这也是"泛化"缺失的最深一层——同一类"读源码文本做词法判断"的任务，
一族走掩码视图、三族走 AST 取行号、九族直接读原文，三种形态并存。

---

## 二、惰性物化：收益上限 88.9 ms（约扫描的 14.3%）

### 2.1 节点分布（实测 75,374 个归一化节点）

| 节点类型 | 数量 | 占比 | 是否有规则检查 |
| :--- | ---: | ---: | :--- |
| `Other` | 46,016 | 61.1% | ❌ |
| `Call` | 5,679 | 7.5% | ❌ |
| `BinaryExpr` | 5,414 | 7.2% | ❌ |
| `StringLiteral` | 4,901 | 6.5% | ❌ |
| `Variable` | 4,114 | 5.5% | ❌ |
| **`ControlFlow`** | **2,759** | **3.7%** | ✅ `GOV-STD-001` |
| `Block` | 2,671 | 3.5% | ❌ |
| `NumericLiteral` | 2,403 | 3.2% | ❌ |
| **`Function`** | **757** | 1.0% | ✅ LOG-001/002、TYP-002、STD-001 |
| **`Method`** | **415** | 0.6% | ✅ 同上 |
| `Interface` / `Class` | 245 | 0.3% | ❌ |

**四条活跃节点规则真正检查的节点 = 3,931 / 75,374 = 5.2%**（`functionLike` 1,172 + `ControlFlow` 2,759）。

### 2.2 收益上限

归一化实测 **93.8 ms**（= `adapter.parse` 162.1 − 原生 `ts.createSourceFile` 68.3）。
跳过 94.8% 的物化，**上限收益 88.9 ms ≈ 整个扫描的 14.3%**。

> **这是上限**：惰性节点被访问时仍有成本，且 `ControlFlow` 规则需要子树。真实收益会低于此，但量级明确。

### 2.3 与解析器替换的对比（同一语料）

| 方案 | 实测收益 | 门槛 |
| :--- | ---: | :--- |
| 解析器换 oxc | **3.8%**（且改变 15 条结论） | 未达 >20% ⇒ **止损** |
| **跳过非必需节点的物化** | **上限 14.3%** | **不作为的收益是它的 3.7 倍** |

结论：**解析层不换解析器，改物化策略。**

---

## 三、建议的执行顺序

| 优先级 | 动作 | 依据 | 备注 |
| :--- | :--- | :--- | :--- |
| **1** | **把词法规范推广到 9 个读原文的规则文件**，并为每条补"触发词只出现在注释/字符串"的负样本夹具 | §1.1 有在效误报（GOV-SAN-001 8/8） | 与上一轮 CMP 的修法完全同构，风险低；夹具可直接固化本次审计发现 |
| **2** | **修正 14 条规则的语言声明**，使声明范围 = 夹具已证范围 | §1.2 | 需先补各语言夹具；`GOV-TYP-001/002` 是最明显的两条 |
| **3** | **节点规则去 AST 化**：让它们用"匹配到的函数头行号"而非 AST 起止行 | §1.3 | 与第 4 项共同解锁惰性物化 |
| **4** | **惰性/按需物化**（只构造活跃规则需要的节点类型） | §2.2 上限 14.3% | 结构改动，建议先做一次 POC 只测 `Other` 桶（61%）能否省掉 |
| — | 解析器换 oxc | §2.3 未达门槛 | **不做** |
| — | 两条解析路径 15 条结论不一致 | 上一轮已登记 | 需独立决策：补语义或改文档 |

---

## 四、方法说明与边界

- **"散文行"判定**：某 finding 的行号处，掩码视图 `trim()` 为空而原文非空 ⇒ 该 finding 落在注释/字符串上。
  这是"规则无法区分散文与代码"的签名。
- **需要人工剔除的伪信号**：`large-file` 的 28 条"散文行"命中全部在**第 1 行**（该规则按约定报文件级位置），
  `hardcoded-string` 的 5 条落在**长字符串延续行**（规则语义本就是报字符串）——二者都不是误报，
  已在结论中排除，未计入 §1.1 的证据。
- **未做**：`ctx.lines` 的 9 个文件尚未逐条构造负样本夹具（那正是建议第 1 项的工作），
  因此 §1.1 只把**已经核实**的 `GOV-SAN-001` 作为铁证，其余文件保持"疑似"而非断言。

> **§1.1 的后续更正（务必连读 §五）**：执行后的复核表明，`GOV-SAN-001` 的 8 条散文命中里
> **只有 1 条是真误报**（列举词汇表那句）；其余 7 条是**规则合法目标**——该规则的设计就是检查注释里的
> 批次术语，命中注释是应有行为。"散文命中"是"规则读了原文"的**签名**，不等于"误报"。

---

## 五、执行结果：规范迁移与误报清除（本轮）

### 5.1 已迁移到掩码视图的规则（提纯泛化）

| 文件 | 规则 | 依据（证据位于代码） |
| :--- | :--- | :--- |
| `debugLogging.ts` | GOV-DBG-001 | 调试调用在代码中；原规则只跳过**行首**为注释的行，**行内注释与字符串**里的调试标识符会被误报 |
| `codeLogic.ts` | GOV-LOG-002 | `return this.x.y(...)` 形态匹配，作用于函数体代码 |
| `standardization.ts` | GOV-STD-001 / 002 | `var`、`pass`、单行布尔分支均为代码 |
| `typeSystem.ts` | GOV-TYP-001 / 002 / 003 | 类型注解位于签名行（代码） |
| `performance.ts` | GOV-PRF-001 ~ 004 | 循环内查找、定时器字面量、同步 I/O 均为代码 |

### 5.2 `GOV-SAN-001` 的通用化（不是屏蔽，而是换判据）

该规则**本就是注释检查器**（只处理注释行），不能改读掩码视图。其真缺陷是**硬编码豁免**：
文件名豁免（`audit_script_comment.py`、`test_falsifiability`）+ 行内容豁免（含 `JARGON_RE` /
`LexicalHygieneRule` / `GOV-SAN-001` / `COMMENT-JARGON` 即跳过）。后果是**任何别的文件一旦记录这套
词汇表就会被误报**——`analyzers/hygiene.ts:11` 那句"列举 `TODO/FIXME/XXX/HACK`…如 `pN/stN/phase N/wip`"
就是这样被 `wip` 命中的。

**通用判据**：标记词若**紧邻 `/`**（`pN/stN/phase N/wip`），它属于**清单条目**而非**应用的标签**。
同时移除了两个项目专有的路径豁免（`audit_script_comment.py`、`test_falsifiability`）——那是
项目中立性违规。保留的 `/tests/`、`/test/`、`/benchmarks/`、自身文件名属通用约定。

### 5.3 两处**过度迁移**被门禁与指标抓回（重要）

盲目地"把 `ctx.lines` 换成 `ctx.masked`"是错的。两处被系统挡下：

| 文件 | 症状 | 根因 | 处置 |
| :--- | :--- | :--- | :--- |
| `exceptionSafety.ts` | `GOV-EXC-001` 命中 **1 → 45** | 该规则靠读取**注释里的 rationale 标记**来豁免"已记录的 catch"；掩码抹掉注释等于抹掉豁免证据 | **回退**，并在代码处留下判据注释 |
| `maintainability.ts` | `validate-governance` 第 5 项 `GOV-MNT-002` 断言失败（规则停火） | 该族匹配**模块说明符与层路径**，而说明符就在**字符串字面量**里，被掩码抹掉 | **回退** |

**由此提纯出一条可执行的决策规则（建议写入项目规范）**：

> **仅当规则的证据位于「代码」时才读掩码视图。** 证据位于
> ① 字面量取值 / 模块说明符，② 注释中承载的记录性理由（如 catch 的理由标记），
> ③ 规则本身就是注释检查器（头部/路径/术语规则）——这三类必须读原文 `ctx.lines`。

### 5.4 误报清除实测（本仓库自身 `src`）

| 规则 | 前 | 后 | 说明 |
| :--- | ---: | ---: | :--- |
| `GOV-DBG-001` | 11 | **0** | 11 条全部由行内注释/字符串里的调试标识符触发 |
| `GOV-PRF-004` | 90 | **86** | 其中 1 条落在散文行 |
| `GOV-SAN-001` | 8 | **7** | 清除枚举词汇表那条 |
| `GOV-TYP-003` | 112 | 111 | — |
| `GOV-PRF-003` | 1 | 0 | — |
| **合计** | **3964** | **3945** | **−19 条** |

**未消音真阳性的证明**：`validate-governance` 断言 `debug_logging` 类别在真实代码夹具上**仍有 2 条命中**
（`GOV-DBG-001` 在语料上归零、在夹具上照常命中）。且 8 个类别的计数与改造前**逐项一致**
（standardization 2 / file_structure 5 / code_logic 1 / type_system 4 / exception_safety 3 /
debug_logging 2 / performance 3 / maintainability 5）。

### 5.5 审计方法的两个盲区（自我更正）

执行过程暴露了我上一轮审计方法的两个缺陷，一并记录：

1. **"散文命中"≠"误报"**：判定只说明该行的掩码视图为空。但有些规则的**合法目标就是注释**
   （`GOV-SAN-001` 查注释术语、`GOV-FIL-*` 查头部声明）。必须按规则的**语义**分类后才能报数。
2. **行内散文与"异地报位"会漏检**：`GOV-DBG-001` 的 11 条命中其行首是**代码**（行内注释或字符串），
   故我的检测器认为是代码行；而规则若把位置报在**另一行**（如行 1 或函数头），检测器会看错行。
   ⇒ 审计应改为"**规则匹配到的那一行**"而非"报告位置的那一行"。

### 5.6 仍未做（需独立排期）

| 项 | 原因 |
| :--- | :--- |
| 14 条规则的语言声明收窄 | **需要先为各语言补齐夹具**再改声明，否则会重演"声明了却无验证"。属独立批次 |
| `debugLogging.ts` 的 `index.ts`/`cli.ts`/`/scripts/`/`/samples/` 路径豁免 | 应改为经 `thresholds` 下发的可配置 glob（同 `blockingIoAllowPatterns` 的既有做法），当前仍是硬编码 |
| `sanitization.ts` 的行级内容豁免 | 通用判据已覆盖主要场景，但 `JARGON_RE`/`GOV-SAN-001` 等名字豁免仍是"名字即豁免"的做法，待统一 |

### 5.7 验证状态与未决阻塞（必读）

**已通过的验证**（本轮改动后实跑，均 exit 0）：

`lint`｜`format:check`｜`gate:comments`｜`gate:self`｜**`validate-governance` 20/20**｜`validate-compression`｜`validate-data-flow`

**未能完成的验证**：完整 `npm run gate` **未跑通**。阻塞点是 `validate-diff-interface.js`
**在其第 4 段（CLI changed-set 模式）挂起**——独立运行（清空全部 node 进程后）仍超时，无任何输出。
因此**本轮不能声称"全门禁通过"**。

同时在该文件中发现并修复了一处**独立成立的环境脆弱性**：其临时夹具仓库执行 `git commit` 时只传了
`user.email`/`user.name`，**未关闭 GPG 签名**，于是继承全局 `commit.gpgsign=true`（本机已确认该配置为
`true`，`gpg.program = C:\Program Files\Git\usr\bin\gpg.exe`）。密钥环不可用时 `git commit` 会**永久
阻塞等待口令**，把整个门禁拖死。已补 `-c commit.gpgsign=false`、20 秒 `timeout` 与
`GIT_TERMINAL_PROMPT=0`——夹具仓库不得继承开发者的全局 git 身份与签名策略。

但补丁后**该套件在一次隔离复测中仍超时**，因此**挂起的精确阻塞调用尚未定位**，归因不完整。
*（我为此做的 stash 归因实验执行失败、未创建任何 stash；工作树中本轮改动经内容核对全部在位。）*

**另需你确认的一处异常**：从仓库根目录执行 `git rev-parse --show-toplevel` 现报
`fatal: not a git repository`，而 `C:\CODE_game-development\vscode-extensions\.git` **确实存在**且内含
`HEAD`/`config`/`objects`/`index`——但**条目中未见 `refs`**。我未对工作区执行任何破坏性 git 命令，
故不建议由我继续处置，请自行核验该仓库完整性。


