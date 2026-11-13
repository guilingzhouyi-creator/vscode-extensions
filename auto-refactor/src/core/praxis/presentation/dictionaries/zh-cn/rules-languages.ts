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
    'GDM-BAR-001': {
        name: '表现层直接操作裸进度条破坏状态条规范',
        summary: '表现层直接离散操作裸 ProgressBar 实例，破坏 KStatusBar 标准交互与平滑动画规范。',
        remediation: '改用 KStatusBar 标准化组件，统一进度条生命周期、平滑补间动效与样式契约。',
    },
    'GDM-BND-001': {
        name: '表现层视图直接耦合领域单例或总线事件',
        summary: '表现层视图直接耦合后端领域单例或跨层订阅 EventBus 全局业务事件。',
        remediation:
            '表现层仅通过 BaseScreen.apply_snapshot() 单向接收数据，用户操作经由显式回调或 UI 意图派发。',
    },
    'GDM-CONNECT-001': {
        name: '使用旧版 Godot 3 字符串方法名信号连接',
        summary: '使用 Godot 3 connect 签名（方法名以字符串传入）。',
        remediation: '改用信号 connect(Callable) 形式。',
    },
    'GDM-DEB-001': {
        name: '高频交互按钮裸连信号缺少防抖与锁控',
        summary: '高频业务按钮裸连信号，缺少防抖机制或 loading 状态互斥控制。',
        remediation: '改用 KButton 原子组件或接入 debounced_pressed 信号以防连击重复提交。',
    },
    'GDM-EXPORT-001': {
        name: '使用旧版 Godot 3 export 导出语法',
        summary: '使用 Godot 3 的 export 语句。',
        remediation: '改用 @export 注解并保留类型声明。',
    },
    'GDM-EXT-001': {
        name: '主视图控制器未继承标准屏幕或弹窗基类',
        summary: '表现层主视图控制器未继承 BaseScreen 或 BaseModal 基类。',
        remediation:
            '主视图控制器应继承 BaseScreen（全屏视图）或 BaseModal（模态弹窗），接入标准生命周期与快照装配契约。',
    },
    'GDM-FSM-001': {
        name: '直接篡改状态机私有变量绕过迁移守卫',
        summary: '有限状态机私有状态变量被就地直接赋值，破坏状态迁移守卫与进出钩子。',
        remediation: '必须通过 fsm.transition_to(target_state, payload) 方法触发合法状态流转。',
    },
    'GDM-I18N-001': {
        name: '表现层界面文本硬编码未绑定国际化键名',
        summary: '表现层 UI 文本未通过 UIIntermediary / 国际化键名绑定，存在裸字符串硬编码。',
        remediation: 'UI 文本必须采用 tr(KEY) 或通过 UIIntermediary 进行响应式国际化绑定。',
    },
    'GDM-ISO-001': {
        name: '无头领域逻辑层直接引用视图或场景节点',
        summary: '无头领域逻辑层直接引用视图层或场景树节点破坏解耦架构。',
        remediation: '领域逻辑与表现层解耦，通过数据快照或纯状态机通信。',
    },
    'GDM-LOC-001': {
        name: '表现层视图脚本物理行数超出体积上限',
        summary: '表现层视图脚本行数超出物理预算上限（LOC <= 450 行）。',
        remediation: '将复杂子组件、列表项渲染、数据转换器或伴生逻辑拆分为独立组件或伴生控制器。',
    },
    'GDM-NOD-001': {
        name: '视图脚本使用脆弱跨级相对节点查找路径',
        summary:
            '视图层脚本中出现飘移的相对节点路径（如 get_parent()、find_child() 或长跨级相对索引）。',
        remediation:
            '节点引用应使用显式 @onready %UniqueNode 或类型化依赖注入，禁止易脆弱的相对层级寻址。',
    },
    'GDM-ONREADY-001': {
        name: '使用旧版 Godot 3 onready 关键字',
        summary: '使用 onready 关键字。',
        remediation: '改用 @onready 注解。',
    },
    'GDM-POL-001': {
        name: '对象池实例取出后未实现或未重置状态',
        summary: '对象池获取后未实现或未调用 reset_state 契约。',
        remediation: '池化对象实现 reset_state() 并确保在 acquire/release 时重置状态。',
    },
    'GDM-POOL-001': {
        name: '使用旧版 Pool 数组类型未升级打包数组',
        summary: '使用 Pool*Array 类型。',
        remediation: '改用 Packed*Array 系列类型。',
    },
    'GDM-POOL-002': {
        name: '对象池重用脚本重置方法漏调基类清理',
        summary: '对象池 reset_state 未调用基类重置方法破坏契约。',
        remediation: '在 reset_state() 内部添加 super.reset_state() 调用以确保父类状态正确清理。',
    },
    'GDM-PRF-001': {
        name: '帧循环或高频路径瞬态堆分配引发掉帧',
        summary: '循环或高频执行路径中瞬态堆分配导致掉帧风险。',
        remediation: '在循环外预分配集合、使用对象池或复用缓冲区实例。',
    },
    'GDM-RES-001': {
        name: '界面脚本硬编码固定像素尺寸破坏响应式',
        summary: 'UI 布局脚本中硬编码固定分辨率或绝对像素尺寸，破坏多端响应式适配。',
        remediation: '改用 Anchors Preset 锚点系统、自适应容器或 DesignTokens 相对尺寸基准。',
    },
    'GDM-RPC-001': {
        name: '使用旧版 remote 等过时多人网络修饰符',
        summary: '使用 remote/master/puppet/slave 函数修饰符。',
        remediation: '改用 @rpc 注解。',
    },
    'GDM-SIG-001': {
        name: '动态信号连接缺少对称断开逻辑防泄漏',
        summary: '信号连接后缺少对应断开逻辑导致生命周期悬挂泄漏。',
        remediation: '在生命周期结束前调用 disconnect 或接入自动管理连接。',
    },
    'GDM-TOK-001': {
        name: '表现层硬编码裸色值破坏设计令牌真源',
        summary: '表现层视图硬编码 Color(...) 字面量或裸色值，破坏 DesignTokens 单一真源。',
        remediation:
            '从 DesignTokens 获取语义化色彩常量（如 DesignTokens.COLOR_*），确保主题与多端视觉统一。',
    },
    'GDM-TOOL-001': {
        name: '使用旧版无注解裸 tool 工具脚本修饰符',
        summary: '使用裸 tool 关键字。',
        remediation: '改用首行 @tool 注解。',
    },
    'GDM-UNI-001': {
        name: '视图层就地修改只读快照违背单向数据流',
        summary: '表现层视图就地修改只读 Snapshot DTO 属性，破坏 CQRS 单向数据流与单一真源。',
        remediation:
            '视图应将快照视为不可变只读数据，通过派发 Command 意图或调用领域边界服务请求变更。',
    },
    'GDM-VRT-001': {
        name: '长列表全量创建节点未接入虚拟滚动池',
        summary: '长列表场景全量就地实例化节点，未接入 KVirtualList 虚拟化滚动与对象池复用。',
        remediation:
            '长列表容器应接入 KVirtualList 配合对象池池化复用（ADV-POOL-001），禁止无界瞬态节点创建。',
    },
    'GDM-WEAK-001': {
        name: '观察者或管理器强持有节点未用弱引用',
        summary: '动态观察者或全局管理器强引用持有 Node 实例，未采用 weakref 防内存泄漏。',
        remediation: '使用 weakref(node) 包装动态注册对象并在派发时校验 get_ref() 是否存活。',
    },
    'GDM-YIELD-001': {
        name: '使用旧版 Godot 3 yield 协程语法',
        summary: '使用 Godot 3 的 yield 协程写法。',
        remediation: '改用 await 表达式。',
    },
    'GOM-CTX-001': {
        name: 'Go 函数未将 context 参数置为首形参',
        summary: 'context.Context 不是函数的首个形参。',
        remediation: '将 ctx context.Context 移动到第一个形参位置。',
    },
    'GOM-ERR-001': {
        name: 'Go 代码使用下划线静默丢弃错误返回值',
        summary: '使用 _ 静默丢弃错误返回值。',
        remediation: '显式检查错误或说明忽略理由。',
    },
    'GOM-STYLE-001': {
        name: 'Go 方法接收器命名偏离官方风格惯例',
        summary: '方法接收器命名不符合 Go 惯例。',
        remediation: '使用 1-2 字母短名且与类型保持一致。',
    },
    'GOM-STYLE-002': {
        name: 'Go 错误变量命名未遵循 err 前缀惯例',
        summary: '错误变量未以 err 开头。',
        remediation: '将变量重命名为以 err 开头。',
    },
    'GOM-STYLE-003': {
        name: 'Go 导出包注释或包名声明不符合规范',
        summary: '导出包注释或包命名不符合规范。',
        remediation: '添加规范包注释或修正包名。',
    },
    'PS-ALIAS-001': {
        name: 'PowerShell 脚本使用简写别名降低可读性',
        summary: 'PowerShell 脚本使用了不推荐的命令别名。',
        remediation: '替换为规范的 Cmdlet 全称。',
    },
    'PS-CMDLET-001': {
        name: 'PowerShell 函数名偏离动名词规范',
        summary: '函数命名不符合 Verb-Noun 动名词规范。',
        remediation: '使用标准审批动词与名词重构函数名。',
    },
    'PS-ERROR-001': {
        name: 'PowerShell 存在空异常捕获或未接管错误',
        summary: 'PowerShell 中存在空 catch 或未捕获的错误。',
        remediation: '补充错误捕获处理与告警日志。',
    },
    'PS-PARAM-001': {
        name: 'PowerShell 参数块缺 CmdletBinding 或强类型',
        summary: '参数块缺失 [CmdletBinding()] 或参数未声明强类型。',
        remediation: '添加 [CmdletBinding()] 并为参数声明类型。',
    },
    'PS-VERB-001': {
        name: 'PowerShell 函数使用未批准非标准动词',
        summary: '使用了未批准的 PowerShell 动词。',
        remediation: '改用 Get-Verb 批准的标准动词。',
    },
    'PYM-ABC-001': {
        name: '从 typing 导入已迁入 collections.abc 的抽象类',
        summary: '从 typing 导入 collections.abc 抽象类型。',
        remediation: '改从 collections.abc 导入。',
    },
    'PYM-ASYNC-001': {
        name: 'Python async 协程内包含阻塞调用',
        summary: 'async 函数内阻塞调用或未 await 的同步 ORM 调用。',
        remediation: '改用 async 等价物（asyncio/httpx/异步仓储）。',
    },
    'PYM-DATETIME-001': {
        name: 'Python 时间构造仍使用旧式 timezone.utc',
        summary: 'timezone.utc 用法。',
        remediation: '改用 datetime.UTC（PEP 615）。',
    },
    'PYM-DEFAULT-001': {
        name: 'Python 函数参数使用可变容器作为默认值',
        summary: '可变默认参数（=[]/={}/=set()）。',
        remediation: '改用 None 哨兵，在函数体内构造。',
    },
    'PYM-FSTRING-001': {
        name: 'Python 字符串拼接仍使用旧式百分号格式化',
        summary: '% 格式化字符串。',
        remediation: '改写为 f-string。',
    },
    'PYM-GENERIC-001': {
        name: 'Python 类型注解使用已过时大写容器泛型',
        summary: '旧式容器泛型 List/Dict/Set/Tuple/Type[...]。',
        remediation: '改用内置泛型 list[...] 等（PEP 585）。',
    },
    'PYM-IMPORT-001': {
        name: 'Python 顶层导入未按三段分组及字典序排列',
        summary: '模块级 import 未按三段式分组或段内未按字典序（函数内惰性导入不参与）。',
        remediation: '按 PEP 8 分组并段内排序。',
    },
    'PYM-OPEN-001': {
        name: 'Python open 文件句柄未包裹于 with 上下文',
        summary: 'open() 未处于 with 块内。',
        remediation: '包进 with open(...) as handle:。',
    },
    'PYM-PATH-001': {
        name: 'Python 路径操作未迁用现代 pathlib 对象',
        summary: 'os.path 用法。',
        remediation: '迁移到 pathlib.Path（Path(...) / name）。',
    },
    'PYM-RAISE-001': {
        name: 'Python except 块重抛异常缺少 from 保留链',
        summary: 'except 块内 raise X 缺少 from，异常链丢失。',
        remediation: '写 raise X from exc，或裸 raise 原样上抛。',
    },
    'PYM-SHADOW-001': {
        name: 'Python 变量或参数遮蔽内置核心标识符',
        summary: '变量或参数遮蔽了 Python 核心内置标识符。',
        remediation: '重命名变量以避免与内置函数或类型发生命名冲突。',
    },
    'PYM-SLOTS-001': {
        name: 'Python 独立 dataclass 缺少 slots=True 优化',
        summary: '无继承的 @dataclass 未声明 slots=True。',
        remediation: '加 slots=True；确需 __dict__ 时显式 slots=False。',
    },
    'PYM-UNION-001': {
        name: 'Python 类型位置仍使用旧式 Optional 或 Union',
        summary: '注解或类型别名位置使用 Optional[...]/Union[...]。',
        remediation: '改用 PEP 604 写法 X | None。',
    },
    'RSM-CLONE-001': {
        name: 'Rust 无谓 clone 调用结果仅用于比较或测长',
        summary: 'clone() 结果只用于比较或取长度。',
        remediation: '改为借用比较，避免不可见复制。',
    },
    'RSM-EXTERN-001': {
        name: 'Rust 2018+ 版式仍使用过时 extern crate',
        summary: '使用 extern crate 声明。',
        remediation: '2018 edition 起删除，直接按路径 use 依赖。',
    },
    'RSM-FORMAT-001': {
        name: 'Rust 格式化宏未使用内联命名占位参数',
        summary: '格式化宏使用位置参数 {}。',
        remediation: '改用内联捕获 "{value}"，由编译器校验名称。',
    },
    'RSM-MACRO-001': {
        name: 'Rust 使用过时 #[macro_use] 属性导入宏',
        summary: '使用 #[macro_use] 文本导入宏。',
        remediation: '显式 use 目标宏，保留可追溯来源。',
    },
    'RSM-STR-001': {
        name: 'Rust 函数形参使用 &String 限制切片灵活性',
        summary: '签名使用 &String 参数。',
        remediation: '改用 &str（或 impl AsRef<str>）。',
    },
    'RSM-TRY-001': {
        name: 'Rust 代码仍使用已淘汰的 try! 错误传播宏',
        summary: '使用 try! 宏。',
        remediation: '改用 ? 运算符，可嵌入更大的表达式。',
    },
    'RSM-UNWRAP-001': {
        name: 'Rust 对可失败结果直接调用 unwrap 引发崩溃',
        summary: '对可失败结果调用 unwrap()。',
        remediation: '改用 ? 传播，或用 expect 说明不变式。',
    },
    'SH-ARRAY-001': {
        name: 'Shell 参数展开使用 $* 破坏引号分词边界',
        summary: '使用 $* 代替了 "$@" 导致单词分割失效。',
        remediation: '使用 "$@" 保持各个位置参数的独立性。',
    },
    'SH-CMD-001': {
        name: 'Shell 脚本使用已过时的反引号命令替换',
        summary: '使用了已过时的反引号命令替换语法。',
        remediation: '改用现代标准的 $(...) 命令替换语法。',
    },
    'SH-DEPR-001': {
        name: 'Shell 使用单中括号或废弃条件测试写法',
        summary: '使用了单中括号 [ 或旧式废弃测试语法。',
        remediation: '在 Bash 脚本中改用现代标准的 [[ 测试语法。',
    },
    'SH-ECHO-001': {
        name: 'Shell 使用不可移植 echo -e 或 -n 选项',
        summary: '使用了不可移植的 echo -e / echo -n。',
        remediation: '改用 POSIX 标准统一的 printf 命令。',
    },
    'SH-ERR-001': {
        name: 'Shell 关键命令执行后缺少退出码判定',
        summary: '关键命令执行后未进行错误退出码判定。',
        remediation: '通过 || exit 或 set -e 强化错误退出机制。',
    },
    'SH-INIT-001': {
        name: 'Shell 脚本头部缺少严格失败退出声明',
        summary: 'Shell 脚本头部未声明 set -euo pipefail 严格模式。',
        remediation: '在脚本开头声明 set -euo pipefail 提升鲁棒性。',
    },
    'SH-QUOTE-001': {
        name: 'Shell 变量展开未加双引号防分词通配隐患',
        summary: '参数展开未加双引号保护存在单词拆分与通配隐患。',
        remediation: '对变量引用使用 "$var" 进行双引号保护。',
    },
    'SH-READ-001': {
        name: 'Shell read 命令漏加 -r 选项导致反斜杠转义',
        summary: 'read 命令未携带 -r 参数导致反斜杠被转义篡改。',
        remediation: '使用 read -r 读取原始输入文本。',
    },
    'TSM-ANY-001': {
        name: 'TS 代码使用显式 any 关闭静态类型防线',
        summary: '显式 any 关闭了该值的类型检查。',
        remediation: '改用 unknown 加收窄，或精确的泛型/联合类型。',
    },
    'TSM-ARGS-001': {
        name: 'JS/TS 使用旧式动态 arguments 对象替代剩余参数',
        summary: '使用 arguments 对象。',
        remediation: '改用剩余参数（...args），可被类型系统检查。',
    },
    'TSM-CTOR-001': {
        name: '使用 new 调用基础包装类构造器创建实例',
        summary: '用 new 调用 Array/Object/String/Number/Boolean 包装构造器。',
        remediation: '改用字面量或 String()/Number()/Boolean() 原始转换。',
    },
    'TSM-DISP-001': {
        name: 'VS Code 监听器资源未挂载到订阅容器释放',
        summary: 'VS Code 监听器或 Disposable 对象未注册至 subscriptions 容器。',
        remediation:
            '使用 context.subscriptions.push(...) 或生命周期容器管理 Disposable 以防泄露。',
    },
    'TSM-INCLUDES-001': {
        name: '使用 indexOf 负一比对替代 includes 存在判定',
        summary: 'indexOf 与 -1/0 比较来判断成员存在。',
        remediation: '改用 includes(value)。',
    },
    'TSM-REPLACE-001': {
        name: '字符串 replace 误用于预期全量替换场景',
        summary: '字符串模式 replace 只替换首个匹配。',
        remediation: '需要全量替换时改用 replaceAll。',
    },
    'TSM-REQUIRE-001': {
        name: 'ESM 模块内混用 CommonJS require 导入调用',
        summary: 'ESM 模块内混用 CommonJS require() 调用。',
        remediation: '改为 import 绑定，保持单一模块体系。',
    },
    'TSM-SPREAD-001': {
        name: '使用 Object.assign 浅拷贝合并替代对象展开',
        summary: '用 Object.assign({}, …) 做浅合并。',
        remediation: '改用对象展开 { ...source }。',
    },
    'TSM-SUBSTR-001': {
        name: '调用已废弃的字符串 substr 切片方法',
        summary: '使用已弃用的 String.prototype.substr。',
        remediation: '改用 slice(start, start + length)。',
    },
    'TSM-TYPE-001': {
        name: '仅用于类型标注的具名导入未标注 import type',
        summary: '具名导入仅用于类型位置。',
        remediation: '改为 import type { … }，让绑定在编译期被擦除。',
    },
    'TSM-VAR-001': {
        name: 'TS/JS 使用存在变量提升隐患的 var 声明',
        summary: '使用 var 声明（函数作用域、存在变量提升）。',
        remediation: '改用 const；需要重新赋值时用 let。',
    },
    'VSC-I18N-001': {
        name: 'VS Code 界面消息硬编码未接入双语字典',
        summary: '用户可见消息使用硬编码字符串字面量未接入国际化字典。',
        remediation: '使用 vscode.l10n.t(...) 或双语字典常量进行包装。',
    },
    'VSC-MEM-001': {
        name: 'VS Code 扩展创建 Disposable 未纳入销毁订阅',
        summary: 'VS Code Disposable 资源创建后未压入 context.subscriptions。',
        remediation: '使用 context.subscriptions.push(...) 注册或纳入复合 Disposable 管理。',
    },
    'VSC-PERF-001': {
        name: 'VS Code 扩展宿主主线程调用同步阻塞 I/O',
        summary: '在 Extension Host 主线程执行同步文件 I/O 阻塞编辑器 UI。',
        remediation: '改用 fs.promises 或 vscode.workspace.fs 异步 I/O 接口。',
    },
    'analyzer-error': {
        name: '单文件分析器内部抛出未预期执行异常',
        summary: '分析器在单文件上抛异常（failOnAnalyzerError 可升为 error）。',
        remediation: '修复分析器缺陷；已知外部数据问题可保持 info 留痕。',
    },
    'hardcoded-string': {
        name: '源码中存在硬编码字符串字面量',
        summary: '业务逻辑或配置中包含未抽取的硬编码字符串字面量。',
        remediation: '将重复或业务关键字符串提取为命名常量或本地化字典。',
    },
    'magic-number': {
        name: '源码中存在未解释的魔数数字字面量',
        summary: '业务逻辑中包含未声明常量名称的数值字面量。',
        remediation: '将魔数提升为自解释的语义常量或枚举类型。',
    },
};
