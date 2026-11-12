# 📂 scripts — 仓库级脚本库

> 仓库级共享脚本的统一归属地。按**语言域**分目录组织（`sh/` / `ps1/` / `py/`），
> 各脚本在文件头注明**职能域**（gate / release / package / validate / ci）与用途。
> 项目内私有脚本（如 `auto-refactor/scripts/*.js` 的 validate/bench 系列）不在此库，
> 保留在各项目内部，由各自 `package.json` 引用。
>
> 本库当前收录 <!-- METRICS:BEGIN script-inventory -->**107 份**<!-- METRICS:END script-inventory -->受控脚本，逐项列于下表。

---

## 一、目录分类矩阵（语言域 × 职能域）

| 目录 | 语言 | 脚本 | 职能域 | 调用方 |
|------|------|------|--------|--------|
| `sh/` | Bash | `audit-all.sh` | audit / review（全工作区跨项目统一审查中枢） | 本地 CLI、CI |
| `ps1/` | PowerShell | `audit-all.ps1` | audit / review（audit-all.sh 同构双实现） | 本地 CLI（Windows） |
| `common/` | Node.js | `validate-physical-hygiene.js` | audit / hygiene（全工作区物理卫生八维刚性公理守卫） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-gate-feedback.js` | gate / feedback（面向操作者的反馈词表：语义步骤标识与 PASS/BLOCK/SKIP/WARN 四态闭包；入口脚本额外禁用 `[FAIL]`/`[N/A]` 等判定同义词） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-gate-ordering.js` | gate / ordering（门禁入口脚本的助手定义顺序与判定词表守卫；Bash 与 PowerShell 均在执行期解析命令，定义前调用会以解析错误中止整条门禁） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-gate-verdicts.js` | gate / verdicts（步骤判定覆盖守卫：登记表中每个步骤都必须在两个平台可达且能呈现终态判定，同一步骤不得出现两条横幅） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-hardcoded-counts.js` | gate / counts（面向操作者的输出语句不得写死规模计数，须由实测数据插值渲染；内置反向探针自检，探针失效即自身阻断） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-block-chains.js` | gate / chains（PowerShell 块链分支合法性：`else`/`elseif`/`catch`/`finally` 必须挂在可接受它的块之后；重复的 `else` 解析器零报错，只在运行时于该行失败） | `pre-push-gate`、CI |
| `common/` | Node.js | `test-gate-guards.js` | validate / guards（负向自证：逐项证明顺序、词表、同构守卫确实能检出各自缺陷类别） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-script-isomorphism.js` | audit / isomorphism（<!-- METRICS:BEGIN iso-pairs -->**29 对跨平台同构脚本**<!-- METRICS:END iso-pairs -->结构对应性、逐行换行一致性、`set -e`/pipefail 与 PowerShell 原生命令开关守卫；WebGames 按已文档化策略豁免 errexit） | `audit-all`、CI |
| `common/` | Node.js | `validate-shell-parity.js` | audit / parity（Linux 命令面守卫：断言 AGENTS.md 承诺的每个命令都真实可绑定、兼容层同时具备 GNU 与 PowerShell 降级两条路径，并回报当前宿主解析出的模式 `gnu` / `native`） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-skills.js` | audit / skills（全工作区研发技能规范、死链与镜像等价性守卫） | `pre-commit-gate`、`audit-all` |
| `common/` | Node.js | `sync-skills.js` | tooling / skills（根目录技能集与 workspace-governance 插件双向同步工具） | 本地 CLI |
| `common/` | Node.js | `sync-agents-mirror.js` | tooling / agents（SubAgent 定义模板与 AGENTS.md 单向镜像到插件包，并核验字节等价与计数滞后） | `sync-skills`、`pre-push-gate` |
| `common/` | Node.js | `sync-agent-verification.js` | tooling / agents（把原型 `localVerification` 渲染进专员模板的验证章节，消除两侧各自维护命令清单） | `sync-agents-mirror` |
| `common/` | Node.js | `sync-agent-model-line.js` | tooling / agents（把专员模板的模型行收敛为不含具体代号的继承声明，避免换模型后模板成为假前提） | `sync-agents-mirror` |
| `common/` | Node.js | `gate-fast-staged.js` | gate / fast-staged（暂存区文件单遍内存流式前置 6 大门禁判定；内存判定约 1 ms，端到端约 160 ms 含 Node 启动） | `pre-commit-gate` |
| `common/` | Node.js | `validate-staged-slice.js` | gate / complexity（平台级增量 AST 切片圈复杂度/嵌套/噪声比审查器） | `pre-commit-gate`、CI |
| `common/` | Node.js | `validate-code-density.js` | gate / density（多维代码密度、接线率 POR<=60% 与列密度审查器） | `pre-commit-gate`、`pre-push-gate`、CI |
| `common/` | Node.js | `validate-gitignore-governance.js` | audit / hygiene（全仓 .gitignore 换行、安全底线守卫与防误伤断言门禁） | `pre-push-gate`、`audit-all` |
| `common/` | Node.js | `evaluate-eloc-budget.js` | audit / complexity（双轨体积 ELOC<=900/LOC<=1400 与 1:3 动态包络；`--all` 全仓扫描 + `eloc-budget-baseline.json` grow-only 棘轮；未识别参数直接 exit 2） | `pre-commit-gate`、`pre-push-gate`、CI |
| `common/` | Node.js | `gate-differential-bounds.js` | gate / diff（暂存区五维有效代码 5D ELOC 差分双向钳制与准入更替量评估器，联动 Taxis 原生与纯 JS 差分双轨） | `pre-commit-gate` STAGED-DIFF-14、CI |
| `common/` | Node.js | `generate-rule-catalog.js` | audit / ssot（全工作区规则单源目录聚合与零漂移核验器；默认只读，`--write` 显式重生成） | 本地 CLI、`pre-push` 门禁、CI |
| `common/` | Node.js | `generate-rule-catalog-types.js` | tooling / ssot（从 rule-catalog.json SSOT 自动生成 auto-refactor 强类型常量库与领域子模块） | 本地 CLI、CI |
| `common/` | Node.js | `validate-rule-id-closure.js` | audit / ssot（门禁引用规则 ID 与目录登记的双向闭包守卫） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-scoring-rule-closure.js` | audit / scoring（全仓 SSOT 规则 100% 映射至十维质量空间双向闭包守卫） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-docs-consistency.js` | audit / docs（动态对照 `rule-catalog.json` 真实计数拦截规则总数漂移；含治理文档脚本死链守卫） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-impact-slices.js` | audit / test（影响面切片自校验器：按改动路径推导的预测试目标只可收窄、不可越界放宽，未识别路径必须回落到全量目标） | `pre-push-gate` 物理卫生、`audit-all`、CI |
| `common/` | Node.js | `validate-commit-rule-coverage.js` | audit / ssot（提交层规则覆盖守卫：提交信息门禁的规则 ID 与 SSOT 目录逐项对齐，零孤儿与零虚构） | `pre-push-gate`、CI |
| `common/` | Node.js | `sync-doc-metrics.js` | audit / metrics（文档规模数字的单源渲染与零漂移守卫：`METRICS:BEGIN/END` 区域由真源求值渲染，`--write` 就地校正，内置反向探针自证检出能力） | `pre-push-gate`、CI、本地 CLI |
| `common/` | Node.js | `validate-rule-reachability.js` | audit / ssot（error 级规则执行入口可达性守卫） | `pre-push-gate`、CI |
| `common/` | Node.js | `validate-rule-source-consistency.js` | audit / ssot（规则源跨目录严重级一致性：同一规则 ID 被多个 `rule-sources/*.json` 声明时 severity 必须相同，内置反向探针自证检出能力） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-destructive-ops.js` | audit / safety（破坏性删除溯源守卫：递归删除的操作数不得是文件系统根、工作目录祖先或家目录/用户配置目录，也不得经赋值链与循环别名间接派生；同时拦截只读自动变量遮蔽。检出为污点分析而非字面量规则，内置反向探针与事故链自证） | `pre-push-gate` DESTRUCTIVE-OPS-38、`audit-all`、CI |
| `common/` | Node.js | `validate-doc-anchors.js` | audit / docs（跨文档引用按名解析：禁止 `§N`/`公理 N`/`SOP 第 N 步` 等随行号漂移的位置引用） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-doc-reachability.js` | audit / docs（规范文档入链可达性：每份规范文档必须被其他文档按文件名、路径或 slug 命名） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-family-contract.js` | audit / ssot（规则族三源一致：`family` 必须是分类法中的主题、`layer` 必须落在六层域内，目录与映射表族集合双向相等） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `validate-metric-coverage.js` | audit / docs（`doc-metrics.json` 声明集与文档实际渲染集相等；声明未渲染与标记未声明双向阻断） | `pre-push-gate`、`audit-all`、CI |
| `common/` | Node.js | `evaluate-change-entropy.js` | audit / entropy（Hassan 变更香农熵与 Kamei 跨域扩散 NF/ND/NS 评估，超阈阻断） | `pre-push-gate` CHANGE-ENTROPY-22、本地 CLI |
| `common/` | Node.js | `bootstrap-gates.js` | tooling / bootstrap（钩子激活、依赖安装与构建一键引导） | 本地 CLI |
| `common/` | Node.js | `install-hooks.js` | gate / hooks（仓库本地钩子载体自愈：`core.hooksPath` 指向 `.githooks`、六类载体索引可执行位回读断言；`--check` 只读核验，`--quiet` 抑制逐钩子成功行） | 根 `prepare`、`gate:install:portable`、CI |
| `common/` | Node.js | `test-gate-parity.js` | validate / parity（双实现提交门禁行为差分） | CI、本地 CLI |
| `common/` | Node.js | `test-gate-selftest.js` | validate / selftest（门禁 PASS/违规/缺依赖三态矩阵） | CI、本地 CLI |
| `common/` | Node.js | `gate-receipts.js` | gate / receipt（本地门禁收据引擎：pre-commit/commit-msg 阶段标记、post-commit/post-merge 落盘、pre-push 逐提交审计与 ref 安全性判定；`--no-verify` 提交只能显式 bypass 并留痕） | `.githooks/*`、`pre-push-gate`、`install-hooks` |
| `common/` | Node.js | `validate-commit-msg.js` | gate / commit（生产级结构化提交信息格式、区块与有效字数综合调度器） | `commit-msg-gate` |
| `common/` | Node.js | `commit-structure-contract.js` | gate / structure（七项结构契约的单一实现：标题形态与长度、空行分割、正文密度、必需区块、项目归属、批次代号；`commit-msg-gate` 双实现均委托此处） | `validate-commit-msg`、`commit-msg-gate` |
| `common/` | Node.js | `validate-commit-msg-style.js` | gate / style（提交信息文本风格与四维禁词核验器） | `commit-msg-gate`、`pre-push-gate`、CI |
| `common/` | Node.js | `validate-commit-history-baseline.js` | gate / commit-history（待推送提交按冻结清单逐条核验：清单记录的规则对命中提交只报告不阻断，未记录的规则照常生效） | `pre-push-gate` COMMIT-HISTORY-BASELINE-36、CI |
| `common/` | Node.js | `validate-push-range-messages.js` | gate / commit（推送区间逐提交复核提交信息契约，补偿被绕过或缺失的本地 `commit-msg` 钩子；冻结清单内的既有规则只报告不阻断） | CI、本地 CLI |
| `common/` | JSON | `commit-history-baseline.json` | data / ssot（冻结提交基线与逐提交依据规则清单，`ratifiedAt` 为时间边界） | `validate-commit-history-baseline` |
| `common/` | Node.js | `commit-tokenizer.js` | gate / style-lexical（零依赖提交信息分词器：零宽字符剥离、NFKC 归一、前缀 Trie 与结构解析） | `validate-commit-msg-style`、`validate-commit-guardrail` |
| `common/` | Node.js | `commit-style-arbiter.js` | gate / style-lexical（祈使语态、客观叙述与学术白名单仲裁器） | `validate-commit-msg-style` |
| `common/` | Node.js | `tech-debt-corridor.js` | gate / debt（弹性高危技术债容差走廊与清偿棘轮状态机） | `validate-commit-msg`、`validate-commit-msg-style` |
| `common/` | Node.js | `commit-guardrail-logger.js` | telemetry / commit（提交护栏快照原子落盘与历史账本 FIFO 轮转） | `validate-commit-msg`、`validate-commit-msg-style` |
| `common/` | Node.js | `validate-commit-guardrail.js` | validate / commit-lexical（分词器、风格仲裁与债务走廊 12 组契约自测；基础件回归即阻断） | `pre-push-gate` |
| `common/` | Node.js | `git-env.js` | tooling / git（Git 运行环境隔离、暂存与提交范围文件检索 SSOT 工具） | 门禁与体积审查脚本集 |
| `common/` | Node.js | `record-workspace-trajectory.js` | telemetry / ledger（全工作区审查轨迹账本记录与版本增量追加工具） | `audit-all` |
| `common/` | Node.js | `validate-trajectory-ledger.js` | audit / ledger（全工作区演化轨迹账本哈希单调性与完整性校验器） | 本地 CLI、CI |
| `common/` | Node.js | `record-workspace-audit.js` | telemetry / audit（统一审查结论汇总落盘与跨项目得分聚合） | `audit-all` |
| `common/` | Node.js | `render-audit-all-summary.js` | audit / summary（Linux Bash 统一审查 6 大支柱真实遥测聚合、零假保底裁决与十维质量看板渲染） | `audit-all.sh` |
| `common/` | Node.js | `evaluate-polyglot-balance.js` | audit / balance（异构多语言均衡指数与离散度惩罚度量） | `audit-all` |
| `common/` | Node.js | `evaluate-workspace-quant.js` | telemetry / quant（资本负债与量化风险模型：利息覆盖率、夏普比率、索提诺比率、基尼系数与自愈半衰期评估） | `audit-all`、本地 CLI |
| `common/` | Node.js | `analyze-commit-terminology.js` | audit / terminology（历史提交术语频次与新兴黑话风险诊断，落盘 `.audit-logs/`） | 本地 CLI（诊断报告，不参与门禁裁决） |
| `common/` | Node.js | `log-rotator.js` | tooling / hygiene（门禁失败快照保留、尾部截断 <=100KB 与 FIFO <=2MB 轮转清理管理器） | `pre-commit-gate`、`commit-msg-gate`、`pre-push-gate`、`audit-all` |
| `common/` | Node.js | `gate-failure-contract.js` | gate / failure（门禁失败命名拓扑学与格式物理卫生契约：规范四段式命名、8 项 Header 注入、ANSI 脱水与 GateFailureEnvelope 模式校验） | `audit-all`、`log-rotator`、CI |
| `common/` | Node.js | `gate-telemetry-logger.js` | telemetry / gate（门禁运行遥测与单例快照记录器：原子持久化 `<gate>-latest.json`、FIFO 历史账本 `<gate>-history.jsonl`、ANSI 脱水诊断日志 `last-<gate>.log` 与失败信封） | `pre-commit-gate`、`pre-push-gate`、本地 CLI |
| `common/` | Node.js | `test-gate-telemetry.js` | validate / telemetry（门禁遥测记录器与诊断日志套件自测：验证快照落盘、ANSI 脱水、路径脱敏、FIFO 轮转与软失败语义） | CI、本地自测 |
| `common/` | Node.js | `workspace-walker.js` | tooling / traversal（全工作区目录迭代遍历、物理黑名单过滤与文件收集 SSOT 工具） | 门禁与体积审查脚本集 |
| `common/` | JSON | `commit-msg-forbidden-terms.json` | data / ssot（提交信息四维禁词与白名单单源字典） | `validate-commit-msg-style` |
| `common/` | JSON | `doc-metrics.json` | data / ssot（治理文档规模指标的真源映射、渲染模板与脚本库语义登记表） | `sync-doc-metrics` |
| `common/` | JSON | `eloc-budget-baseline.json` | data / complexity（双轨体积棘轮基线快照：每份受控源码的 ELOC/LOC 历史最低值，grow-only） | `evaluate-eloc-budget` |
| `common/` | Node.js | `gate-step-registry.js` | gate / registry（步骤登记表的加载、结构校验与 TSV 投影；Bash 门禁无 JSON 解析器时经此读取步骤身份） | `pre-push-gate`、`audit-all`、`validate-gate-verdicts` |
| `common/` | JSON | `gate-step-registry.json` | data / ssot（门禁入口、步骤身份、显示顺序与规则归属的单源登记表） | 门禁双实现、`validate-gate-verdicts`、`validate-gate-ordering` |
| `common/` | JSON | `rule-reachability-exceptions.json` | data / ssot（error 级规则执行入口可达性的显式豁免清单，逐条写明豁免理由） | `validate-rule-reachability` |
| `common/` | JSON | `rule-catalog.json` | data / ssot（全工作区规则事实真源聚合目录） | 静态审查与门禁工具链 |
| `common/` | JSON | `impact-slice-map.js` | data / slices（改动路径到预测试目标的影响面映射单源：包、测试与切片身份集中登记，供预测试机与本地切片共用） | `remote-sandbox-gate`、`validate-impact-slices` |
| `common/` | JSON | `commit-rule-coverage.json` | data / ssot（提交信息门禁规则覆盖矩阵的数据面，登记每条提交层规则被哪些用例覆盖） | `validate-commit-rule-coverage` |
| `common/` | JSON | `diff-bounds-contract.json` | data / ssot（5D ELOC、TSPR、删除换手率、重构放宽与 Jeffreys 经验准入的跨语言参数契约） | `gate-differential-bounds`、auto-refactor、taxis |
| `common/` | JSON | `diff-exemptions.json` | data / ledger（差分豁免授予账本：`schemaVersion` 加 `grants` 映射，逐条记录被豁免标识的测量值、floor 与 target，随提交走以便审计复算） | `diff-exemption-ledger`、`gate-differential-bounds` |
| `common/` | JSON | `rule-lexicon.json` | data / ssot（跨引擎与门禁脚本共享的规则标识符与语义步骤词汇形状单源字典） | 静态审查与提交门禁工具链 |
| `sh/` | Bash | `pre-commit-gate.sh` | gate（本地提交物理卫生与多项前置检查，含 AST 切片） | `.githooks/pre-commit`、本地 CLI |
| `ps1/` | PowerShell | `pre-commit-gate.ps1` | gate（pre-commit-gate.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `commit-msg-gate.sh` | gate（生产工程级结构化提交信息格式、区块、字数、反虚构与风格求实 8 项门禁） | `.githooks/commit-msg`、本地 CLI |
| `ps1/` | PowerShell | `commit-msg-gate.ps1` | gate（commit-msg-gate.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `pre-push-gate.sh` | gate（本地推送前置全量多项前置检查、提交历史风格扫描与基线核验） | `.githooks/pre-push`、本地 CLI |
| `ps1/` | PowerShell | `pre-push-gate.ps1` | gate（pre-push-gate.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `install-hooks.sh` | gate（一键激活仓库级 Git Hooks） | 本地 CLI |
| `ps1/` | PowerShell | `install-hooks.ps1` | gate（install-hooks.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `check-display-assets.sh` | ci（打包资产校验） | `.github/workflows/ci.yml`、`package.sh` |
| `ps1/` | PowerShell | `check-display-assets.ps1` | ci（check-display-assets.sh 同构双实现） | `package.ps1`、本地 CLI（Windows） |
| `sh/` | Bash | `package.sh` | package（扩展打包，联动展示资产校验） | 本地 CLI（README） |
| `ps1/` | PowerShell | `package.ps1` | package（package.sh 同构双实现，联动资产校验与热同步） | 本地 CLI（Windows） |
| `sh/` | Bash | `release-tag.sh` | release（Git 语义化标签创建与自动化推送发布） | 本地 CLI |
| `ps1/` | PowerShell | `release-tag.ps1` | release（release-tag.sh 同构双实现） | 本地 CLI（Windows） |
| `sh/` | Bash | `version-bump.sh` | release（全工作区版本号一致性递增工具） | 本地 CLI |
| `ps1/` | PowerShell | `version-bump.ps1` | release（version-bump.sh 同构双实现） | 本地 CLI（Windows） |
| `common/` | Node.js | `project-registry-resolver.js` | tooling / registry（全工作区受控项目单源动态发现与路径解析器） | 本地 CLI、CI |
| `common/` | Node.js | `remote-sandbox-gate.js` | tooling / gate（云端 Linux 预测试机切片调度中枢，把改动集路由到 hygiene、rust、timing、auto-refactor、webgames、impact 与 all 预演切片，支持 --sync 源码增量同步） | `remote-sandbox-test.ps1`、`remote-sandbox-test.sh`、CI |
| `common/` | Node.js | `render-skill-catalog.js` | tooling / skills（将技能注册表渲染为面向人类的技能调用全景清单） | 本地 CLI |
| `common/` | Node.js | `skill-registry-resolver.js` | tooling / skills（技能注册表单源读取与路径解析引擎） | `render-skill-catalog`、CI |
| `common/` | JSON | `skill-registry.json` | data / ssot（全工作区技能单一真源元数据与触发词拓扑注册表） | `skill-registry-resolver` |
| `common/` | Node.js | `staggered-push-daemon.js` | tooling / git（常驻调度器，在目标时间窗内触发一次错峰推送批次） | `run-daily-staggered-push` |
| `common/` | Node.js | `staggered-push-orchestrator.js` | tooling / git（错峰分批安全限速推送核心调度编排器） | `run-daily-staggered-push` |
| `common/` | Node.js | `sync-skill-metadata.js` | tooling / skills（根据注册表向技能文件单源回填激活指令与关联链接） | 本地 CLI |
| `ps1/` | PowerShell | `remote-sandbox-test.ps1` | tooling / gate（云端预测试机切片预演的 PowerShell 薄入口） | 本地 CLI、CI |
| `ps1/` | PowerShell | `run-daily-staggered-push.ps1` | tooling / git（每日错峰分批 Git 提交安全推送脚本，Windows PowerShell 实现） | 本地 CLI、计划任务 |
| `sh/` | Bash | `remote-sandbox-test.sh` | tooling / gate（云端预测试机切片预演的 POSIX Bash 薄入口） | 本地 CLI、CI |
| `sh/` | Bash | `run-daily-staggered-push.sh` | tooling / git（每日错峰分批 Git 提交安全推送脚本，POSIX Bash 实现） | 本地 CLI、计划任务 |
| `py/` | Python | （预留，暂无脚本） | — | 规范见 [`py/README.md`](py/README.md) |

> 职能域语义：`gate`=协作门禁（CNB 流水线触发）、`release`=发布流程、
> `package`=本地打包、`ci`=CI 辅助校验、`validate`=脚本自测/回归用例。

### 文档规模数字的渲染约定

上表中被引用的规模数字（同构脚本对数、门禁步骤数等）与各治理文档中的规则总数、技能数、分析器数，一律不在散文里手写。真源声明收口于 [`common/doc-metrics.json`](common/doc-metrics.json)，由 [`common/sync-doc-metrics.js`](common/sync-doc-metrics.js) 渲染：

```markdown
<!-- METRICS:BEGIN rule-total -->
<由脚本渲染的单行内容>
<!-- METRICS:END rule-total -->
```

- `node scripts/common/sync-doc-metrics.js` 只读比对，任一块与真源不一致即阻断；
- `node scripts/common/sync-doc-metrics.js --write` 就地重写块体，块外文本永不被改动；
- 代码围栏与行内代码中的同名标记是语法示例，不参与渲染；
- 记录某一提交时点结论的历史段落须加 `<!-- METRICS:IGNORE-HISTORICAL commit=<hash> -->` 才豁免；
- 记录**目标规格**（尚未落地的计划数字）的段落须加 `<!-- METRICS:IGNORE-PLAN reason=<理由> -->`，与历史豁免并列但语义不同——前者是「还没到」，后者是「已经过去」；
- 新增指标必须同时在 `doc-metrics.json` 声明与 `sync-doc-metrics.js` 的 `buildResolvers()` 注册求值器，缺一侧即 `UNRESOLVED_METRIC` 阻断，杜绝文档声明了没人计算的数字。

---

## 二、语言域选择约定

| 场景 | 推荐语言 | 说明 |
|------|---------|------|
| 流水线触发 / CI / 跨平台 | Bash（`sh/`） | Git Bash / Linux runner 直接可跑 |
| Windows 本地交互（参数提示、错误高亮） | PowerShell（`ps1/`） | `package.ps1` 为 `package.sh` 的同构双实现 |
| 复杂文本/数据/多步骤分析 | Python（`py/`） | 预留域；需要 stdlib 或轻量依赖时启用 |

**双实现约定**：同一职能若同时提供 sh 与 ps1 双实现（如 `package.sh` / `package.ps1`），
两份文件放各自语言域目录，文件名保持一致（仅扩展名不同），且文件头互相注明「同构双实现」。

---

## 三、命名规范

- **小写 kebab-case**，动词开头：`auto-label.sh`、`check-display-assets.sh`、`package.ps1`
- 职能前缀建议：`auto-*`（自动判定）、`check-*`（校验）、`pr-*` / `merge-*`（门禁）、`release-*` / `test-release-*`（发布与自测）
- 语言以目录归属表达（不再用 `*.sh` / `*.ps1` 后缀重复标注目录层级）

---

## 四、脚本头注释模板（新脚本必须遵守）

```bash
#!/usr/bin/env bash
# =============================================================================
# <脚本名> — <一句话职责>
# -----------------------------------------------------------------------------
# 职能域：<gate|release|package|ci|validate>
# 触发方：<流水线事件 / 本地 CLI / CI workflow>
# 用法：
#   bash scripts/sh/<script>.sh <args...>
# 依赖：<环境变量 / 外部命令 / 前置脚本>
# 退出码：0=成功；非 0=<失败语义>
# =============================================================================
set -euo pipefail
```

PowerShell 版使用 `# <# ... #>` 注释块（SYNOPSIS/DESCRIPTION/EXAMPLE），同结构字段。
Python 版使用 docstring + `if __name__ == "__main__":` 守卫。

---

## 五、错误处理与健壮性规范

| 规则 | 要求 |
|------|------|
| 严格模式 | Bash：必须声明 `set -euo pipefail`，预期允许失败的指令必须通过 `STATUS=0; cmd || STATUS=$?` 平铺捕获或 `if cmd; then` 守卫分支 |
| 参数校验 | 必需参数用 `${1:?用法提示}` 或显式判断并 `exit 2` |
| 退出码语义 | `0`=成功；`1`=业务失败；`2`=用法错误；门禁类脚本按职能定义 `0`=放行 / 非 `0`=阻断 |
| 幂等 | 可重复执行不产生副作用（打标签/发布/合并前先查重） |
| 破坏性操作 | 禁止 `git reset --hard` / 静默清空；回退用 `git merge --abort` 并 `|| true` 兜底 |
| 临时目录 | 用完即清；流水线内产物不入库（统一 `dist/`、`*.vsix`、`*.tgz` 已 ignore） |
| 日志 | 结论类输出打 `echo "【xxx】"` 标记，便于流水线/巡检检索 |

---

## 六、新增脚本 Checklist

0. 首次使用先执行 `npm run gate:bootstrap`（激活钩子、安装依赖并构建 auto-refactor 产物）
1. 确定职能域与语言域，放入对应目录（`sh/` `ps1/` `py/`）
2. 按第四节模板补全头注释
3. 遵循第五节错误处理规范
4. 更新本文件「目录分类矩阵」表
5. 若被流水线/CI 调用，同步更新 `.github/workflows/*.yml` 中的路径

---

## 七、历史归属说明

- `scripts/sh/` 下的 gate/release 系列脚本 2026-08-28 按「仓库级脚本库按语言分域」归入本库，
  可作为独立工具手动执行或接入 CI（`.github/workflows/*.yml`）。
- 2026-09-09 补齐发布工具链：`version-bump.sh`（语义递增 + CHANGELOG 迁移，干净树/版本单调/扩展身份三门禁）
  与 `release-tag.sh`（本地发布闭环，与 `release.yml` 同规），修复 `package.sh`/`package.ps1`
  在语言分域重构后的根路径失效与 `check-display-assets.sh` 的 icon 校验静默禁用，
  并在 `.github/workflows/ci.yml` 增补 hygiene 作业永久看守三类回归。
- 各脚本详细设计文档见 [`scripts/sh/README.md`](./sh/README.md)。

---

## 八、面向自主 Agent 的门禁协议规范 (Agent-Native Gate Protocol v1.0.0)

工作区门禁系统（`pre-commit-gate`、`commit-msg-gate`、`pre-push-gate`、`gate-fast-staged`、`validate-staged-slice`、`validate-commit-msg`）原生支持**双轨运行界面**：
1. **人类交互模式 (默认)**：保留高对比度彩色终端、清晰横幅进度与步骤摘要；
2. **Agent 原生消费模式 (`-Agent` / `--agent` / `--json`)**：剥离控制台彩色散文与非必要输出，在标准输出 (stdout) 仅发射单份确定性、机器可读的结构化 JSON 协议包。

### 1. 协议包 Schema 契约 (`AgentFailureEnvelope`)

```json
{
  "protocolVersion": "1.0.0",
  "status": "PASS | BLOCK",
  "gate": "pre-commit | commit-msg | pre-push",
  "step": "失败步骤名称",
  "failedCommand": "触发失败的精确命令",
  "exitCode": 1,
  "summary": "纯客观技术事实摘要",
  "logFile": ".audit-logs/last-failure.log",
  "violations": [
    {
      "ruleId": "SSOT登记规则ID (如 HYG-EOL-001, CMG-PRJ-001, CPX-BUD-001)",
      "severity": "BLOCK | WARN",
      "file": "违规目标相对路径",
      "line": 42,
      "column": 5,
      "actual": "当前实际值 (如 CC=22, CRLF, 未声明项目归属)",
      "expected": "预期合规值 (如 CC<=15, LF, [Project: governance])",
      "message": "精确违规描述",
      "actionableFix": "明确且唯一的自愈建议",
      "verificationCommand": "针对本违规项的快速单点验证命令"
    }
  ],
  "agentDirectives": {
    "targetFiles": ["待修复的绝对或相对文件路径列表"],
    "remediationPriority": ["优先修复的规则ID列表"],
    "verificationCommand": "单点验证命令",
    "fastRecheckCommand": "极速重测命令 (如 pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent)"
  }
}
```

### 2. 核心调度与快照自愈指令

| 门禁与工具 | 人类模式命令 | Agent 原生模式命令 | 诊断快照查看 |
|:---|:---|:---|:---|
| **提交前置门禁** | `pwsh scripts/ps1/pre-commit-gate.ps1` | `pwsh scripts/ps1/pre-commit-gate.ps1 -Agent` | `pwsh scripts/ps1/pre-commit-gate.ps1 -ViewLog` |
| **提交信息门禁** | `pwsh scripts/ps1/commit-msg-gate.ps1 <msg>` | `pwsh scripts/ps1/commit-msg-gate.ps1 <msg> -Agent` | `pwsh scripts/ps1/commit-msg-gate.ps1 -ViewLog` |
| **推送前置门禁** | `pwsh scripts/ps1/pre-push-gate.ps1` | `pwsh scripts/ps1/pre-push-gate.ps1 -Agent` | `pwsh scripts/ps1/pre-push-gate.ps1 -ViewLog` |
| **失败快照轮转器** | `node scripts/common/log-rotator.js --view` | `node scripts/common/log-rotator.js --agent` | 自动保留最近一次失败至 `.audit-logs/last-failure.json` |

> 各入口的语义步骤数均由 `scripts/common/gate-step-registry.json` 单源登记：提交前置 <!-- METRICS:BEGIN step-pre-commit -->**15 个语义步骤**<!-- METRICS:END step-pre-commit -->、提交信息 <!-- METRICS:BEGIN step-commit-msg -->**10 个语义步骤**<!-- METRICS:END step-commit-msg -->、推送前置 <!-- METRICS:BEGIN step-pre-push -->**41 个语义步骤**<!-- METRICS:END step-pre-push -->、全工作区审查 <!-- METRICS:BEGIN step-audit-all -->**6 个语义步骤**<!-- METRICS:END step-audit-all -->、fractal-git 审查 <!-- METRICS:BEGIN step-audit-taxis -->**5 个语义步骤**<!-- METRICS:END step-audit-taxis -->，合计 <!-- METRICS:BEGIN step-total -->**77 个语义步骤**<!-- METRICS:END step-total -->。
>
> 推送门禁的输出形如
> `✔  <步骤标识>  <详情>`（通过态只留勾号，异常态才写出 `✖ BLOCK` / `↷ SKIP` / `▲ WARN` 大写词），
> 协议层状态词闭包恒为 PASS / BLOCK / SKIP / WARN，呈现层投影不改变该闭包：
> 全工作区审查的子系统汇总表「判定结果」列取值为 `🟢 达标` / `🔴 阻断`，
> 与协议层 `PASS` / `BLOCK` 一一对应，不引入第三种状态，也不以 `PASS` 字样直接面向阅读者。
>
> | 步骤标识 | 职责 |
> | :--- | :--- |
> | `WORKSPACE-PHYSICAL-01` ~ `WORKSPACE-DENSITY-03` | 物理卫生八维、.gitignore 治理、五维代码密度 |
> | `RULE-CATALOG-04` ~ `RULE-REACHABILITY-07` | 单源目录同步、标识闭包、文档一致性、规则可达性 |
> | `ENGINE-RUST-08` ~ `ENGINE-BASELINE-13` | auto-refactor 编译、构建、门面承载、自审、回归、质量基线 |
> | `EXTENSION-TESTS-14` ~ `EXTENSION-REVIEW-15` | workspace-timing 单元测试与六层审查 |
> | `LEDGER-CONSTRAINT-16` | 长期轨迹账本物理约束 |
> | `DOMAIN-AUDIT-17` ~ `DOMAIN-MERMAID-18` | WebGames 全域质量与文档 Mermaid 真解析 |
> | `RUST-TAXIS-19` | fractal-git 内核子系统回归套件 |
> | `COMMIT-CONTRACT-20` ~ `COMMIT-HISTORY-21` | 提交信息词法契约自测与待推送历史审查 |
> | `CHANGE-ENTROPY-22` | 推送集变更熵与跨域扩散 |
> | `FEEDBACK-VOCABULARY-23` | 反馈词表语义化与四态状态词闭包 |
> | `GATE-ORDERING-24` ~ `GATE-PROOF-25` | 门禁助手定义顺序与守卫检出能力自证 |
> | `GATE-COVERAGE-26` ~ `GATE-COUNT-27` | 步骤判定覆盖与面向操作者的规模计数真实性 |
> | `GATE-CHAIN-28` | PowerShell 块链分支合法性 |
> | `DOC-METRICS-29` | 治理文档规模数字由真源渲染 |
> | `SHELL-PARITY-30` | Linux 命令面与 AGENTS.md 承诺一致性 |
> | `SUBAGENT-CATALOG-31` | SubAgent 预置与单源专员模板一一对应 |
> | `DOC-ANCHORS-32` | 跨文档引用按名解析，不按行序编号 |
> | `METRIC-COVERAGE-33` | 文档指标声明集与渲染集相等 |
> | `FAMILY-CONTRACT-34` | 规则族三源一致且层值在六层内 |
> | `DOC-REACH-35` | 规范文档至少被另一份文档指名 |
> | `COMMIT-HISTORY-BASELINE-36` | 提交历史冻结清单只能覆盖早于其生效时刻的提交 |
> | `RULE-SOURCE-37` | 规则源文件内容与目录一致性 |
> | `DESTRUCTIVE-OPS-38` | 破坏性文件操作静态守卫与溯源 |

---

## 九、钩子载体与推送区间补偿命令

- `node scripts/common/install-hooks.js`：把本仓库的 `core.hooksPath` 指回 `.githooks` 并回读索引中的可执行位，可重复执行。`--check` 只读核验，CI 用它在全新检出上证明自愈真实发生；`--quiet` 抑制逐钩子成功行。不在 Git 工作树内时告警并以 0 退出，保证打包与源码快照不被阻断。
- `node scripts/common/validate-push-range-messages.js`：按 `--range <base>..<head>`（缺省 `origin/main..HEAD`，也可用环境变量 `GATE_PUSH_RANGE`）逐条复核推送区间的提交信息契约；`--limit <n>` 便于本地单点自测。命中冻结清单的既有提交只报告不阻断，其余违规打印 `BLOCK` 并以 1 退出，用法错误以 2 退出。
- 根 `prepare` 生命周期与 CI hygiene 作业都会调用上述两个脚本：前者让每次依赖安装自动修复钩子载体，后者先在全新检出上解除 `core.hooksPath` 再安装核验，最后按推送区间复核提交信息。
