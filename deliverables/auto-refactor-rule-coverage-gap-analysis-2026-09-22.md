# auto-refactor 规则审查集完备性评估与 Agent 编程专项补强提案

> ⚠️ **方案部分已被取代**：本文件的**缺口清单与探针证据仍然有效**（作为需求来源保留）；
> 方案与提案部分请以 `auto-refactor-moe-osdiff-rule-expansion-plan-v2-2026-09-22.md` 为准
> （v2 已按 MoE 稀疏激活架构、Praxis Agent OSDIff 契约、泛化/多语言/性能三项约束重写）。

> **评估对象**：`auto-refactor/` 规则审查集（174 条注册规则 / 22 个分析器）
> **评估日期**：2026-09-22
> **评估方式**：只读。数据源为 `dist/core/rules/registry` 运行时真源、`auto-refactor.config.json`、`docs/04-analyzers-and-rules/01-builtin-rules.md`，并以探针脚本对 `src/**/*.ts` + `scripts/*.js` + config 共 371 个文件做实现存在性核验
> **性质说明**：本文件是**评估与提案**，不含任何规则实现，也未改动被测工程

---

## 0. 结论摘要

| 判断 | 结论 |
| :--- | :--- |
| 审查集是否完备 | **在"传统静态分析 + 本项目自定治理"口径下已属高完备度**（174 条、22 分析器、8 支柱量化、跨 5 语言），**但在 Agent 编程口径下不完备** |
| 最强项 | 架构边界（ARCH 23 条）、工程治理（GOV 24 条）、认知复杂度（CMP/CPX 13 条）、性能与内存（PRF 10 条） |
| 最弱项 | **可靠性语义**（非确定性、异步正确性、超时/重试/幂等）与 **协作/供应链流程面**——两者均属结构性空白，非个例遗漏 |
| Agent 特有失效模式 | 仅 `GOV-AGN-001` / `GOV-SLC-001` / `GOV-TRJ-001` 三条真正命中，**其余（指令面注入、幻觉 API、危险操作原语、变更爆炸半径、工作区残留）为零覆盖** |
| 结构性隐患 | **规则"存在"≠"生效"**：本仓库自审配置仅启用 9 个分析器，实际生效 **97/174**；`securityLevel` 未声明 → `SEC-VUL-001~006`（含 `eval` 与命令注入）在自审中**全部不生效** |
| 建议 | 分 4 批补齐 **27 条**新规则（P0 **7** 条 / P1 **12** 条 / P2 **8** 条），其中 P0 直接对应 Agent 自主行为的高危面；并确立"安全规则默认开启（fail-closed）"与"规则生效面纳入门禁"两条原则 |

---

## 1. 评估口径

1. **可用面 vs 生效面分离**：先清点注册表全部可用规则（174），再对照消费方配置计算实际生效规则数。二者差异本身即完备性的组成部分。
2. **缺口必须经"实现存在性探针"核验**：对每个疑似缺口，在 `src/` + `scripts/` + config 全量语料中检索对应实现信号；只有**零命中**（`ABSENT`）或仅命中"同名词但非规则实现"的项，才判定为缺口。
3. **不重复计已覆盖项**：报告单列「已确认无需补」，避免用清单长度冒充缺口。

### 1.1 规则集分布（运行时真源实测）

| 维度 | 分布 |
| :--- | :--- |
| 规则总数 | **174** |
| 分析器数 | **22** |
| 家族（family） | GOV 24 · ARCH 23 · PYM 12 · CMT 10 · PRF 10 · TSM 10 · CPX 9 · DEP 9 · HYG 9 · NAM 9 · SEC 7 · RSM 7 · GDM 7 · DAT 5 · TST 5 · CMP 4 · SIM 4 · LEGACY 4 · DOC 3 · LANG 1 · ERR 1 · BIG 1 |
| 级别 | `error` **26** · `warning` **135** · `info` **13** |
| 覆盖语言 | TypeScript/JavaScript · Python · Rust · GDScript · Markdown（Shell/PowerShell 经 governance 通用层） |
| 自审生效面 | **97 / 174**（`auto-refactor.config.json` 显式启用 constants / complexity / large-file / governance / architecture / performance / comments / hygiene / simplify） |

### 1.2 已具备的 Agent 相关能力（应当肯定的既有设计）

| 规则 | 级别 | 命中的 Agent 失效模式 | 评价 |
| :--- | :--- | :--- | :--- |
| `GOV-AGN-001` | error | 多 Agent 并发修改 → 架构边界突破、跨模块循环依赖、公共契约破坏 | **高度前瞻**，同类工具中罕见 |
| `GOV-SLC-001` | error | AST 切片改动 → 破坏性签名漂移、副作用沿调用链扩散 | 有效，但口径限定于"切片"，非通用破坏性变更 |
| `GOV-TRJ-001` | error | 改造轨迹震荡（Flip-Flop）、反向退化、反模式死灰复燃 | 直击 Agent 反复重写的典型病征 |
| `GOV-GAM-001` + `CPX-HOP-001` + `TST-TAU-001` + `TST-ILS-001` + `TST-SKP-001` | warning~error | 机械拆函数压复杂度、恒真断言、Mock 幻觉测试、长期跳过用例 | **完整覆盖"指标刷分"族**，是 Agent 自评最常见的作弊面 |
| `CPX-RED-001` | warning | 跨文件分布式冗余（同一逻辑被反复重写） | 直击 Agent 缺乏全局视野导致的重复实现 |
| `PRF-POL-001/002/003` | warning/error | 池化缺失 / 池化不健全（无 reset 契约、无容量上限）/ 负收益池化 | 覆盖资源生命周期，含"过度池化"反向面 |
| `ARCH-CFG-001~007` | info~warning | 死配置、配置重复定义、隐式散落、过度抽象 | 覆盖配置治理 7 个面，属少见深度 |
| `SEC-VUL-001/002` · `SEC-LEAK-001` · `secret-detected` | error/warning | 动态代码执行、命令注入、敏感数据入日志、硬编码凭据 | 覆盖 OWASP 静态子集（详见 §4） |
| `DEP-LAZ-001` | warning | 函数内临时导入且无审计声明 | 已具备"依赖引入需声明"的雏形 |

---

## 2. 八维能力矩阵

评级口径：**A** 系统覆盖（多规则 + 可量化）· **B** 主要面覆盖 · **C** 仅经典子集 · **D** 结构性空白

| 维度 | 评级 | 支撑规则 | 缺口性质 |
| :--- | :---: | :--- | :--- |
| 架构与边界 | **A** | ARCH 23 · DEP 9 · CPX-RED-001 | 完备；`ARCH-DIR-003` 已能识别"形式分层假象" |
| 可维护性 | **A** | NAM 9 · CMT 10 · HYG 9 · SIM 4 · CMP 4 · CPX 9 | 完备；缺 API 兼容演进口径（§3.3-P1） |
| 性能与资源 | **A−** | PRF 10 · CPX-SPACE/TIME/MEM · DAT-NPL-001 | 缺并发/超时语义（§3.3-P1） |
| 数据架构 | **B** | DAT 5 | 缺事务边界与幂等（§3.3-P1） |
| 测试工程 | **B+** | TST 5 · GOV-GAM-001 | 强于"反作弊"，弱于"测试有效性度量" |
| 安全 | **C** | SEC 7 · secrets 2 | **经典注入类覆盖，供应链/指令面/运行期授权全空**（§3.2-P0） |
| 可靠性 | **D** | GOV-EXC-001/002/003 · CPX-REC-001 · PRF-LEAK-001 · ERR-PRP-001 | **异常面覆盖，非确定性/并发/超时/幂等零覆盖** |
| 协作与流程 | **D** | GOV-AGN-001 · GOV-FIL-001/002 · GOV-SAN-001 | **仅"代码内静态契约"，无变更/提交/溯源/残留物口径** |

---

## 3. 缺口清单

严重度定义：**P0** = Agent 自主行为可造成不可逆损害或安全失效；**P1** = 高频失效模式且现有规则无可替代；**P2** = 流程与度量完备性。

### 3.1 P0（6 项缺口 → 7 条提案）——Agent 自主行为的高危面

| # | 缺口 | 探针证据 | 为何在 Agent 场景致命 | 现有近似规则为何不够 |
| :--: | :--- | :--- | :--- | :--- |
| 1 | **供应链完整性**：lockfile 完整性/漂移、生命周期脚本（`postinstall`/`preinstall`）、registry 源白名单、依赖来源（`git+http`/`tarball`/`file:`）、新增依赖爆炸 | `postinstall\|preinstall` → **ABSENT**；`typosquat\|dependency confusion` → **ABSENT**；`git+http\|tarball\|file:\.\.` → **ABSENT** | Agent 可自主执行 `npm i <pkg>`。恶意或幻觉依赖的 `postinstall` 即任意代码执行，且**不在源码审查视野内** | `disallowed-import` 只管"已解析到的导入是否越界"；`DEP-LAZ-001` 只管函数内临时导入。二者均在依赖**已安装之后** |
| 2 | **Agent 指令面注入**：注释/README/测试夹具/规范文档中针对 Agent 的指令（`ignore previous`、`do not report`、外传指令）、隐藏于 **零宽/双向控制字符**（U+200B/200E/202E/2066）的不可见指令 | `ignore previous\|prompt injection\|instruction override` → **ABSENT**；`u200b\|u202e\|bidi` 仅命中 `src/utils/linestats.ts`（**行宽测量归一化**，非安全规则） | Agent 的"输入"就是代码库文本。被污染的文件会**反向劫持后续 Agent**，形成持久化注入链 | `CMT-MOJI-001` 只覆盖编码损坏（U+FFFD、`Ã` 乱码）；不可见字符当前被 `linestats` 主动**归一化丢弃**，等于把证据抹掉 |
| 3 | **危险操作原语与运行期授权** | `chmod 777\|sudo\|rm -rf\|--unsafe-perm\|--break-system-packages` → 仅命中 `scripts/bench-baselines.js`（无关）；`push --force\|--no-verify\|reset --hard` → **ABSENT**；`curl … \| sh` → **ABSENT** | Agent 会在"修复问题"动机下执行破坏性命令（绕过 hooks、强推、无条件删目录）。本项目自身就存在 `git commit` 需 `--no-gpg-sign` 的历史摩擦，说明该类操作真实发生 | `SEC-VUL-002` 覆盖的是"拼接外部输入 → shell"的**注入**语义；不覆盖"**缺少人工授权**的既定破坏性操作" |
| 4 | **幻觉 API / 引用真实性** | `hallucinat\|nonexistent import\|unresolved import\|phantom` → 仅 2 处无关命中 | LLM 生成代码的最高频失效是**引用不存在的包/导出/方法**。静态分析器天然可校验（lockfile + 类型定义 + 符号表） | `unused-export` 查"导出无人用"（反方向）；`import-cycle`/`disallowed-import` 只在模块**可解析**时生效，无法解析的导入当前被静默忽略 |
| 5 | **Agent 变更爆炸半径** | 无任何"单次变更文件数/行数/目录跨度"阈值实现 | 本次审计即以实证呈现：上一批在途提交 6 个 commit 触及约 60 文件、跨 `src/analyzers` `src/core/*` `scripts/` `docs/` `baselines/`。大爆炸变更使**评审有效性归零**，且大幅提高掩盖回归概率 | `GOV-AGN-001` 检的是"并发修改造成的架构破坏"（结果态）；不检"变更规模本身"（过程态） |
| 6 | **工作区残留物入库** | 无"未跟踪 `scratch/`/`tmp*`/agent 中间产物"审查实现 | 实证：`auto-refactor/scratch/audit-deep-dive.js` 当前**未跟踪且未被 .gitignore 覆盖**，`git add -A` 即入库；工程根另有 `tmp-test1.log` 等残留 | `HYG-STB-001/002` 检的是源码内的桩函数与黑话**标记**，不检文件系统层面的 Agent 副产物 |

### 3.2 P1（8 项）——高频且无替代

| # | 缺口 | 探针证据 | 关键说明 |
| :--: | :--- | :--- | :--- |
| 7 | **非确定性来源** | 无规则实现（`Date.now`/`Math.random` 命中的是引擎自身代码，非规则） | Agent 生成代码普遍依赖时间/随机/哈希序，导致**测试 flaky 与结果不可复现**，而可复现性正是本项目"字节等价"承诺的前提 |
| 8 | **异步正确性** | 无"未 await / floating promise / `async` 内 fire-and-forget"规则 | `CMT-CON-001` 仅要求**注释声明**并发假设，属文档级；`PYM-ASYNC-001` 只覆盖 Python 阻塞调用 |
| 9 | **超时 / 重试 / 退避** | `timeout\|retry\|backoff` 命中 24 处，均为**引擎自身实现**，无规则 | 无超时的网络/子进程调用 + 无退避的重试 = Agent 长跑任务的典型挂死原因 |
| 10 | **幂等与事务边界** | 命中均为文档/注释，无规则 | Agent 重试一次写操作即可能产生重复副作用（重复提交、重复扣款、重复追加日志） |
| 11 | **出网目标与数据外传** | `fetch\|axios\|urllib\|requests\.` → THIN（仅 `python-modern` 的阻塞 IO 语境） | 缺"出网目标白名单"与"编码后外传"（base64/hex 拼接域名、DNS 渗出）。Agent 被注入后的首选渗出通道 |
| 12 | **不安全配置默认值** | `rejectUnauthorized\|NODE_TLS_REJECT\|verify=False\|CORS\|DEBUG=True` → **ABSENT** | `ARCH-CFG-*` 管的是配置**治理**（死配置/重复/散落），完全不含"**危险默认值**"语义 |
| 13 | **API 破坏性变更与弃用窗口** | 无通用实现（`GOV-SLC-001` 限定 AST 切片口径） | Agent 改公共签名的概率远高于人类；缺"导出签名变更 + 消费方影响 + 弃用期"的判定链 |
| 14 | **凭据与加密扩展** | `.env`/`BEGIN PRIVATE KEY` 命中 21 处**均为代码文本**，无规则 | 缺：私钥/`.env` 入库、证书校验关闭、硬编码 IV/salt、ECB 模式、Python `random` 用于安全值；`SEC-VUL-005` 仅覆盖 md5/sha1 |

### 3.3 P2（8 项）——流程与度量

| # | 缺口 | 说明 |
| :--: | :--- | :--- |
| 15 | 许可合规 | 依赖许可（copyleft/UNKNOWN）与生成代码的许可污染；无任何实现 |
| 16 | 变更/提交卫生 | Conventional Commits、需求 ID 引用、changelog 同步——`AGENTS.md` 已有约定，但**无机器守卫**（引擎无任何 VCS 维度规则） |
| 17 | 文档指针与实现一致性 | 实证：`AGENTS.md` 称"62 套并行流水线"，实际 62 并行 + 5 串行 = **67**；`docs/PRAXIS_HANDOFF_REPORT.md` 另称 55。规则集无此口径（`CMT-HDR-003` 只管文件头路径） |
| 18 | 跨语言同构漂移 | `CPX-RED-001` 做单语言/跨文件相似度；缺"TS 与 Python 双实现语义漂移"判定（本项目 PYM/TSM 双语言包并存，风险真实） |
| 19 | 重构等价性断言 | 引擎对外承诺"字节等价"，但**规则集内无"重构前后行为等价"的审查规则**——承诺由外部验证脚本承担，未内化为规则 |
| 20 | Agent 运行预算与收敛判据 | 缺"最大迭代/最大改动/最大成本"预算与"循环未收敛"判据（`GOV-TRJ-001` 是**事后轨迹**震荡，非**运行期**收敛） |
| 21 | 关键路径可观测性 | 缺"核心链路缺日志/缺指标/日志级别误用" |
| 22 | 注释与实现一致性（语义级） | `CMT-DOC-002` 只能识别"注释机械重复符号名"；无法识别"注释声称的行为与实现不符"（Agent 改实现不改注释的高频漂移） |

---

## 4. 已确认无需补（避免清单注水）

| 表面疑似缺口 | 实际已覆盖 |
| :--- | :--- |
| 空 catch / 吞异常 | `GOV-EXC-001`（含理由标记豁免）+ `GOV-EXC-003`（伪处理 dummy 语句） |
| 静默忽略错误返回值 | `GOV-EXC-001/003` + `ERR-PRP-001` |
| 复杂度投机拆分 | `CPX-HOP-001` + `CPX-BUD-001` |
| 恒真/无效测试 | `TST-TAU-001` + `TST-ILS-001` + `GOV-GAM-001` |
| 长期跳过测试 | `TST-SKP-001` |
| 多 Agent 并发架构破坏 | `GOV-AGN-001` |
| 轨迹震荡/反模式复活 | `GOV-TRJ-001` |
| 分布式冗余实现 | `CPX-RED-001` |
| 资源池化健康度 | `PRF-POL-001/002/003` |
| 临时桩与批次黑话 | `HYG-STB-001/002` + `GOV-SAN-001` + `NAM-FIL-001` + `NAM-DIR-001` |
| 死代码/未使用导出 | `unused-export` + `unused-module` + `HYG-DED-001` |
| 分层倒置/形式分层 | `ARCH-DIR-001/003` + `ARCH-LEAK-002` + `DEP-INV-001` + `clean-layer-violation` |
| 配置死项/重复/散落 | `ARCH-CFG-001~007` |
| 阻塞 IO / 事件循环卡死 | `GOV-PRF-004` + `PRF-IO-001` |
| 内存增长 / 瞬态分配 | `PRF-LEAK-001` + `PRF-MEM-001` + `CPX-SPACE-001` + `loop-transient-allocation` |

---

## 5. Agent 编程四象限映射

| 象限 | 现有支撑 | 主要缺口（P0/P1） |
| :--- | :--- | :--- |
| **安全性** | `SEC-VUL-001~006` · `SEC-LEAK-001` · `secret-detected` · `high-entropy-token` · `disallowed-import` | P0-1 供应链 · P0-2 指令面注入 · P0-3 危险操作授权 · P1-11 出网外传 · P1-12 不安全默认值 · P1-14 凭据/加密 |
| **可靠性** | `GOV-EXC-001~003` · `CPX-REC-001` · `PRF-LEAK-001` · `ERR-PRP-001` | P1-7 非确定性 · P1-8 异步正确性 · P1-9 超时退避 · P1-10 幂等事务 · P0-4 幻觉 API |
| **可维护性** | `NAM` · `CMT` · `HYG` · `SIM` · `CMP` · `CPX` · `ARCH`（合计 60+ 条，覆盖最厚） | P1-13 API 破坏性变更 · P2-18 跨语言漂移 · P2-19 等价性断言 · P2-22 注释-实现一致性 |
| **协作规范** | `GOV-AGN-001` · `GOV-SLC-001` · `GOV-TRJ-001` · `GOV-GAM-001` · `GOV-FIL-001/002` | P0-5 变更爆炸半径 · P0-6 工作区残留 · P2-15 许可 · P2-16 提交卫生 · P2-17 文档指针 · P2-20 运行预算 · P2-21 可观测性 |

---

## 6. 补强提案（27 条）

命名约定：沿用现有家族；仅新增 **1 个家族 `AGT-*`**（Agent 运行期与产物治理），理由是该域关注对象是 **Agent 自身行为与产物**（预算、授权、溯源、残留物），既不属于代码静态质量（ARCH/NAM/CMT），也不属于 governance 的"架构契约"语义，独立家族可避免 `GOV-*` 语义稀释。

### 6.1 P0 提案（7 条）

| 提案 ID | 家族 | 级别 | 判定信号（可观测） | 误报控制 |
| :--- | :--- | :--- | :--- | :--- |
| `SEC-SUP-001` | SEC | **error** | 依赖清单与 lockfile 不一致 / lockfile 缺失 / 版本范围被放宽（`^`→`*`） | 仅比对已提交文件对，不做网络请求 |
| `SEC-SUP-002` | SEC | **error** | `package.json` 等清单出现 `preinstall`/`postinstall`/`prepare` 且非项目白名单 | 白名单按仓库注册，默认空集（fail-closed） |
| `SEC-SUP-003` | SEC | **error** | 依赖来源为非白名单 registry、`git+http(s)`、`tarball`、`file:`/`link:` 本地路径 | 白名单可配置；`file:` 仅限 monorepo 内部声明的 workspace |
| `SEC-INS-001` | SEC | **error** | 任意被扫描文本中出现零宽/双向控制字符（U+200B/200C/200D/200E/200F/202A-202E/2066-2069） | 需与 `linestats` 的宽度归一化**解耦**，避免继续被静默丢弃 |
| `SEC-INS-002` | SEC | warning | 注释/Markdown/夹具中出现指令覆盖语（"ignore previous"/"do not report"/"system prompt"/外传范式） | 采语料 + 正则双轨；仅命中"祈使 + 动作"共现以压噪 |
| `AGT-ART-001` | AGT | warning | 工作区内存在未被 ignore 的一次性产物（`scratch/`、`tmp*`、agent 中间输出、`.log` 入库） | 复用 `respectGitignore`；仅报"未被 ignore"者 |
| `SEC-OPR-001` | SEC | **error** | 危险操作原语：`sudo` / `chmod 777` / `rm -rf` / `--unsafe-perm` / `--break-system-packages` / `curl … \| sh` / `git push --force` / `--no-verify` / `reset --hard` | 引入"授权声明"豁免（与 `GOV-EXC-001` 的理由标记同构），避免阻断合法的发布脚本 |

### 6.2 P1 提案（12 条）

| 提案 ID | 家族 | 级别 | 判定信号 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| `CPX-DET-001` | CPX | warning | 业务路径使用 `Date.now`/`new Date`/`Math.random`/`randomUUID`/无序集合迭代作为**决策输入** | 需区分"日志时间戳"（免报）与"决策输入" |
| `GOV-ASY-001` | GOV | **error** | 未 `await` 的 Promise（floating）、`async` 内 fire-and-forget、`forEach` 内 `async` | 与 `PYM-ASYNC-001` 对齐为跨语言统一语义 |
| `GOV-RAC-001` | GOV | warning | `await` 边界前后共享可变状态被读写（TOCTOU）、无保护的重入 | 语义级，需数据流（`src/core/intelligence/dataFlow.ts` 已具备基础设施） |
| `GOV-RES-001` | GOV | warning | 网络/子进程/DB 调用缺少超时参数 | 复用 `blockingIoAllowPatterns` 的豁免机制 |
| `GOV-RTY-001` | GOV | warning | 重试循环无退避/无上限/无抖动 | — |
| `DAT-IDM-001` | DAT | warning | 写操作（POST/PUT/文件追加/DB 写）无幂等键或去重保护 | — |
| `DAT-TXN-001` | DAT | warning | 多步写入缺少事务边界或补偿逻辑 | — |
| `SEC-EGR-001` | SEC | warning | 出网调用目标域名不在白名单（含动态拼接域名） | 与 `DEP-RES-001`（硬编码 URL）互补：后者查"硬编码未纳管"，前者查"目标是否被授权" |
| `SEC-CFG-001` | SEC | **error** | `rejectUnauthorized:false` / `NODE_TLS_REJECT_UNAUTHORIZED=0` / `verify=False` / `CORS:*` / `DEBUG=True` 等危险默认值 | 只查"显式危险值"，不做安全推断 |
| `SEC-CRY-001` | SEC | warning | 硬编码 IV/salt、ECB 模式、证书校验关闭、非 CSPRNG 用于安全值 | — |
| `MNT-API-001` | MNT/ARCH | **error** | 公共导出签名/配置 schema 字段的破坏性变更，且消费方未同步 | 与 `GOV-SLC-001` 合并口径可增强其后者的通用性 |
| `DEP-SUP-004`（依赖真实性） | DEP | **error** | 导入的包/导出/方法在当前 lockfile 与类型定义中**不存在** | 即"幻觉 API"审查，直接可由现有符号表与 lockfile 支撑 |

### 6.3 P2 提案（8 条）

| 提案 ID | 家族 | 级别 | 判定信号 |
| :--- | :--- | :--- | :--- |
| `DOC-DRV-001` | DOC | warning | 文档中的量化声明（套件数/规则数/阈值）与运行时真源不一致 |
| `AGT-PRV-001` | AGT | info | Agent 生成/修改的变更缺少溯源登记（模型、提示版本、任务 ID、Co-authored-by） |
| `AGT-SCP-001` | AGT | warning | 单次变更越出声明范围（文件数/目录跨度/行数超阈值） |
| `AGT-BDG-001` | AGT | warning | Agent 任务缺少迭代/成本/改动上限，或已触发上限仍未收敛 |
| `AGT-CMT-001` | AGT | warning | 提交信息不符 Conventional Commits 或缺需求 ID 引用 |
| `GOV-XLG-001` | GOV | info | 跨语言同构逻辑（TS/Python 等）出现语义漂移 |
| `HYG-EQV-001` | HYG | warning | 重构变更缺少等价性断言/基线比对证据 |
| `GOV-OBS-001` | GOV | info | 核心链路缺少可观测性 |

---

## 7. 两点结构性原则（比新增规则更重要）

### 7.1 安全规则必须默认开启（fail-closed）

**实证问题**：`security` 分析器由 `securityLevel` 级联开启（`src/core/config/config-cascades.ts:41-49`），而本仓库 `auto-refactor.config.json` **未声明 `securityLevel`** → `SEC-VUL-001~006`（含 `eval` 任意代码执行、命令注入）在自审中**全部不生效**；`securityLevel: off` 更会显式关闭 security + secrets 两者。

**建议**：安全家族改为**默认开启**，关闭必须显式声明并提供理由；`gate:self` 增加一条断言——**安全类规则生效数为零时门禁直接失败**。对 Agent 场景尤甚：自主 Agent 是可被注入的攻击面，安全审查"默认静默"等同于不存在。

### 7.2 规则"生效面"须纳入门禁

174 条规则中本仓库仅生效 97 条（56%）。建议新增一条元守卫（可复用 `validate-rules-registry.js`）：

> 注册表规则 ∖ 生效规则 必须落在**已登记清单**内（注明"本仓库不适用"的理由），否则门禁失败。

这与项目既有的"单一真源 + 零孤儿规则"哲学同构，可防止"规则写了但没有消费方"的静默腐化。

---

## 8. 落地路线图

| 批次 | 内容 | 建议门禁/验收 |
| :--- | :--- | :--- |
| **第 1 批（P0 安全）** | `SEC-SUP-001/002/003` · `SEC-INS-001/002` · `SEC-OPR-001` | 每条规则须有**正向 + 负向**用例（对齐 AGENTS.md 红线）；先以 `info` 影子运行 1 周统计误报率，再升至 `error` |
| **第 2 批（P0 协作 + 可靠性基础设施）** | `AGT-ART-001` · `GOV-ASY-001` · `CPX-DET-001` | 与 `GOV-AGN-001`/`GOV-SLC-001` 共用轨迹与切片基础设施 |
| **第 3 批（P1 余下 10 条）** | `SEC-EGR-001` · `SEC-CFG-001` · `SEC-CRY-001` · `DEP-SUP-004` · `GOV-RAC-001` · `GOV-RES-001` · `GOV-RTY-001` · `DAT-IDM-001` · `DAT-TXN-001` · `MNT-API-001` | 每批附 `bench-baselines` 前后对照（性能门禁要求） |
| **第 4 批（P2 8 条 + 元守卫）** | `DOC-DRV-001` · `AGT-PRV-001` · `AGT-SCP-001` · `AGT-BDG-001` · `AGT-CMT-001` · `GOV-XLG-001` · `HYG-EQV-001` · `GOV-OBS-001` + §7.2 生效面守卫 | 生效面守卫须与 `validate-rules-registry.js` 同批交付 |

**通用约束（沿用既有红线）**：新增/修改规则必须同时交付 ① 注册表条目 ② 规则文档 ③ 字面量常量 ④ 正反向测试用例；基线只降不升，升级须走 `gate:self:update` 并在提交信息给出理由。

---

## 附录 A：探针证据（零命中项）

以下探针在 `src/**/*.ts` + `scripts/*.js` + `auto-refactor.config.json`（371 文件）中**零命中**，构成 §3 缺口的直接证据：

```
ABSENT  供应链: 生命周期脚本      (postinstall|preinstall|prepare script|lifecycle script)
ABSENT  供应链: 依赖混淆/仿冒      (typosquat|dependency confusion|confusable|homoglyph)
ABSENT  依赖来源审查             (git+http|tarball|file:..|link:)
ABSENT  危险操作: git 强推/绕钩子  (push --force|--no-verify|reset --hard|filter-branch)
ABSENT  危险操作: curl|sh 管道     (curl … | sh)
ABSENT  不安全配置默认值          (rejectUnauthorized|NODE_TLS_REJECT|verify=False|CORS|DEBUG=True)
ABSENT  代码注释与实现一致性       (doc-code|comment drift|implementation mismatch|stale comment)
```

**反例（避免误判为缺口）**：`不可见字符/双向控制` 探针**有命中**，但经人工核验全部位于 `src/utils/linestats.ts` 的**行宽归一化**逻辑（`CHAR_ZERO_WIDTH_NO_BREAK_SPACE` 等），属"为测量而丢弃"，**不是**安全审查实现——故仍判定为缺口（`SEC-INS-001`）。

---

## 附录 B：评估可复现性

| 步骤 | 命令 / 方式 |
| :--- | :--- |
| 规则清单与分布 | `node -e "…require('./dist/core/rules/registry')…"`（见 §1.1 数据） |
| 生效面计算 | 同上，按 `analyzers` 键集过滤 `r.analyzer` → 97/174 |
| 缺口探针 | 对 371 文件（src + scripts + config）执行 28 组正则探针，按命中数分档 ABSENT/THIN/PRESENT 并人工复核 THIN/PRESENT 项 |
