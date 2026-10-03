/**
 * Module: Core Engine - Praxis Presentation Chinese Architecture Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-architecture.ts
 * Architecture Role: Chinese localization table for Architecture rules.
 * Dependencies & Triggers: Consumed by zh-cn/index.ts and i18nProvider.
 * Responsibilities: Export localized rule descriptors in Chinese.
 * Exit Semantics & Design Rationale: Pure constants, zero dependencies.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 架构规范领域规则中文本地化呈现字典。
 */
export const ZH_CN_ARCHITECTURE_RULES: Record<string, PraxisRuleI18nEntry> = {
    'ADV-PRF-001': {
        name: '循环内高开销运算外提',
        summary: '在循环或热路径中检测到重复的重型运算或未缓存的属性深度解析。',
        remediation: '将循环内恒定的计算表达式或属性查找提升到循环外部，使用局部变量缓存结果。',
        rationale: '避免在热路径上浪费 CPU 周期，提升代码局部执行吞吐量。',
    },
    'ADV-PRF-002': {
        name: '循环内瞬态堆分配防护',
        summary: '在紧凑循环内部检测到高频临时对象或闭包实例化，引发高 GC 压力。',
        remediation: '在循环外预先分配可复用实例或池化对象，在迭代中通过 reset_state() 清理复用。',
        rationale: '瞬态短生命周期对象会加剧垃圾回收器分代停顿，严重影响响应时间。',
    },
    'ARC-COH-001': {
        name: '单文件行数超出上限',
        summary: '文件总物理行数超出既定架构上限（通常为 400 行）。',
        remediation: '根据单一职责原则拆分领域职责，将内聚逻辑抽取为独立子模块。',
        rationale: '超大文件显著增加人机阅读认知负担，并增加并发合并冲突概率。',
    },
    'ARC-COH-002': {
        name: '单文件函数数量超标',
        summary: '单文件中定义的顶层函数与方法总数过多（通常超出 20 个）。',
        remediation: '评估职责聚合度，将从属辅助函数归类收拢至专用子模块或领域工具类中。',
        rationale: '过多函数混杂在同一文件通常意味着模块内聚性不足，存在隐藏上帝对象风险。',
    },
    'ARCH-ABS-001': {
        name: '过度抽象与非必要间接层',
        summary: '过度抽象与非必要间接层：为少量共性引入跨层深层转发跳板、跨域依赖反转或循环依赖。',
        remediation: '消除负收益间接跳板与人为抽象，容许领域隔离的局部正当实现。',
    },
    'ARCH-BLR-001': {
        name: '文件边界失衡',
        summary: '文件边界失衡：单文件内多个高复杂度函数缺乏语义关联，职责异常聚合。',
        remediation: '按语义与状态边界将文件拆分为高内聚的独立领域模块。',
    },
    'ARCH-BND-001': {
        name: '跨业务域内部穿透',
        summary: '跨业务域内部穿透：绕过公共导出 Facade 契约直接访问非公开内部实现。',
        remediation: '通过模块顶层公共导出 API 访问，禁止直接引用 /internal/ 或 /private/。',
    },
    'ARCH-CFG-001': {
        name: '环境配置泄漏',
        summary: '环境配置泄漏：纯领域业务模型内部直接读取环境变量或底层磁盘配置。',
        remediation: '将环境配置提升到应用装配层解析，并以强类型参数注入领域对象。',
    },
    'ARCH-CFG-002': {
        name: 'ARCH-CFG-002',
        summary: '声明的配置项在全库代码中从未参与任何决策、控制流或计算（死配置）。',
        remediation: '移除无用死配置项或补充对应业务开关/策略引用。',
    },
    'ARCH-CFG-003': {
        name: 'ARCH-CFG-003',
        summary: '同一配置项在多处重复定义，破坏配置单一真源。',
        remediation: '收敛重复配置到单一配置表或继承层级中。',
    },
    'ARCH-CFG-004': {
        name: '隐式配置散落',
        summary: '隐式配置散落：业务代码中散落硬编码环境变量读取或隐式调优参数。',
        remediation: '将散落的环境变量与调优参数提取至统一配置对象并通过参数注入。',
    },
    'ARCH-CFG-005': {
        name: '配置访问散落',
        summary: '配置访问散落：未通过统一配置层或注册表，跨层无序散落访问配置。',
        remediation: '建立统一配置访问层或注册表，集中收口配置读取。',
    },
    'ARCH-CFG-006': {
        name: '配置业务强耦合',
        summary: '配置业务强耦合：领域模型直接绑定具体配置文件物理格式或磁盘解析。',
        remediation: '通过接口或类型化策略对象解耦，由外层装配并注入领域核心。',
    },
    'ARCH-CFG-007': {
        name: '配置过度抽象',
        summary: '配置过度抽象：简单静态配置引入多重不必要间接封装与透传层。',
        remediation: '按项目规模裁剪冗余封装，平铺轻量配置访问。',
    },
    'ARCH-CFG-008': {
        name: '配置表根目录平铺蔓延反模式',
        summary: '配置表根目录平铺蔓延反模式：超过阈值的大量配置平铺于根目录，缺乏领域同构分层。',
        remediation:
            '建立领域同构目录（如 config/domains/<域>/core.json），统一分域收拢并消除根目录平铺散落。',
    },
    'ARCH-CFG-009': {
        name: '配置子表路由契约违规',
        summary:
            '配置子表路由契约违规：未登记的子表配置脱离主核心路由契约，缺乏点分泛化路由与热重载看守。',
        remediation: '将子表登记至主配置表并接入点分路由与细粒度热重载守卫。',
    },
    'ARCH-DEC-002': {
        name: 'ARCH-DEC-002',
        summary:
            '多语言 AST 解析与适配器逻辑必须独立解耦为适配器模块，分析器主体严禁混杂语法树构造细节或深耦合特定语言适配器实现。',
        remediation:
            '将多语言 AST 构造逻辑抽取至 `src/core/semantic/adapters/` 独立适配器，分析器仅面向 `NormalizedNode` 或多态接口。',
    },
    'ARCH-DIR-001': {
        name: 'ARCH-DIR-001',
        summary: '倒置依赖，在领域层定义接口契约，由外层实现。',
        remediation: '核心逆流：领域层 (Domain) 反向依赖外层应用层/基础设施/接口层。',
    },
    'ARCH-DIR-002': {
        name: 'ARCH-DIR-002',
        summary: '引入用例服务 (Application Service) 统筹业务流。',
        remediation: '越层穿透：接口层控制器绕过应用层直接直连基础设施实现。',
    },
    'ARCH-DIR-003': {
        name: '形式分层假象',
        summary: '形式分层假象：目录结构表面隔离，但调用关系与数据流发生逆向越层。',
        remediation: '调整调用依赖流向，由内层领域定义契约接口并交由基础设施层实现。',
    },
    'ARCH-DISP-001': {
        name: 'ARCH-DISP-001',
        summary:
            'Monolithic dispatchers with excessive branches (> 8) tightly couple domain logic, violating the Open-Closed Principle.',
        remediation:
            '重构为基于字典/Map 的查表分发 (Table-Driven) 或策略模式 (Strategy Pattern)，解耦各分支业务逻辑。',
    },
    'ARCH-DSP-002': {
        name: 'ARCH-DSP-002',
        summary:
            'Dispatcher closure fragmentation: Object literal defines excessive inline function closures (>= 15), causing closure explosion and function inflation.',
        remediation:
            '重构为按职责正交划分的 switch 分发函数（单函数圈复杂度 <= 10）或顶层具名处理函数，消除闭包碎片化。',
    },
    'ARCH-GLB-001': {
        name: '隐式全局可变状态',
        summary: '隐式全局可变状态：模块间通过顶层全局变量或单例产生隐式强耦合。',
        remediation: '重构为依赖注入或按需创建实例，消除共享可变静态单例。',
    },
    'ARCH-HDL-001': {
        name: '无头架构违规',
        summary: '无头架构违规：核心业务逻辑或计算模块直接绑定 UI/IDE 视图框架。',
        remediation: '解除核心计算与展示框架依赖，保持无头独立执行与测试能力。',
    },
    'ARCH-LEAK-001': {
        name: 'ARCH-LEAK-001',
        summary: '领域模型使用 POJO/原生实体，隔离外部框架专有类型。',
        remediation: '职责泄漏：纯领域模型直接引用或泄漏外部框架库 (Express/Vue/Godot/ORM)。',
    },
    'ARCH-LEAK-002': {
        name: '分层越界',
        summary: '分层越界：外层实现被内层直接反向引用（Clean/DDD 层序反转）。',
        remediation: '把依赖改回单向（内层定义接口、外层实现），或把该文件移入正确层。',
    },
    'ARCH-ROL-001': {
        name: '文件本体角色失衡与伪共享库',
        summary:
            '文件本体角色失衡与伪共享库：文件承担过多易变状态或高耦合业务逻辑，却被跨域频繁引用作为共享库。',
        remediation: '剥离核心领域状态，明确稳定输入输出边界，构建真正低耦合的共享库。',
    },
    'ARCH-ROL-002': {
        name: '业务模块承载无界公共能力',
        summary:
            '业务模块承载无界公共能力：领域业务模块内部私自承载与导出通用基础设施或公共计算能力。',
        remediation: '将通用能力下沉至对应共享层或基础设施层，确保领域模块职责专注单一。',
    },
    'ARCH-SKL-001': {
        name: '策略骨架复用候选',
        summary: '策略骨架复用候选：检测到具有同构前置校验与收尾步骤的复杂流程。',
        remediation: '提取公共执行骨架（模板方法/高阶函数编排），将差异步骤作为策略注入。',
    },
    'ARCH-TMP-001': {
        name: '巨石视图/模板渲染器未解耦',
        summary:
            '巨石视图/模板渲染器未解耦：单函数规模超标且包含深度 HTML/SVG/DSL 模板字符串拼接，缺少局部组件化。',
        remediation:
            '拆解为领域正交的局部组件（Header/Card/Graph Partials），由结构化 ViewModel 驱动渲染。',
    },
    'ARCH-UTL-001': {
        name: '万能工具库反模式',
        summary: '万能工具库反模式：检测到承担混杂异构逻辑的 utils/common 垃圾桶文件。',
        remediation:
            '按四分流治理原则重构：纯算子进入算法库、常量进入常量库、规则进入策略库、通用转换进入基础层。',
    },
    'DAT-DEF-001': {
        name: 'DAT-DEF-001',
        summary: '受信内部领域边界内的冗余重复防御性校验。',
        remediation: '在信任边界执行一次性完整校验，内部领域对象依托不可变类型保证。',
    },
    'DAT-LAY-001': {
        name: '数据访问抽象泄漏',
        summary: '数据访问抽象泄漏：业务核心直接操纵持久化驱动或底层存储细节。',
        remediation: '将存储驱动调用封装在仓储接口实现内，领域层仅依赖仓储契约。',
    },
    'DAT-NPL-001': {
        name: 'DAT-NPL-001',
        summary: '迭代与映射上下文中的 N+1 查询与重复存储调用。',
        remediation: '将循环内查询提升至外层使用批量 IN 查询或 DataLoader 批量加载。',
    },
    'DAT-QRY-001': {
        name: 'DAT-QRY-001',
        summary: '在线请求链路中的无界数据读取或全表内存过滤。',
        remediation: '增加游标分页或 Limit/Offset 条件，强制限制单次读取上限。',
    },
    'DAT-RES-001': {
        name: '资源注册表双向映射不一致或悬空资产',
        summary:
            '资源注册表双向映射不一致或悬空资产：资源登记中心存在空路径、悬空引用或双向映射断裂。',
        remediation: '确保资源中心双向对称登记，修复或移除悬空资源路径与孤儿资产。',
    },
    'DAT-SER-001': {
        name: 'DAT-SER-001',
        summary: '跨层调用链中的重复序列化与反序列化转换。',
        remediation: '在内部调用链路传递强类型原生对象，仅在网络边界执行序列化。',
    },
    'DEP-INV-001': {
        name: '依赖倒置违规',
        summary: '依赖倒置违规：底层基础设施或公共模块反向依赖高层业务模块。',
        remediation: '解除反向依赖，通过控制反转或事件总线进行解耦。',
    },
    'DEP-LAZ-001': {
        name: 'DEP-LAZ-001',
        summary: '未提供审计声明或合规理由的函数内部临时导入。',
        remediation: '将导入提升至文件顶部，或添加 @lazy/@optional 注释标注意图。',
    },
    'DEP-ORD-001': {
        name: 'DEP-ORD-001',
        summary: '文件布局与导入分组不符合当前语言现代化工程规范。',
        remediation: '调整导入顺序为 Stdlib -> ThirdParty -> InternalShared -> Local。',
    },
    'DEP-RES-001': {
        name: 'DEP-RES-001',
        summary: '业务逻辑中散落硬编码的未纳管外部 URL、文件路径或连接串。',
        remediation: '将外部资源地址统一抽取至配置文件或服务资源注册中心。',
    },
    'DEP-WLD-001': {
        name: 'DEP-WLD-001',
        summary: '使用通配符导入破坏显式依赖跟踪与树摇优化。',
        remediation: '改用显式具名导入 (Named Imports)，明确模块依赖面。',
    },
    'PRF-ALG-001': {
        name: 'PRF-ALG-001',
        summary: '将内层查找通过 Map/Set 哈希预索引降维为 $O(1)$。',
        remediation: '发现 $\\ge 3$ 层循环嵌套 (潜在 $O(N^3)$ 多项式计算热点)。',
    },
    'PRF-ALG-002': {
        name: '循环内集合线性遍历反模式',
        summary:
            '循环内集合线性遍历反模式：在循环结构内部对外部集合进行线性检索（find/includes/has/in list 等），导致整体算法复杂度恶化至 O(N*M)。',
        remediation:
            '在循环外预先将外部集合构建为 Map 或 Dictionary 哈希索引，将内层查找降至 O(1)，算法总体降至 O(N+M)。',
    },
    'PRF-IO-001': {
        name: 'PRF-IO-001',
        summary: '切换为异步非阻塞对应 API，避免锁死 Node.js 事件循环或游戏主线程。',
        remediation:
            '事件循环同步阻塞风险：在 `async` 上下文或高频帧循环内调用同步阻塞 I/O (如 `readFileSync`, `time.sleep`)。`thresholds.blockingIoAllowPatterns` 声明的路径 glob（CLI/校验器/基准脚本等进程式工具）豁免；该键同时下发给治理规则 `GOV-PRF-004`，属单一策略源。',
    },
    'PRF-LEAK-001': {
        name: 'PRF-LEAK-001',
        summary: '检测循环或定时器内的集合无界追加，防范 O(t) 或 O(n) 内存泄漏。',
        remediation: '为集合设置容量上限/LRU淘汰/定期重置，或避免在循环与定时器内无界追加。',
    },
    'PRF-MEM-001': {
        name: 'PRF-MEM-001',
        summary: '将缓冲区/对象提升至循环外部复用，循环内仅清空重置。',
        remediation:
            '高频热路径瞬态堆对象分配 (循环体内 `new Array`, `new Object`, `.duplicate(true)` 等)。',
    },
    'PRF-MEM-002': {
        name: 'PRF-MEM-002',
        summary: '循环热路径严禁瞬态实例化与深复制，必须使用对象池或外部复用（ADV-PRF-002）。',
        remediation:
            '高承压热路径瞬态堆对象分配 (循环体内 `new Class()`, `.new()`, `.duplicate(true)` 等)。采用对象池模式并在借出/归还时调用 `reset_state()` 重置状态。',
    },
    'PRF-POL-001': {
        name: '热路径高频昂贵资源缺乏复用池化',
        summary:
            '热路径高频昂贵资源缺乏复用池化：循环内或高频调用中频繁分配重型对象、缓冲区或连接。',
        remediation: '引入对应对象池/缓冲池机制并在生命周期结束时回收复用。',
    },
    'PRF-POL-002': {
        name: '资源池缺乏状态重置契约或容量上限',
        summary:
            '资源池缺乏状态重置契约或容量上限：池化机制缺失 reset_state 回收契约或无界增长导致数据污染与泄漏。',
        remediation: '补全对象归还重置逻辑并设定池容量高水位淘汰限制。',
    },
    'PRF-POL-003': {
        name: '负收益过度池化',
        summary: '负收益过度池化：对极小轻量纯值对象或冷路径过度引入池化管理开销，得不偿失。',
        remediation: '移除负收益池化包装层，直接采用值对象或短生命周期瞬态分配。',
    },
    'PRF-POL-004': {
        name: '流式数据分块加载缺乏环形缓冲复用',
        summary:
            '流式数据分块加载缺乏环形缓冲复用：在流式 I/O、分块循环读取或异步回调中反复实例化临时 Buffer，造成高频内存碎片与 GC 停顿。',
        remediation:
            '引入环形缓冲区（RingBuffer）或接入定长字节缓冲池（BufferPool），实现零拷贝槽位循环复用。',
    },
    'clean-layer-violation': {
        name: 'clean-layer-violation',
        summary: '增量管线中的分层越界（clean-layer 口径）。',
        remediation: '按层序调整依赖方向或把实现下沉/上提到正确层。',
    },
    'disallowed-import': {
        name: '声明式导入边界违规',
        summary: '声明式导入边界违规：跨组依赖或未授权外部包。',
        remediation: '按配置的 allowGroups/allowExternal 调整导入，或显式登记豁免。',
    },
    'expensive-loop-operation': {
        name: 'expensive-loop-operation',
        summary: '循环体内执行昂贵深拷贝（.duplicate(true)）或阻塞式序列化与IO。',
        remediation: '消除热路径内的深拷贝操作，改用只读视图或轻量引用。',
    },
    'high-algorithmic-complexity': {
        name: 'high-algorithmic-complexity',
        summary: '循环多重嵌套引发潜在 O(N^2)/O(N^3) 复杂度热点或循环体内隐式线性查找。',
        remediation: '重构循环嵌套或预先构建 Map/Set 索引将查找降为 O(1)。',
    },
    'import-cycle': {
        name: 'import-cycle',
        summary: '模块级循环依赖（Python 相对导入与包解析同样覆盖）。',
        remediation: '把共享契约下沉为独立模块，或用惰性导入打断环（惰性导入不建边）。',
    },
    'loop-transient-allocation': {
        name: 'loop-transient-allocation',
        summary: '循环体内瞬态堆分配（ADV-PRF-002），违背零瞬态分配契约。',
        remediation: '将对象实例化提升到循环外或使用对象池模式（ADV-POOL-001）。',
    },
    'unused-export': {
        name: 'unused-export',
        summary: '导出符号无人引用（TS/JS 口径；Python 无 export 关键字不参与）。',
        remediation: '删除无人使用的导出，或把它收回模块内部。',
    },
    'unused-module': {
        name: 'unused-module',
        summary: '模块无人导入（非入口白名单内）。',
        remediation: '删除该模块，或把入口 glob 加入 entryGlobs。',
    },
};
