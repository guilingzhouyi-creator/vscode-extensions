/**
 * Module: Core Engine - Praxis Presentation Chinese Security Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-security.ts
 * Architecture Role: Chinese localization table for Security rules.
 * Dependencies & Triggers: Consumed by zh-cn/index.ts and i18nProvider.
 * Responsibilities: Export localized rule descriptors in Chinese.
 * Exit Semantics & Design Rationale: Pure constants, zero dependencies.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 安全治理领域规则中文本地化呈现字典。
 */
export const ZH_CN_SECURITY_RULES: Record<string, PraxisRuleI18nEntry> = {
    'CMP-CAL-001': {
        name: '异步回调嵌套层级超标',
        summary: '多层连续回调缩进嵌套形成回调地狱，超出可维护性界限。',
        remediation: '降低回调嵌套深度：改用 async/await、Promise 链扁平化或抽取具名顶层函数。',
        rationale: '深层回调嵌套不仅可读性极差，而且异常冒泡与上下文资源清理非常容易遗漏。',
    },
    'CMP-DEN-001': {
        name: 'CMP-DEN-001',
        summary:
            'Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity.',
        remediation: '降低认知密度：添加适当空白与具名中间常量，拆分高密度算式或位运算组合。',
    },
    'CMP-EXP-001': {
        name: '巨型表达式认知负载超限',
        summary: '嵌套三元表达式或冗长逻辑运算链超出人类与模型局部推理的认知阈值。',
        remediation:
            '将嵌套三元表达式重构为具名纯函数、早返回卫语句或 lookup 表；将复杂逻辑链提取为布尔谓词常量。',
        rationale: '过于冗长的内联表达式增加认知负荷并极易掩盖短路求值与优先级逻辑缺陷。',
    },
    'CMP-LIN-001': {
        name: 'CMP-LIN-001',
        summary:
            'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
        remediation: '将单行内的多个语句或副作用拆分为独立代码行，遵循单行单一语义原则。',
    },
    'CMP-LOC-001': {
        name: '单函数圈复杂度过高',
        summary: '函数的独立判定分支过多（圈复杂度超出阈值），逻辑分支拓扑过于复杂。',
        remediation: '使用卫语句提前返回（Guard Clauses），或运用策略表/多态分发拆分多层分支。',
        rationale: '过高的分支复杂度呈指数级提升单元测试用例构造难度并隐藏边界缺陷。',
    },
    'CMP-LOC-002': {
        name: '嵌套层级过深',
        summary: '代码块缩进与控制流嵌套层次超出阈值（通常超过 4 层）。',
        remediation: '将内层深层控制流提取为独立私有函数，并采用及早返回原则扁平化逻辑。',
        rationale: '深层金字塔嵌套严重破坏代码可读性与局部推理推导能力。',
    },
    'CPX-AMP-001': {
        name: '复杂度放大陷阱',
        summary: '复杂度放大陷阱：在迭代或热点调用链中隐式嵌套阻塞 I/O 或序列化。',
        remediation: '将 I/O 与序列化批量汇聚在循环外部执行。',
    },
    'CPX-BUD-001': {
        name: '超出弹性复杂度预算',
        summary: '超出弹性复杂度预算：综合语言、角色、代码域与清晰度测算的预算超标。',
        remediation: '根据角色与职责拆分函数，或将多重嵌套扁平化为策略表/状态机。',
    },
    'CPX-HOP-001': {
        name: '机械式拆分投机',
        summary: '机械式拆分投机：通过制造大量单行薄转发包装函数人为压低复杂度。',
        remediation: '消除无意义的透传转发包装，聚焦于语义重用与领域内聚。',
    },
    'CPX-JST-001': {
        name: '非必要设计失控复杂度',
        summary: '非必要设计失控复杂度：高复杂度来自无序嵌套和职责堆积，缺乏算法/状态机证明。',
        remediation: '梳理核心职责，解离混合流程并分离副作用。',
    },
    'CPX-NEST-001': {
        name: '失控深层控制流嵌套',
        summary:
            '失控深层控制流嵌套：控制流嵌套层级超出该上下文类型的弹性预算（业务代码>3层，状态机/解析器>5层）。',
        remediation:
            '利用提前返回（Guard Clauses）扁平化控制流，或将复杂分支独立为子状态处理函数。',
    },
    'CPX-NEST-002': {
        name: '深层长跨度控制流跳跃',
        summary:
            '深层长跨度控制流跳跃：在深层嵌套（>=4层）且距函数头超长跨度处执行非结构化控制流逃逸（return/break/throw）。',
        remediation:
            '利用局部卫语句提前校验，或将深层长跨度闭环提取为纯函数子算子以缩短认知跳跃距离。',
    },
    'CPX-REC-001': {
        name: 'CPX-REC-001',
        summary: '跨函数/跨文件无终止保障的递归或互递归调用链。',
        remediation: '引入显式深度累加参数与终止保护，或改写为迭代工作列表。',
    },
    'CPX-RED-001': {
        name: '分布式冗余复杂度超标',
        summary:
            '分布式冗余复杂度超标：跨多个文件存在高度相似的算法流程、计算或校验逻辑，累积形成隐性系统复杂度。',
        remediation: '评估逻辑共性并依据领域边界进行抽离，或消除局部开发复制。',
    },
    'CPX-SPACE-001': {
        name: 'CPX-SPACE-001',
        summary: '热点循环内无界瞬态内存分配与重复全量物化。',
        remediation: '将对象/缓冲区分配提升到循环外，循环内执行就地重置与复用。',
    },
    'CPX-STM-001': {
        name: '状态机分派结构规范',
        summary:
            '状态机分派结构规范：状态机多层分支内存在过长单分支逻辑（>30 LOC），降低了分派骨架的清晰度。',
        remediation: '将状态机单分支过长逻辑提取为独立动作处理器，保留纯粹的状态转移分派骨架。',
    },
    'CPX-TIME-001': {
        name: '跨函数/跨文件无界多项式时间复杂度',
        summary: '跨函数/跨文件无界多项式时间复杂度：嵌套迭代调用链引发高开销。',
        remediation: '将内层数据预先构建为 Map/Set 索引，降低复合复杂度至 O(N)。',
    },
    'ERR-PRP-001': {
        name: 'ERR-PRP-001',
        summary: '错误码跨声明重复抛出（分类法冲突）或沿调用链向上传播过多跳数。',
        remediation: '统一错误分类法，使用具名错误类型并在边界层显式捕获转换。',
    },
    'RES-LAK-001': {
        name: '资源未在终结块释放',
        summary: '打开的流、句柄、定时器或锁未在 finally 块或清理函数中保证释放。',
        remediation:
            '确保在 try...finally 结构中调用 release/close/dispose，或使用 Disposable 模式。',
        rationale: '异常路径下的资源遗漏将导致文件句柄枯竭、内存泄漏或死锁。',
    },
    'SEC-CST-001': {
        name: '禁止硬编码敏感凭据',
        summary: '在代码切片中检测到硬编码的高熵密钥、密码或 API Token。',
        remediation: '将敏感凭据迁移至安全环境变量或保密凭证存储服务中，切勿在源代码中显式书写。',
        rationale: '硬编码凭据极易随代码提交扩散并造成凭据泄漏风险。',
    },
    'SEC-LEAK-001': {
        name: 'SEC-LEAK-001',
        summary: '日志/异常中输出敏感数据（密码、令牌、个人标识）。',
        remediation: '脱敏后再记录，或只记录标识符与哈希。',
    },
    'SEC-VUL-001': {
        name: 'SEC-VUL-001',
        summary: '任意动态代码执行（eval/exec/Function 构造）。',
        remediation: '改为显式分支或查表；确需动态求值时使用受限解析器。',
    },
    'SEC-VUL-002': {
        name: '命令注入',
        summary: '命令注入：拼接外部输入后交给 shell/子进程执行。',
        remediation: '使用参数数组形式（execFile/spawn 无 shell）并对输入做白名单校验。',
    },
    'SEC-VUL-003': {
        name: '原型污染',
        summary: '原型污染：给对象原型写入来自外部的键。',
        remediation: '拒绝 __proto__/constructor/prototype 键，或改用 Map 承载外部数据。',
    },
    'SEC-VUL-004': {
        name: '不安全随机数',
        summary: '不安全随机数：用 Math.random 生成安全敏感值。',
        remediation: '改用 crypto.randomUUID/randomBytes 等密码学安全随机源。',
    },
    'SEC-VUL-005': {
        name: '弱哈希',
        summary: '弱哈希：md5/sha1 用于完整性或口令场景。',
        remediation: '改用 sha256 及以上；口令使用 bcrypt/argon2 等加盐慢哈希。',
    },
    'SEC-VUL-006': {
        name: '路径穿越',
        summary: '路径穿越：用外部输入拼接文件路径。',
        remediation: '规范化后校验是否仍位于允许的根目录内，并拒绝 .. 片段。',
    },
    'STDLIB-ALLOC-001': {
        name: 'no_std 隐式堆分配防护',
        summary: '在裸机或 no_std 系统上下文中检测到隐式动态堆内存分配。',
        remediation: '使用固定容量栈缓冲、引用切片或预分配内存池代替堆内存分配。',
        rationale: '裸机与嵌入式环境缺乏全局堆分配器，动态堆分配会引发链接或运行时错误。',
    },
    'STDLIB-CONST-001': {
        name: '密码学恒定时间比对',
        summary: '密码学或哈希校验敏感比对存在提前退出的字节短路分支，易受时序侧信道攻击。',
        remediation: '改用恒定时间比对（例如 constant_time_eq 或累加异或位），避免提前退出。',
        rationale: '时序侧信道可被攻击者利用逐字节推导比对内容，造成安全机制绕过。',
    },
    'STDLIB-PANIC-001': {
        name: '公开接口裸 panic 逃逸防护',
        summary: '标准库或核心公开接口中包含可能崩溃的裸 panic/unwrap 逃逸调用。',
        remediation: '公开 API 应返回 Result<T, E> 或 Option<T>，使用 match 或 ? 操作符解包。',
        rationale: '底层库发生不可捕获的 panic 会导致宿主进程直接崩溃，违反生产健壮性规范。',
    },
    'STDLIB-PORT-001': {
        name: '跨平台编译兜底防护',
        summary: '平台特定条件编译块缺少不支持目标平台的阻断兜底。',
        remediation:
            '添加 #[cfg(not(any(...)))] compile_error!("Unsupported target OS/Arch"); 兜底。',
        rationale: '缺少兜底条件编译会导致在未支持平台上产生隐晦的符号缺失而非明确的编译报错。',
    },
    'STDLIB-RECURSION-001': {
        name: '无界递归深度防卫',
        summary: '检测到递归自调用，但缺少显式深度限制参数或递归保护防卫。',
        remediation: '引入显式 depth / recursion_limit 参数并在超限时返回错误，或改用迭代循环。',
        rationale: '无界递归极易因极端输入耗尽调用栈而引发栈溢出崩溃（Stack Overflow）。',
    },
    'STDLIB-UNSAFE-001': {
        name: 'unsafe 块契约证明补齐',
        summary: '底层 unsafe 代码块缺少强制性的 // SAFETY: 契约证明注释。',
        remediation: '在 unsafe 块前添加 // SAFETY: 说明为何前提条件与内存不变量得以保证。',
        rationale: '未附带证明的 unsafe 块显著增加内存破坏、未定义行为与维护审计风险。',
    },
    'TST-DBT-001': {
        name: 'TST-DBT-001',
        summary: '未登记里程碑收敛计划或责任人的滞后测试技术债务。',
        remediation: '在测试债务登记表中补全责任 Agent 及目标收敛里程碑。',
    },
    'TST-DEN-001': {
        name: 'TST-DEN-001',
        summary: '关键业务模块的有效现代化测试密度 (EMTD) 或当前业务承接率 (CBCR) 低于阈值。',
        remediation: '补齐高风险语义单元的契约测试与边界测试，提高实际故障感知能力。',
    },
    'TST-ILS-001': {
        name: '测试完整性幻觉',
        summary: '测试完整性幻觉：测试仅校验 Mock 配置或绑定已废弃业务契约。',
        remediation: '将测试迁移至验证活跃业务契约与实际领域状态变化。',
    },
    'TST-SKP-001': {
        name: 'TST-SKP-001',
        summary: '核心业务域中长期滞留的跳过、隔离或未执行测试用例。',
        remediation: '修复并恢复测试用例，或正式登记入测试债务清单并设定收敛里程碑。',
    },
    'TST-TAU-001': {
        name: 'TST-TAU-001',
        summary: '缺乏真实业务断言或包含恒真断言的无效测试。',
        remediation: '替换恒真断言为针对业务实体输出和错误边界的有效验证。',
    },
    'TST-TOP-001': {
        name: '多语言测试拓扑双轨纪律',
        summary:
            '多语言测试拓扑双轨纪律：严禁在 TS/GDScript 等语言生产代码中内嵌测试代码域，强化 Rust 计算库物理分区与面向 Agent 可读注释契约。',
        remediation:
            '将内嵌在非 Rust 生产文件中的测试逻辑迁移至显式独立测试文件（如 *.test.ts），Rust 计算库测试必须置于 #[cfg(test)] 尾部分区并补充 Agent 可读注释。',
    },
    'duplicate-literal': {
        name: 'duplicate-literal',
        summary: '自动聚合多处行号并提示提取共享常量。',
        remediation: '同一文件内相同字面量出现频次超标（默认 ≥ 3 次）。',
    },
    'high-complexity': {
        name: 'high-complexity',
        summary: '函数圈复杂度超过阈值。',
        remediation: '抽取具名步骤、早返回替代嵌套分支，或按职责拆分函数。',
    },
    'high-entropy-token': {
        name: 'high-entropy-token',
        summary: '高熵字符串疑似密钥/令牌。',
        remediation: '移入配置/密钥管理；确为误报时用 matchRule 抑制并写明理由。',
    },
    'nested-constant': {
        name: '严禁常量化嵌套',
        summary: '严禁常量化嵌套：禁止冗余常量别名引用、深层嵌套常量对象与作用域内部伪常量。',
        remediation: '将常量直接内联或提升至模块顶层单源声明，消除无意义的间接别名与深层对象嵌套。',
    },
    'secret-detected': {
        name: 'secret-detected',
        summary: '疑似硬编码凭据（按模式识别）。',
        remediation: '撤销并轮换该凭据；改为从环境/密钥管理读取。',
    },
};
