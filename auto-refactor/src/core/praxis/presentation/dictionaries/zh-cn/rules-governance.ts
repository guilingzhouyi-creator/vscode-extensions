/**
 * Module: Core Engine - Praxis Presentation Chinese Governance Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-governance.ts
 * Architecture Role: Chinese localization table for Governance rules.
 * Dependencies & Triggers: Consumed by zh-cn/index.ts and i18nProvider.
 * Responsibilities: Export localized rule descriptors in Chinese.
 * Exit Semantics & Design Rationale: Pure constants, zero dependencies.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 治理规范领域规则中文本地化呈现字典。
 */
export const ZH_CN_GOVERNANCE_RULES: Record<string, PraxisRuleI18nEntry> = {
    'CMT-BAN-001': {
        name: 'CMT-BAN-001',
        summary: '不足 150 行的小文件使用 `═` 文件级横幅。',
        remediation: '`standard` 及以上',
    },
    'CMT-CON-001': {
        name: 'CMT-CON-001',
        summary: '异步导出方法未注明并发调度假设、可重入性或幂等语义。',
        remediation: '`strict`',
    },
    'CMT-DOC-001': {
        name: 'CMT-DOC-001',
        summary: '核心公开导出符号缺少功能描述、参数或返回值 Docstring/JSDoc 说明。',
        remediation: '`standard` 及以上',
    },
    'CMT-DOC-002': {
        name: 'CMT-DOC-002',
        summary: '机械无意义冗余注释 (注释文本仅重复函数名或符号名)。',
        remediation: '`standard` 及以上',
    },
    'CMT-HDR-001': {
        name: 'CMT-HDR-001',
        summary: '源码文件顶部缺少文件层级职责与设计意图注释。',
        remediation: '`basic` 及以上',
    },
    'CMT-HDR-002': {
        name: 'CMT-HDR-002',
        summary:
            '工业级严格题头契约缺失六字段之一 (模块归属、文件路径、架构定位、依赖与触发、职责说明、退出语义与设计依据)。',
        remediation: '`strict`',
    },
    'CMT-HDR-003': {
        name: 'CMT-HDR-003',
        summary: '题头声明路径与物理文件路径失真不一致。',
        remediation: '`strict`',
    },
    'CMT-INT-001': {
        name: 'CMT-INT-001',
        summary:
            '注释声称的职责特征（如纯函数、无副作用、并发安全）与 AST 实际数据流/副作用特征矛盾。',
        remediation: '修正注释使其真实反映实现行为，或重构代码消除未声明的副作用与竞态条件。',
    },
    'CMT-LNG-001': {
        name: 'CMT-LNG-001',
        summary: '注释书写语言显著偏离项目或代码域的主导规范（例如英文主导库中突兀插入中文注释）。',
        remediation: '将注释语言对齐项目推荐规范，保持代码域内部风格一致性。',
    },
    'CMT-LNG-002': {
        name: 'CMT-LNG-002',
        summary: '单个文件内部中英文注释无序交错混杂（中文与英文占比均较高且缺乏分层规律）。',
        remediation: '统一单文件内的注释语言规范，避免局部多语言风格碎片化。',
    },
    'CMT-MOJI-001': {
        name: 'CMT-MOJI-001',
        summary:
            '编码损坏（U+FFFD 替换符、UTF-8 被按 Latin-1 解码的 `Ã`+高位字节、Windows-1252 智能引号乱码）。跨语言通用。',
        remediation: '`basic` 及以上',
    },
    'CMT-SEP-001': {
        name: 'CMT-SEP-001',
        summary: '同一文件混用短标题分隔（`── 标题 ──`）与长串分隔（`──── 标题`）；纯分隔线豁免。',
        remediation: '`standard` 及以上',
    },
    'CMT-VMD-001': {
        name: 'CMT-VMD-001',
        summary: '有效注释密度过低或存在逐行直译代码名的注水现象（未解释设计原因与边界不变量）。',
        remediation: '减少重复代码名的冗余直译，重点补充“为什么这样设计”与“哪些边界不能破坏”。',
    },
    'CMT-WID-001': {
        name: 'CMT-WID-001',
        summary:
            '注释/docstring 物理行宽超过 100 列；工具指令行（`noqa`/`type: ignore`/`eslint-disable`/`@ts-expect-error` 等）以及 `comments.options.directiveTokens` 声明的项目自有指令豁免。',
        remediation: '`standard` 及以上',
    },
    'CONST-CLU-001': {
        name: 'CONST-CLU-001',
        summary:
            '同调用域内存在未抽取的同源硬编码字面量（状态码/协议值/路径/事件名），应一揽子打包抽取。',
        remediation:
            '结合临近代码域聚类建议，将同一语义族的同源字面量一并抽离为常量，避免遗留散乱硬编码。',
    },
    'CONST-DRF-001': {
        name: 'CONST-DRF-001',
        summary: '跨文件同源语义常量存在命名分裂或数值微小漂移，必须建立单一真源（SSOT）。',
        remediation:
            '将多文件维护的同源常量统一定义在领域或协议共享常量库中，并消除数值或命名漂移。',
    },
    'CONST-LAY-001': {
        name: 'CONST-LAY-001',
        summary:
            '模块级稳定常量在依赖区后必须进入首个正式代码声明域，严禁散落在函数内部、文件中段或业务逻辑之间。',
        remediation:
            '将模块级常量统一定义在文件导入声明（import/require）之后、任何函数/类声明之前的常量区。',
    },
    'CONST-LIB-001': {
        name: '集中式大规模常量库构建拓扑建议',
        summary: '检测到项目中大量常量散落于业务代码文件中，缺乏集中分层的常量库目录结构。',
        remediation:
            '根据 Agent 建议的目录拓扑与分片模块（如 ast-tokens、rule-codes 等），在 constants/ 目录下集中归档并提供统一 index.ts 导出。',
        rationale:
            '散落常量容易造成符号重复定义、命名漂移与跨文件循环依赖，建立集中式常量库是架构工程化的必要底座。',
    },
    'CONST-OWN-001': {
        name: 'CONST-OWN-001',
        summary: '共享常量所有权分层错误，严禁塞入全局大杂烩 constants 文件或藏匿在底层私有模块。',
        remediation:
            '按照所有权四层模型，分流至 Module-Private、Domain-Shared、Protocol-Shared 或 System-Config。',
    },
    'CONST-SCP-001': {
        name: 'CONST-SCP-001',
        summary: '单函数局部不变量、延迟初始化值或受限生命周期资源禁止滥用扩大作用域提升至顶层。',
        remediation: '保持局部不变量在单函数或局部代码块内部的作用域范围，避免盲目提升至文件全局。',
    },
    'CONST-SCP-002': {
        name: 'CONST-SCP-002',
        summary: '单函数体内散落的多处同类局部硬编码应在函数头部统一定义为局部常量。',
        remediation: '在当前函数头部集中声明局部 const 常量并替换函数内部各处的散落字面量。',
    },
    'DOC-DUP-001': {
        name: 'DOC-DUP-001',
        summary: '同一文档内正文行重复（≥24 字符）。',
        remediation: '收敛为单一章节 + 指针，避免副本漂移。',
    },
    'DOC-FEN-001': {
        name: 'DOC-FEN-001',
        summary: 'Markdown 代码围栏未闭合。',
        remediation: '补上闭合围栏，避免后续章节被吞进代码块。',
    },
    'DOC-LNK-001': {
        name: 'DOC-LNK-001',
        summary: '反引号路径或相对链接指向不存在的文件。',
        remediation: '更新为现路径，或在行内标注已废止/示例。',
    },
    'GOV-AGN-001': {
        name: 'GOV-AGN-001',
        summary:
            'Concurrent modifications by multiple agents produce architectural boundary breaches, cross-module dependency cycles, or contract incompatibilities.',
        remediation:
            '协调并行 Agent 的架构边界与修改职责，消解跨模块并发循环依赖并维护单向分层契约。',
    },
    'GOV-ARC-001': {
        name: 'GOV-ARC-001',
        summary:
            'Historical dossier nomenclature leaks into production sources, tests, or commit headers outside the archived directory white-list.',
        remediation:
            '历史施工批次代号仅在归档白名单目录中受物理豁免，面向用户的文档、代码与提交信息统一使用纯粹产品特性与功能价值表述。',
    },
    'GOV-BLS-001': {
        name: 'GOV-BLS-001',
        summary:
            'Cross-tier monolithic change blast radius breaches atomic staging boundaries across docs, contracts, config, domains, and tooling.',
        remediation:
            '按架构依赖拓扑（文档 -> 核心抽象 -> 基础设施 -> 配置表 -> 业务实现 -> 质量重构）拆分为多批次原子提交。',
    },
    'GOV-DAT-001': {
        name: 'GOV-DAT-001',
        summary:
            'Functions declaring excessive discrete scalar parameters (>= 5) exhibit Data Clumps smell; parameters should be aggregated into a named Context or Options interface.',
        remediation:
            '将离散参数群聚合为强类型的结构化上下文模型（如 Context 或 Options 接口对象），提高契约内聚性。',
    },
    'GOV-DBG-001': {
        name: 'GOV-DBG-001',
        summary:
            'Debug and console print statements clutter standard outputs, leak diagnostics, and can degrade I/O throughput.',
        remediation: '删除调试输出，或改用结构化日志并按级别输出。',
    },
    'GOV-EXC-001': {
        name: 'GOV-EXC-001',
        summary:
            'Empty catch blocks silently swallow exceptions, causing silent data corruption or masking critical failures. A catch whose body carries an explicit rationale marker (best-effort / ignore / intentional / expected) is treated as a documented decision instead of a silent swallow.',
        remediation: '处理/记录/显式重抛；确属 best-effort 时在 catch 内写明理由标记。',
    },
    'GOV-EXC-002': {
        name: 'GOV-EXC-002',
        summary:
            'Naked `.unwrap()` causes unrecoverable process panics in production upon Err or None.',
        remediation: '避免裸 unwrap/expect，改为显式错误分支或 Result/Option 传播。',
    },
    'GOV-EXC-003': {
        name: 'GOV-EXC-003',
        summary:
            'Pseudo-catch blocks containing only dummy non-handling statements (void 0, dead assignment) silently swallow exceptions without logging or documented rationale.',
        remediation:
            '在 catch/except 块中补充结构化日志、错误重抛或在注释中显式标注 rationale 标记（如 best-effort, expected）。',
    },
    'GOV-FIL-001': {
        name: 'GOV-FIL-001',
        summary:
            'Inconsistent file naming causes cross-platform casing issues and impairs modular discovery.',
        remediation: '按语言命名契约重命名文件（kebab-case 或 snake_case）。',
    },
    'GOV-FIL-002': {
        name: 'GOV-FIL-002',
        summary:
            'Substantial production modules must declare their architectural role and responsibility boundary.',
        remediation: '修正文件头声明路径，或补齐缺失的头部字段。',
    },
    'GOV-GAM-001': {
        name: 'GOV-GAM-001',
        summary:
            'Anti-gaming violation: artificial function splitting, tautological test padding, or empty boilerplate gaming quality metrics.',
        remediation: '保持业务内聚并编写有实质断言的真实测试用例，杜绝空样板与假测试。',
    },
    'GOV-LOG-001': {
        name: 'GOV-LOG-001',
        summary:
            'Deeply nested control flows (> 5 levels) create high cognitive load and increase defect risk.',
        remediation: '降低嵌套：卫语句早返回、抽取子步骤或扁平化分支。',
    },
    'GOV-LOG-002': {
        name: 'GOV-LOG-002',
        summary:
            'Vacuous wrapper methods that purely forward calls without validation or translation add unnecessary indirection.',
        remediation: '去掉直通式包装，让调用方直达目标或合并职责。',
    },
    'GOV-MNT-001': {
        name: 'GOV-MNT-001',
        summary:
            'Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred.',
        remediation: '收敛继承层级：组合优先，或抽公共能力为独立模块。',
    },
    'GOV-MNT-002': {
        name: 'GOV-MNT-002',
        summary:
            'Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling.',
        remediation: '反转依赖：内层定义端口/接口，由外层实现。',
    },
    'GOV-MSG-001': {
        name: 'GOV-MSG-001',
        summary:
            '底层诊断消息与修复建议必须统一采用标准英文并由常量字典集中管控，严禁在分析器发射点硬编码内联或非 ASCII 文本。',
        remediation:
            '将内联错误提示提取至 `src/core/messages/` 集中常量池，并确保文案符合英语工业技术标准。',
    },
    'GOV-PRF-001': {
        name: 'GOV-PRF-001',
        summary:
            'Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties.',
        remediation: '循环不变量外提，把不变计算移出循环体。',
    },
    'GOV-PRF-002': {
        name: 'GOV-PRF-002',
        summary:
            'Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N).',
        remediation: '用 Set/Map 承载查找，消除循环内线性扫描。',
    },
    'GOV-PRF-003': {
        name: 'GOV-PRF-003',
        summary:
            'Numeric timer delays bypass centralized clamping; a literal of <=0 triggers a ~1ms busy loop (CPU/IO hotspot).',
        remediation: '定时器延时常量具名或走集中配置，避免绕过统一钳制。',
    },
    'GOV-PRF-004': {
        name: 'GOV-PRF-004',
        summary:
            'Sync fs calls block the host event loop (UI jank in IDE extensions, request stalls on servers).',
        remediation: '改用异步 IO；进程式 CLI 路径可用 blockingIoAllowPatterns 声明豁免。',
    },
    'GOV-PRF-005': {
        name: 'GOV-PRF-005',
        summary:
            'Calling array linear lookups (.includes / .indexOf) inside loops creates quadratic O(N*M) overhead; pre-indexing into a Set hoisted outside the loop optimizes membership tests to O(1).',
        remediation:
            '在循环前将只读数组提升为 Set 预建索引（const set = new Set(arr)），循环内改用 set.has() 进行 O(1) 检索。',
    },
    'GOV-RTC-002': {
        name: 'GOV-RTC-002',
        summary:
            'Baseline debt entries must track physical file rename operations without artificial inflation or false positive churn. Monotonic downward ratchets must remap prior baselines to new paths upon refactoring.',
        remediation:
            '在基线更新与门禁收敛中应用重命名路径规范化映射 (pathRemap)，确保文件重构后既有基线连续继承，严禁因重命名引发基线虚增或债务逃逸。',
    },
    'GOV-RUL-001': {
        name: 'GOV-RUL-001',
        summary:
            'Static review rule identifier drift or hallucination: mentioned rule ID is not registered in the single-source rule catalog.',
        remediation:
            '核对单源规则注册表，使用已登记的规范化规则 ID，禁止臆造虚构不存在的规则代号。',
    },
    'GOV-SAN-001': {
        name: 'GOV-SAN-001',
        summary:
            'Transient task tags and batch jargon (pXX/phaseXX/stXX/wip) compromise architectural longevity and create documentation drift.',
        remediation: '移除临时工单/批次黑话，改用长效领域术语。',
    },
    'GOV-SLC-001': {
        name: 'GOV-SLC-001',
        summary:
            'AST slice mutation introduces breaking signature drift or uncontained side-effects propagating across external call chains.',
        remediation: '确保切片改动向后兼容，或同步重构受影响调用链上的全部外部调用者。',
    },
    'GOV-STD-001': {
        name: 'GOV-STD-001',
        summary:
            'Redundant if-then-else returning boolean literals increases cyclomatic complexity and mental overhead.',
        remediation: '直接 return 布尔表达式，去掉 if/else 包装。',
    },
    'GOV-STD-002': {
        name: 'GOV-STD-002',
        summary:
            'Legacy constructs (e.g. `var` in modern TS/JS, dead `pass` in GDScript) violate language idiomatic standards.',
        remediation: '替换废弃构造（var、legacy 键名等）为现代等价写法。',
    },
    'GOV-TRJ-001': {
        name: 'GOV-TRJ-001',
        summary:
            'Historical trajectory exhibits cyclic regressions, flip-flop oscillations, or re-introduces previously eliminated architectural anti-patterns.',
        remediation:
            '确保演化轨迹保持单调质量提升，避免在后续修订中死灰复燃已被重构配方消除的架构反模式。',
    },
    'GOV-TYP-001': {
        name: 'GOV-TYP-001',
        summary:
            'Implicit loose typing hides type errors at runtime and weakens static safety guarantees.',
        remediation: '为变量/参数补齐类型注解。',
    },
    'GOV-TYP-002': {
        name: 'GOV-TYP-002',
        summary:
            'Unannotated function signatures compromise API boundaries and allow unintended type drift.',
        remediation: '为函数补齐返回类型注解。',
    },
    'GOV-TYP-003': {
        name: 'GOV-TYP-003',
        summary: 'Naked `any` bypasses the entire compiler type checker, leaking type instability.',
        remediation: '裸 any 换成 unknown 或具体联合；动态边界用受控断言并注释理由。',
    },
    'GOV-TYP-004': {
        name: 'GOV-TYP-004',
        summary:
            'Passing or assigning `undefined as any` or `null as any` indicates an Interface Segregation Principle (ISP) violation.',
        remediation: '将目标参数声明为可选联合类型或拆分专有接口，消除强制类型断言。',
    },
    'GOV-TYP-005': {
        name: 'GOV-TYP-005',
        summary:
            'Accessing properties via `(expr as any).prop` bypasses compiler type safety and indicates missing type narrowing guards.',
        remediation: '使用标准类型收窄谓词（如 ts.canHaveModifiers 或 isXxx）保护属性访问。',
    },
    'GOV-TYP-006': {
        name: 'GOV-TYP-006',
        summary:
            'Exported functions, classes, and public methods must specify explicit return types to protect public API contracts.',
        remediation:
            '为导出的公共函数、类方法补充显式返回类型注解，避免依赖隐式类型推断引起 API 破坏。',
    },
    'HYG-BLT-001': {
        name: 'HYG-BLT-001',
        summary: '局部变量/参数遮蔽 Python 内建名（docstring 示例与类体协议字段豁免）。',
        remediation: '重命名绑定（加领域限定词），避免掩盖内建语义。',
    },
    'HYG-CLN-001': {
        name: 'HYG-CLN-001',
        summary: '抽象提炼共享通用函数或工具类。',
        remediation: '基于 32-bit 滚动多项式哈希检测到连续多行代码完全重复 (Copy-Paste)。',
    },
    'HYG-DED-001': {
        name: 'HYG-DED-001',
        summary: '清理冗余死代码，重构控制流分支。',
        remediation: '终结控制流 (`return/throw/break/raise/exit`) 之后存在不可达死代码。',
    },
    'HYG-EMP-001': {
        name: 'HYG-EMP-001',
        summary:
            '源码、脚本或配置目录中存在物理 0 字节、仅含空白注释或缺乏有效 AST 语义载荷的虚空占位文件。',
        remediation: '完善该文件的实际业务实现与导出定义，或直接从仓库中物理删除无效的占位文件。',
    },
    'HYG-EXC-001': {
        name: 'HYG-EXC-001',
        summary: 'except 变量命名不是 exc。',
        remediation: '统一命名为 exc，让错误处理读起来一致。',
    },
    'HYG-NAM-001': {
        name: 'HYG-NAM-001',
        summary: '对齐各语言官方主流工程命名契约。',
        remediation: '命名风格失真 (TS/JS 源码非 kebab-case，GDScript/Python/Rust 非 snake_case)。',
    },
    'HYG-SGL-001': {
        name: 'HYG-SGL-001',
        summary: '单字母绑定（仅 i/j/k/_ 放行）。',
        remediation: '使用描述性命名。',
    },
    'HYG-STB-001': {
        name: 'HYG-STB-001',
        summary: '闭环开发任务，清理临时桩。',
        remediation: '代码或注释中残留 `TODO`, `FIXME`, `XXX`, `HACK` 等临时未决桩标记。',
    },
    'HYG-STB-002': {
        name: 'HYG-STB-002',
        summary: '使用中立、长效的业务领域术语替换临时工单代号。',
        remediation:
            '全域代码与注释中泄漏临时施工工单黑话 (`pXX`, `phaseXX`, `stXX`, `wip`)。词汇表可用 `hygiene.options.jargonPatterns`（正则源数组）替换为**项目自有**词表，避免项目词被误判或被整条规则静音。',
    },
    'HYG-WRAP-001': {
        name: 'HYG-WRAP-001',
        summary:
            'Vacuous passthrough wrapper functions forwarding arguments directly without added value degrade effective code density.',
        remediation:
            '直接调用被封装的目标方法，或在封装层补充必要的数据校验、状态转换与上下文日志。',
    },
    'HYG-WRAP-002': {
        name: 'HYG-WRAP-002',
        summary:
            'Redundant zero-argument forwarding wrappers trivially delegating to inner targets without validation, transformation, or abstraction.',
        remediation:
            '若无多态或抽象解耦必要，直接暴露被委托方或内联调用；若确需封装，请补充守卫逻辑、状态转换或上下文日志。',
    },
    'NAM-COL-001': {
        name: 'NAM-COL-001',
        summary: '集合（Array/Set）建议使用复数或 List 后缀，映射（Map/Dict）建议表达对应关系。',
        remediation: '为数组集合增加复数形态，为字典映射添加 `*To*` 或 `*By*` 表达关联意图。',
    },
    'NAM-DEC-001': {
        name: 'NAM-DEC-001',
        summary:
            '标识符长度膨胀（30~40+ 字符）或同文件多符号共享长前缀，表明缺乏目录与模块分层解耦，驱动架构拆分。',
        remediation:
            '提炼公共领域模块或下沉子目录，将冗长的前缀转化为模块/包命名空间，降低单个符号长度并实现物理分层解耦。',
    },
    'NAM-DIR-001': {
        name: 'NAM-DIR-001',
        summary: '源码目录名必须为全小写 kebab-case 或单名，严禁 CamelCase、空格及临时批次词。',
        remediation: '将目录重命名为全小写短横线风格（如 `ast-utils`、`pipeline`）。',
    },
    'NAM-FIL-001': {
        name: 'NAM-FIL-001',
        summary:
            '文件命名必须符合语言惯例（TS/JS 强制 kebab-case，Python/Rust/GDScript 强制 snake_case），严禁临时批次黑话。',
        remediation:
            '将文件名规范重命名为对应语言的标准格式（如 `foo-bar.ts` 或 `foo_bar.py`），且不可带有临时标记。',
    },
    'NAM-GLB-001': {
        name: 'NAM-GLB-001',
        summary: '模块顶层不可变常量必须遵循 UPPER_SNAKE_CASE 命名规范。',
        remediation:
            '将模块级原始常量重命名为大写蛇形命名（如 `MAX_RETRIES`、`DEFAULT_TIMEOUT`）。',
    },
    'NAM-GLB-002': {
        name: 'NAM-GLB-002',
        summary: '严禁在模块顶层声明可变 `let` 或 `var` 变量（隐式全局共享状态）。',
        remediation: '重构顶层可变状态为函数作用域变量、类实例属性或显式单例状态持有者。',
    },
    'NAM-JRG-002': {
        name: 'NAM-JRG-002',
        summary:
            '工程资产与测试用例中严禁包含施工批次与临时黑话标记（禁止词如阶段批次号、临时变量及在制品缩写标记等），覆盖测试套件名、函数符号与标识符。',
        remediation:
            '将施工批次标记替换为具有实际业务与领域架构含义的语义命名，杜绝将临时施工代号固化为资产。',
    },
    'NAM-MBR-001': {
        name: 'NAM-MBR-001',
        summary: '类属性、对象字段与方法名必须遵循 camelCase 小驼峰命名规范。',
        remediation: '将属性和方法名调整为清晰有意义的小驼峰命名。',
    },
    'NAM-RES-001': {
        name: 'NAM-RES-001',
        summary:
            '结构化资源库（常量/字符串/规则/配置/枚举等）过于笼统且规模与语义体积膨胀，驱动按业务领域拆分。',
        remediation:
            '根据功能负责域与倒排调用关系，将笼统大文件拆分为二级拓扑模块（如 constants_network.ts、constants_ui.ts）。',
    },
    'NAM-RES-002': {
        name: 'NAM-RES-002',
        summary: '结构化资源库过度细化导致碎片化，微小文件使用了三级深层命名，建议合并至父域。',
        remediation:
            '将低容量、高内聚的细分子库合并回二级领域模块（如合并至 constants_network.ts），降低架构认知成本。',
    },
    'NAM-RES-003': {
        name: 'NAM-RES-003',
        summary: '结构化资源库命名层级溢出（超过基础类型+功能域+可选子域的三层上限）。',
        remediation:
            '简化命名拓扑至最多三层（基础类型名 + 功能负责域 + 可选精细化领域），消除过深层级。',
    },
    'NAM-RES-004': {
        name: 'NAM-RES-004',
        summary:
            '结构化资源库文件名过度描述堆叠（如 constants_network_http_request_response_...），造成维护负担。',
        remediation: '去除冗余堆叠的描述词，改用精炼的领域命名表达架构职责。',
    },
    'NAM-RES-005': {
        name: 'NAM-RES-005',
        summary: '结构化资源库文件职责不匹配（声明为纯常量库却混入大量可执行业务函数与类）。',
        remediation: '将可执行业务计算下沉至领域服务或工具类中，保持结构化资源库纯粹性。',
    },
    'NAM-SGL-001': {
        name: 'NAM-SGL-001',
        summary: '严禁在业务逻辑中使用单字母变量名（仅循环头计数器与 discard 占位符豁免）。',
        remediation: '改用能表达具体意图的具名标识符；仅 `for (let i = ...)`、`_` 允许单字母。',
    },
    'NAM-TYP-001': {
        name: 'NAM-TYP-001',
        summary: '类型定义与类声明必须遵循 PascalCase 大驼峰命名。',
        remediation:
            '将类、接口、类型别名或枚举重命名为大驼峰格式（如 `Scanner`、`RuleDefinition`）。',
    },
    'NAM-VAG-001': {
        name: 'NAM-VAG-001',
        summary: '严禁使用无业务语义的模糊泛化变量名（如 data、res、ret、tmp、item 等裸词）。',
        remediation:
            '结合业务领域语义补齐前缀或后缀（如 `parseResult`、`tokenPayload`、`ruleEntry`）。',
    },
    'SIM-BOOL-001': {
        name: 'SIM-BOOL-001',
        summary: '冗余的布尔字面量显式比对。',
        remediation: '简化为直接条件判断或布尔否定。',
    },
    'SIM-COMC-001': {
        name: 'SIM-COMC-001',
        summary: '直接删除（历史在 git 里）或恢复为真实代码',
        remediation:
            '连续 ≥ `commentedCodeMinLines`（默认 3）行「代码形状」注释。关键字锚定（`def`/`function`/`return`/`if`/`import`… 或 `NAME =` 形式），散文注释不会命中。',
    },
    'SIM-ELSE-001': {
        name: 'SIM-ELSE-001',
        summary: '提前终止语句之后存在冗余 else 分支。',
        remediation: '移除冗余 else 并平铺后续主体逻辑。',
    },
    'SIM-EMPTY-001': {
        name: 'SIM-EMPTY-001',
        summary: '实现函数体、显式抛「未实现」异常，或删除声明',
        remediation: '函数体只剩 `pass`/`...`（跳过前置 docstring）或空 `{}`。',
    },
    'SIM-FLAT-002': {
        name: 'SIM-FLAT-002',
        summary:
            '深层嵌套的条件分支与 AST 访问流应使用卫语句（Guard Clause）提前返回或短路扁平化，控制嵌套深度 ≤ 3。',
        remediation:
            '将深层嵌套的 if/else 重构为反向条件的前置卫语句（提前 return/continue/break），保持主逻辑扁平清晰。',
    },
    'SIM-GUARD-001': {
        name: 'SIM-GUARD-001',
        summary: '倒置的前置守卫条件导致深层嵌套。',
        remediation: '反转条件提取提前返回的 Guard Clause。',
    },
    'SIM-IMM-001': {
        name: 'SIM-IMM-001',
        summary: '通过三元表达式折叠消除未初始化的局部可变绑定，提纯为不可变 const',
        remediation:
            '将 let x; if (c) { x = a; } else { x = b; } 提纯为 const x = c ? a : b;，消除可变状态生命周期。',
    },
    'SIM-LONG-001': {
        name: 'SIM-LONG-001',
        summary: '抽取内聚步骤为具名 helper，让顶层流程只剩意图序列',
        remediation:
            '函数物理跨度超过 `thresholds.maxFunctionLines`（默认 60）。跨度取适配器物化的起止行，覆盖 TS/JS/Python/Rust/GDScript。',
    },
    'SIM-PRNT-001': {
        name: 'SIM-PRNT-001',
        summary: '改用结构化 logger 或删除；调试输出绕过日志级别并泄漏到生产 stdout',
        remediation:
            '非豁免路径出现调试输出（`print`/`pprint`/`breakpoint`/`console.log`/`println!`/`dbg!` 等）。默认豁免 `**/cli/**`、`**/scripts/**`、`**/tests/**`、`**/bench/**`、`*.test.*`、`*.spec.*`，可用 `printAllowPatterns` 覆盖。',
    },
    'SIM-TRN-001': {
        name: 'SIM-TRN-001',
        summary: '冗长且无副作用的 if-else 分支可折叠为浅层单行三元表达式',
        remediation:
            '双分支为同变量单一赋值或纯返回值时，在无副作用、单层深度且行长 ≤ 80 字符的前提下折叠为三元表达式，降低控制流复杂度。',
    },
    'large-file': {
        name: 'large-file',
        summary: '文件行数/函数数超过阈值。',
        remediation: '按职责拆分模块，或把工具函数迁到专属文件。',
    },
};
