/**
 * Module: Core Engine - Praxis Presentation Chinese Languages Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-languages.ts
 * Architecture Role: Chinese localization table for Languages rules.
 * Dependencies & Triggers: Consumed by zh-cn/index.ts and i18nProvider.
 * Responsibilities: Export localized rule descriptors in Chinese.
 * Exit Semantics & Design Rationale: Pure constants, zero dependencies.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 现代语言领域规则中文本地化呈现字典。
 */
export const ZH_CN_LANGUAGE_RULES: Record<string, PraxisRuleI18nEntry> = {
    'ASY-AWT-001': {
        name: '缺少必要的 await 异步调度',
        summary: '调用返回 Promise 的异步操作但未进行 await 等待，且未显式处理异常。',
        remediation: '在调用处增加 await，或者使用 .then().catch() 显式接管 Promise 决议与拒绝。',
        rationale: '未捕获的浮动 Promise 会导致竞态条件及未处理的全局异常（UnhandledRejection）。',
    },
    'GDM-BAR-001': {
        name: 'GDM-BAR-001',
        summary: '表现层直接离散操作裸 ProgressBar 实例，破坏 KStatusBar 标准交互与平滑动画规范。',
        remediation: '改用 KStatusBar 标准化组件，统一进度条生命周期、平滑补间动效与样式契约。',
    },
    'GDM-BND-001': {
        name: 'GDM-BND-001',
        summary: '表现层视图直接耦合后端领域单例或跨层订阅 EventBus 全局业务事件。',
        remediation:
            '表现层仅通过 BaseScreen.apply_snapshot() 单向接收数据，用户操作经由显式回调或 UI 意图派发。',
    },
    'GDM-CONNECT-001': {
        name: 'GDM-CONNECT-001',
        summary: '使用 Godot 3 connect 签名（方法名以字符串传入）。',
        remediation: '改用信号 connect(Callable) 形式。',
    },
    'GDM-DEB-001': {
        name: 'GDM-DEB-001',
        summary: '高频业务按钮裸连信号，缺少防抖机制或 loading 状态互斥控制。',
        remediation: '改用 KButton 原子组件或接入 debounced_pressed 信号以防连击重复提交。',
    },
    'GDM-EXPORT-001': {
        name: 'GDM-EXPORT-001',
        summary: '使用 Godot 3 的 export 语句。',
        remediation: '改用 @export 注解并保留类型声明。',
    },
    'GDM-EXT-001': {
        name: 'GDM-EXT-001',
        summary: '表现层主视图控制器未继承 BaseScreen 或 BaseModal 基类。',
        remediation:
            '主视图控制器应继承 BaseScreen（全屏视图）或 BaseModal（模态弹窗），接入标准生命周期与快照装配契约。',
    },
    'GDM-FSM-001': {
        name: 'GDM-FSM-001',
        summary: '有限状态机私有状态变量被就地直接赋值，破坏状态迁移守卫与进出钩子。',
        remediation: '必须通过 fsm.transition_to(target_state, payload) 方法触发合法状态流转。',
    },
    'GDM-I18N-001': {
        name: 'GDM-I18N-001',
        summary: '表现层 UI 文本未通过 UIIntermediary / 国际化键名绑定，存在裸字符串硬编码。',
        remediation: 'UI 文本必须采用 tr(KEY) 或通过 UIIntermediary 进行响应式国际化绑定。',
    },
    'GDM-ISO-001': {
        name: 'GDM-ISO-001',
        summary: '无头领域逻辑层直接引用视图层或场景树节点破坏解耦架构。',
        remediation: '领域逻辑与表现层解耦，通过数据快照或纯状态机通信。',
    },
    'GDM-LOC-001': {
        name: 'GDM-LOC-001',
        summary: '表现层视图脚本行数超出物理预算上限（LOC <= 450 行）。',
        remediation: '将复杂子组件、列表项渲染、数据转换器或伴生逻辑拆分为独立组件或伴生控制器。',
    },
    'GDM-NOD-001': {
        name: 'GDM-NOD-001',
        summary:
            '视图层脚本中出现飘移的相对节点路径（如 get_parent()、find_child() 或长跨级相对索引）。',
        remediation:
            '节点引用应使用显式 @onready %UniqueNode 或类型化依赖注入，禁止易脆弱的相对层级寻址。',
    },
    'GDM-ONREADY-001': {
        name: 'GDM-ONREADY-001',
        summary: '使用 onready 关键字。',
        remediation: '改用 @onready 注解。',
    },
    'GDM-POL-001': {
        name: 'GDM-POL-001',
        summary: '对象池获取后未实现或未调用 reset_state 契约。',
        remediation: '池化对象实现 reset_state() 并确保在 acquire/release 时重置状态。',
    },
    'GDM-POOL-001': {
        name: 'GDM-POOL-001',
        summary: '使用 Pool*Array 类型。',
        remediation: '改用 Packed*Array 系列类型。',
    },
    'GDM-POOL-002': {
        name: 'GDM-POOL-002',
        summary: '对象池 reset_state 未调用基类重置方法破坏契约。',
        remediation: '在 reset_state() 内部添加 super.reset_state() 调用以确保父类状态正确清理。',
    },
    'GDM-PRF-001': {
        name: 'GDM-PRF-001',
        summary: '循环或高频执行路径中瞬态堆分配导致掉帧风险。',
        remediation: '在循环外预分配集合、使用对象池或复用缓冲区实例。',
    },
    'GDM-RES-001': {
        name: 'GDM-RES-001',
        summary: 'UI 布局脚本中硬编码固定分辨率或绝对像素尺寸，破坏多端响应式适配。',
        remediation: '改用 Anchors Preset 锚点系统、自适应容器或 DesignTokens 相对尺寸基准。',
    },
    'GDM-RPC-001': {
        name: 'GDM-RPC-001',
        summary: '使用 remote/master/puppet/slave 函数修饰符。',
        remediation: '改用 @rpc 注解。',
    },
    'GDM-SIG-001': {
        name: 'GDM-SIG-001',
        summary: '信号连接后缺少对应断开逻辑导致生命周期悬挂泄漏。',
        remediation: '在生命周期结束前调用 disconnect 或接入自动管理连接。',
    },
    'GDM-TOK-001': {
        name: 'GDM-TOK-001',
        summary: '表现层视图硬编码 Color(...) 字面量或裸色值，破坏 DesignTokens 单一真源。',
        remediation:
            '从 DesignTokens 获取语义化色彩常量（如 DesignTokens.COLOR_*），确保主题与多端视觉统一。',
    },
    'GDM-TOOL-001': {
        name: 'GDM-TOOL-001',
        summary: '使用裸 tool 关键字。',
        remediation: '改用首行 @tool 注解。',
    },
    'GDM-UNI-001': {
        name: 'GDM-UNI-001',
        summary: '表现层视图就地修改只读 Snapshot DTO 属性，破坏 CQRS 单向数据流与单一真源。',
        remediation:
            '视图应将快照视为不可变只读数据，通过派发 Command 意图或调用领域边界服务请求变更。',
    },
    'GDM-VRT-001': {
        name: 'GDM-VRT-001',
        summary: '长列表场景全量就地实例化节点，未接入 KVirtualList 虚拟化滚动与对象池复用。',
        remediation:
            '长列表容器应接入 KVirtualList 配合对象池池化复用（ADV-POOL-001），禁止无界瞬态节点创建。',
    },
    'GDM-WEAK-001': {
        name: 'GDM-WEAK-001',
        summary: '动态观察者或全局管理器强引用持有 Node 实例，未采用 weakref 防内存泄漏。',
        remediation: '使用 weakref(node) 包装动态注册对象并在派发时校验 get_ref() 是否存活。',
    },
    'GDM-YIELD-001': {
        name: 'GDM-YIELD-001',
        summary: '使用 Godot 3 的 yield 协程写法。',
        remediation: '改用 await 表达式。',
    },
    'GOM-CTX-001': {
        name: 'GOM-CTX-001',
        summary: 'context.Context 不是函数的首个形参。',
        remediation: '将 ctx context.Context 移动到第一个形参位置。',
    },
    'GOM-ERR-001': {
        name: 'GOM-ERR-001',
        summary: '使用 _ 静默丢弃错误返回值。',
        remediation: '显式检查错误或说明忽略理由。',
    },
    'GOM-STYLE-001': {
        name: 'GOM-STYLE-001',
        summary: '方法接收器命名不符合 Go 惯例。',
        remediation: '使用 1-2 字母短名且与类型保持一致。',
    },
    'GOM-STYLE-002': {
        name: 'GOM-STYLE-002',
        summary: '错误变量未以 err 开头。',
        remediation: '将变量重命名为以 err 开头。',
    },
    'GOM-STYLE-003': {
        name: 'GOM-STYLE-003',
        summary: '导出包注释或包命名不符合规范。',
        remediation: '添加规范包注释或修正包名。',
    },
    'MOD-EXP-001': {
        name: '避免无序通配导出',
        summary: '检测到大量未受保护的通配符导出（export *），可能引发符号污染与树摇失效。',
        remediation: '改用显式命名导出（Named Exports），明确暴露公开 API 边界。',
        rationale: '通配导出容易导致命名冲突、破坏模块边界封装并增加最终打包产物膨胀体积。',
    },
    'PS-ALIAS-001': {
        name: 'PS-ALIAS-001',
        summary: 'PowerShell 脚本使用了不推荐的命令别名。',
        remediation: '替换为规范的 Cmdlet 全称。',
    },
    'PS-CMDLET-001': {
        name: 'PS-CMDLET-001',
        summary: '函数命名不符合 Verb-Noun 动名词规范。',
        remediation: '使用标准审批动词与名词重构函数名。',
    },
    'PS-ERROR-001': {
        name: 'PS-ERROR-001',
        summary: 'PowerShell 中存在空 catch 或未捕获的错误。',
        remediation: '补充错误捕获处理与告警日志。',
    },
    'PS-PARAM-001': {
        name: 'PS-PARAM-001',
        summary: '参数块缺失 [CmdletBinding()] 或参数未声明强类型。',
        remediation: '添加 [CmdletBinding()] 并为参数声明类型。',
    },
    'PS-VERB-001': {
        name: 'PS-VERB-001',
        summary: '使用了未批准的 PowerShell 动词。',
        remediation: '改用 Get-Verb 批准的标准动词。',
    },
    'PYM-ABC-001': {
        name: 'PYM-ABC-001',
        summary: '从 typing 导入 collections.abc 抽象类型。',
        remediation: '改从 collections.abc 导入。',
    },
    'PYM-ASYNC-001': {
        name: 'PYM-ASYNC-001',
        summary: 'async 函数内阻塞调用或未 await 的同步 ORM 调用。',
        remediation: '改用 async 等价物（asyncio/httpx/异步仓储）。',
    },
    'PYM-DATETIME-001': {
        name: 'PYM-DATETIME-001',
        summary: 'timezone.utc 用法。',
        remediation: '改用 datetime.UTC（PEP 615）。',
    },
    'PYM-DEFAULT-001': {
        name: 'PYM-DEFAULT-001',
        summary: '可变默认参数（=[]/={}/=set()）。',
        remediation: '改用 None 哨兵，在函数体内构造。',
    },
    'PYM-FSTRING-001': {
        name: 'PYM-FSTRING-001',
        summary: '% 格式化字符串。',
        remediation: '改写为 f-string。',
    },
    'PYM-GENERIC-001': {
        name: 'PYM-GENERIC-001',
        summary: '旧式容器泛型 List/Dict/Set/Tuple/Type[...]。',
        remediation: '改用内置泛型 list[...] 等（PEP 585）。',
    },
    'PYM-IMPORT-001': {
        name: 'PYM-IMPORT-001',
        summary: '模块级 import 未按三段式分组或段内未按字典序（函数内惰性导入不参与）。',
        remediation: '按 PEP 8 分组并段内排序。',
    },
    'PYM-OPEN-001': {
        name: 'PYM-OPEN-001',
        summary: 'open() 未处于 with 块内。',
        remediation: '包进 with open(...) as handle:。',
    },
    'PYM-PATH-001': {
        name: 'PYM-PATH-001',
        summary: 'os.path 用法。',
        remediation: '迁移到 pathlib.Path（Path(...) / name）。',
    },
    'PYM-RAISE-001': {
        name: 'PYM-RAISE-001',
        summary: 'except 块内 raise X 缺少 from，异常链丢失。',
        remediation: '写 raise X from exc，或裸 raise 原样上抛。',
    },
    'PYM-SHADOW-001': {
        name: 'PYM-SHADOW-001',
        summary: '变量或参数遮蔽了 Python 核心内置标识符。',
        remediation: '重命名变量以避免与内置函数或类型发生命名冲突。',
    },
    'PYM-SLOTS-001': {
        name: 'PYM-SLOTS-001',
        summary: '无继承的 @dataclass 未声明 slots=True。',
        remediation: '加 slots=True；确需 __dict__ 时显式 slots=False。',
    },
    'PYM-UNION-001': {
        name: 'PYM-UNION-001',
        summary: '注解或类型别名位置使用 Optional[...]/Union[...]。',
        remediation: '改用 PEP 604 写法 X | None。',
    },
    'RSM-CLONE-001': {
        name: 'RSM-CLONE-001',
        summary: 'clone() 结果只用于比较或取长度。',
        remediation: '改为借用比较，避免不可见复制。',
    },
    'RSM-EXTERN-001': {
        name: 'RSM-EXTERN-001',
        summary: '使用 extern crate 声明。',
        remediation: '2018 edition 起删除，直接按路径 use 依赖。',
    },
    'RSM-FORMAT-001': {
        name: 'RSM-FORMAT-001',
        summary: '格式化宏使用位置参数 {}。',
        remediation: '改用内联捕获 "{value}"，由编译器校验名称。',
    },
    'RSM-MACRO-001': {
        name: 'RSM-MACRO-001',
        summary: '使用 #[macro_use] 文本导入宏。',
        remediation: '显式 use 目标宏，保留可追溯来源。',
    },
    'RSM-STR-001': {
        name: 'RSM-STR-001',
        summary: '签名使用 &String 参数。',
        remediation: '改用 &str（或 impl AsRef<str>）。',
    },
    'RSM-TRY-001': {
        name: 'RSM-TRY-001',
        summary: '使用 try! 宏。',
        remediation: '改用 ? 运算符，可嵌入更大的表达式。',
    },
    'RSM-UNWRAP-001': {
        name: 'RSM-UNWRAP-001',
        summary: '对可失败结果调用 unwrap()。',
        remediation: '改用 ? 传播，或用 expect 说明不变式。',
    },
    'SH-ARRAY-001': {
        name: 'SH-ARRAY-001',
        summary: '使用 $* 代替了 "$@" 导致单词分割失效。',
        remediation: '使用 "$@" 保持各个位置参数的独立性。',
    },
    'SH-CMD-001': {
        name: 'SH-CMD-001',
        summary: '使用了已过时的反引号命令替换语法。',
        remediation: '改用现代标准的 $(...) 命令替换语法。',
    },
    'SH-DEPR-001': {
        name: 'SH-DEPR-001',
        summary: '使用了单中括号 [ 或旧式废弃测试语法。',
        remediation: '在 Bash 脚本中改用现代标准的 [[ 测试语法。',
    },
    'SH-ECHO-001': {
        name: 'SH-ECHO-001',
        summary: '使用了不可移植的 echo -e / echo -n。',
        remediation: '改用 POSIX 标准统一的 printf 命令。',
    },
    'SH-ERR-001': {
        name: 'SH-ERR-001',
        summary: '关键命令执行后未进行错误退出码判定。',
        remediation: '通过 || exit 或 set -e 强化错误退出机制。',
    },
    'SH-INIT-001': {
        name: 'SH-INIT-001',
        summary: 'Shell 脚本头部未声明 set -euo pipefail 严格模式。',
        remediation: '在脚本开头声明 set -euo pipefail 提升鲁棒性。',
    },
    'SH-QUOTE-001': {
        name: 'SH-QUOTE-001',
        summary: '参数展开未加双引号保护存在单词拆分与通配隐患。',
        remediation: '对变量引用使用 "$var" 进行双引号保护。',
    },
    'SH-READ-001': {
        name: 'SH-READ-001',
        summary: 'read 命令未携带 -r 参数导致反斜杠被转义篡改。',
        remediation: '使用 read -r 读取原始输入文本。',
    },
    'TSM-ANY-001': {
        name: 'TSM-ANY-001',
        summary: '显式 any 关闭了该值的类型检查。',
        remediation: '改用 unknown 加收窄，或精确的泛型/联合类型。',
    },
    'TSM-ARGS-001': {
        name: 'TSM-ARGS-001',
        summary: '使用 arguments 对象。',
        remediation: '改用剩余参数（...args），可被类型系统检查。',
    },
    'TSM-CTOR-001': {
        name: 'TSM-CTOR-001',
        summary: '用 new 调用 Array/Object/String/Number/Boolean 包装构造器。',
        remediation: '改用字面量或 String()/Number()/Boolean() 原始转换。',
    },
    'TSM-DISP-001': {
        name: 'TSM-DISP-001',
        summary: 'VS Code 监听器或 Disposable 对象未注册至 subscriptions 容器。',
        remediation:
            '使用 context.subscriptions.push(...) 或生命周期容器管理 Disposable 以防泄露。',
    },
    'TSM-INCLUDES-001': {
        name: 'TSM-INCLUDES-001',
        summary: 'indexOf 与 -1/0 比较来判断成员存在。',
        remediation: '改用 includes(value)。',
    },
    'TSM-REPLACE-001': {
        name: 'TSM-REPLACE-001',
        summary: '字符串模式 replace 只替换首个匹配。',
        remediation: '需要全量替换时改用 replaceAll。',
    },
    'TSM-REQUIRE-001': {
        name: 'TSM-REQUIRE-001',
        summary: 'ESM 模块内混用 CommonJS require() 调用。',
        remediation: '改为 import 绑定，保持单一模块体系。',
    },
    'TSM-SPREAD-001': {
        name: 'TSM-SPREAD-001',
        summary: '用 Object.assign({}, …) 做浅合并。',
        remediation: '改用对象展开 { ...source }。',
    },
    'TSM-SUBSTR-001': {
        name: 'TSM-SUBSTR-001',
        summary: '使用已弃用的 String.prototype.substr。',
        remediation: '改用 slice(start, start + length)。',
    },
    'TSM-TYPE-001': {
        name: 'TSM-TYPE-001',
        summary: '具名导入仅用于类型位置。',
        remediation: '改为 import type { … }，让绑定在编译期被擦除。',
    },
    'TSM-VAR-001': {
        name: 'TSM-VAR-001',
        summary: '使用 var 声明（函数作用域、存在变量提升）。',
        remediation: '改用 const；需要重新赋值时用 let。',
    },
    'TYP-ANY-001': {
        name: '避免隐式或裸 any 类型逃逸',
        summary: '检测到裸 any 或未约束的类型断言，破坏了 TypeScript 静态类型推导契约。',
        remediation: '使用具体接口、联合类型、泛型或 unknown 配合类型守卫（Type Guard）替代 any。',
        rationale: 'any 逃逸将导致静态类型编译器防护失效，使得运行时类型错误无法在编译期被拦截。',
    },
    'VSC-I18N-001': {
        name: 'VSC-I18N-001',
        summary: '用户可见消息使用硬编码字符串字面量未接入国际化字典。',
        remediation: '使用 vscode.l10n.t(...) 或双语字典常量进行包装。',
    },
    'VSC-MEM-001': {
        name: 'VSC-MEM-001',
        summary: 'VS Code Disposable 资源创建后未压入 context.subscriptions。',
        remediation: '使用 context.subscriptions.push(...) 注册或纳入复合 Disposable 管理。',
    },
    'VSC-PERF-001': {
        name: 'VSC-PERF-001',
        summary: '在 Extension Host 主线程执行同步文件 I/O 阻塞编辑器 UI。',
        remediation: '改用 fs.promises 或 vscode.workspace.fs 异步 I/O 接口。',
    },
    'analyzer-error': {
        name: 'analyzer-error',
        summary: '分析器在单文件上抛异常（failOnAnalyzerError 可升为 error）。',
        remediation: '修复分析器缺陷；已知外部数据问题可保持 info 留痕。',
    },
};
