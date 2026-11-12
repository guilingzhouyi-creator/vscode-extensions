/**
 * Module: Core Engine - Praxis Presentation Chinese Structural Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-structural.ts
 * Architecture Role: Chinese localization table for Structural, Dependency, Rust, and Test rules.
 * Dependencies & Triggers: Consumed by zh-cn.ts barrel and PraxisI18nProvider.
 * Responsibilities: Export localized descriptors for structural, dependency, Rust, test rules.
 * Exit Semantics & Design Rationale: Pure immutable constant lookup map with zero runtime deps.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 架构结构、依赖治理、Rust 工程实践与测试断言领域规则中文本地化字典。
 */
export const ZH_CN_STRUCTURAL_RULES: Record<string, PraxisRuleI18nEntry> = {
    'ARCH-FAC-001': {
        name: '门面模块载荷空洞与实质密度不足',
        summary: '门面模块缺少领域编排、入参校验、错误转换或不可变冻结契约，沦为空壳中转。',
        remediation:
            '注入实质领域装配与 Object.freeze 冻结契约，或直接撤销薄层门面改由调用方直连。',
    },
    'ARCH-PLM-001': {
        name: '模块布线开销占比过重',
        summary: '重导出与单行转发等胶水代码主导了模块文件体积，核心领域逻辑载荷严重稀释。',
        remediation: '消融不足三行的纯转发跳板，将简单适配器内联并重组精简导出边界。',
    },
    'CMT-HDR-004': {
        name: '文件六字段契约头位置错位',
        summary: '模块顶层六字段 JSDoc 注释块未置于非指令性代码与导入语句之前，影响自动解析提取。',
        remediation: '将六字段模块头整体前移至文件首部，仅允许置于 Shebang 或编码声明行之后。',
    },
    'CONST-LAY-002': {
        name: '类型与契约声明未先置于核心业务逻辑',
        summary: '核心函数与业务类定义先于内部类型接口与常量契约声明，破坏自顶向下的阅读序。',
        remediation: '将公共 type、interface 与常量契约提取置顶，排布于运算函数与实现类之前。',
    },
    'CPX-TRV-001': {
        name: '无状态实质变更的空转循环遍历',
        summary: '循环体未产生有效的累加、状态变更或短路收益，存在冗余迭代空转损耗。',
        remediation: '消除冗余遍历循环，改用直接索引访问、集合切片或数学恒等公式计算。',
    },
    'DEP-DEV-001': {
        name: '生产源码直接引用仅开发态依赖包',
        summary: '生产模块导入了仅声明于 devDependencies 的构建测试包且未使用纯类型导入限域。',
        remediation: '将运行期必需包升迁至 dependencies，或改用 import type 消除运行期模块引入。',
    },
    'DEP-LIC-001': {
        name: '引入高传染性强著佐权开源协议依赖',
        summary: '工程中直接依赖 AGPL 或 GPL 等传染性限制协议第三方库，存在合规传染风险。',
        remediation: '替换为 MIT、Apache-2.0 或 BSD 等宽松许可替代库，或严格隔离在网络进程边界外。',
    },
    'DEP-OBS-001': {
        name: '引用已废弃或停止维护的第三方依赖',
        summary: '代码直接引入官方已停止维护或已被语言标准运行时内置接口全面取代的历史包。',
        remediation:
            '迁移至活跃维护替代库，或直接切换至运行时原生能力（如内置 fetch 与 Web Crypto）。',
    },
    'DEP-ORD-002': {
        name: '顶层模块导入语句混插于声明逻辑之后',
        summary: '模块顶级 import 语句出现在类型契约、常量或函数体声明之后，打破静态导入聚集序。',
        remediation: '将分散在文件下方的顶层 import 语句统一收拢至模块首部导入区。',
    },
    'DEP-PHANTOM-001': {
        name: '源码引入未在清单声明的幽灵依赖',
        summary: '源码直接导入未写入当前包清单（package.json 或 Cargo.toml）的外部传递依赖。',
        remediation: '在当前项目依赖清单显式声明该依赖版本，或使用已声明的基础标准能力替代。',
    },
    'DEP-PIN-001': {
        name: '项目依赖清单声明浮动通配版本号',
        summary: '依赖清单使用通配符、latest 或无上界开放区间声明版本，破坏跨环境构建可重复性。',
        remediation: '将依赖版本锁定至明确语义版本或受控兼容范围（如 ^x.y.z），禁用无界通配。',
    },
    'DEP-VULN-001': {
        name: '引用供应链高危或已知受损恶意依赖',
        summary: '依赖完整性库检出存在严重远端执行漏洞或已被投毒劫持的第三方包版本。',
        remediation: '立即卸除受影响版本，升级至经过校验的安全发布版本并重新校验锁文件完整性。',
    },
    'ERR-FLT-001': {
        name: '异步调用未处理悬空 Promise 返回值',
        summary: '调用返回 Promise 的异步操作既未 await、return 也未显式绑定 .catch 捕获异常。',
        remediation: '根据并发语义补全 await、结果返回或显式异常捕手，避免未捕获拒绝导致进程崩溃。',
    },
    'ERR-MSG-001': {
        name: '异常抛出消息缺少可定位诊断上下文',
        summary: '构造并抛出的异常文案过于空泛，缺少触发原因、预期契约与实际状态快照信息。',
        remediation: '按预期值、实际值及建议修正路径三要素重写错误描述，提升故障自愈可观测性。',
    },
    'MOD-BWD-001': {
        name: '残留过时向后兼容垫片与旧别名透传',
        summary: '代码内部长期堆叠废弃兼容垫片、过时参数透传层或仅作别名转接的冗余桥梁。',
        remediation: '前向演进统一迁移调用方至现代规范接口，并清理已失去迁移价值的旧兼容垫片。',
    },
    'MOD-DEP-001': {
        name: '生产代码中调用已标记废弃的内部符号',
        summary: '内部源码仍在访问带有 @deprecated 注解的陈旧函数、字段或配置键，阻碍演进清理。',
        remediation: '遵循废弃注释给出的现代替代指向完成全量调用侧迁移改造。',
    },
    'MOD-FLB-001': {
        name: '非边界源码存在多代冗余降级兜底链',
        summary: '核心域内部代码保留冗长的多代旧配置回退链条，破坏单源语义一致性并遮蔽异常。',
        remediation: '将历史格式归一仅收敛于最外层边界适配器，核心域内直接消费唯一规范结构。',
    },
    'NAM-ABR-001': {
        name: '标识符命名采用晦涩非标准截断缩写',
        summary: '变量或符号名称包含难以直读的私造首字母缩写或任意截取词根，削弱领域语义表达。',
        remediation: '展开为完整准确的标准英文领域术语，仅保留业内广泛公认的标准缩写词。',
    },
    'NAM-LEN-001': {
        name: '变量命名长度突破合理认知区间',
        summary: '变量标识符过短成为无语义单字母，或冗长成句式命名导致表达式横向膨胀失衡。',
        remediation: '选用长度适中、直指数据语义职责的精炼名词短语，避免过度缩写或句式化命名。',
    },
    'NAM-LEN-002': {
        name: '函数或方法标识符过于简短缺乏语义',
        summary: '方法命名长度不足以揭示其操作对象与产生副作用，降低跨文件跳转辨识效率。',
        remediation: '采用动宾结构精确命名函数职责与结果语义，令调用处无需跳转即可理解行为。',
    },
    'NUM-BND-001': {
        name: '单向无边界校验的数值上限或深度限制',
        summary: '循环次数、递归深度或容量限制仅做单侧校验且未阻断 NaN/Infinity 或负值绕过。',
        remediation:
            '增加 Number.isFinite 校验并实施上下双侧双向区间钳位 clamp，防止溢出或死循环。',
    },
    'RSM-CAST-001': {
        name: 'Rust 生产代码使用裸数值 as 强转',
        summary: '直接对整数或位宽敏感类型使用 as 强转可能在溢出时触发静默截断与符号翻转。',
        remediation: '改用 TryFrom、try_into 或显式饱和/检查算术方法确保转换失败时可感知处理。',
    },
    'RSM-ELSE-001': {
        name: 'Rust 单分支早退可收敛为 let-else 语法',
        summary: '使用 if let ... else { return/break; } 绑定变量增加了非必要嵌套缩进层级。',
        remediation: '重构为简洁平铺的 let ... else 发散早退语法，保持主干逻辑处于最低嵌套深度。',
    },
    'RSM-EXP-001': {
        name: 'Rust 生产路径直接调用 expect 存在崩溃风险',
        summary: '生产逻辑中未经类型化错误提升直接使用 .expect()，遇到异常状态时将触发进程 Panic。',
        remediation: '使用 ? 运算符结合 map_err 或 thiserror 错误上下文向下传播，维持零崩溃契约。',
    },
    'RSM-FIND-001': {
        name: 'Rust 手写循环遍历查找提前返回',
        summary: '手动编写带早退分支的 for 循环执行元素查找或条件判定，代码冗长且可优化性弱。',
        remediation: '改用标准库迭代器原语 find、any 或 position，兼顾边界消除优化与表达简洁性。',
    },
    'RSM-LOCK-001': {
        name: '异步函数中跨越 .await 持有同步互斥锁',
        summary: '在 async 上下文中将 std::sync 锁守卫跨挂起点持有，极易引发执行器线程饥饿或死锁。',
        remediation: '通过独立作用域提前释放同步锁守卫，或在跨 await 临界区切换至异步感知锁。',
    },
    'RSM-PNC-001': {
        name: 'Rust 生产代码包含裸进程崩溃宏调用',
        summary:
            '生产模块调用 panic!、todo!、unimplemented! 或 unreachable!，会强行中止宿主运行进程。',
        remediation: '全面返回强类型 Result 错误枚举由上层可控处理，彻底消除生产代码运行期崩溃点。',
    },
    'RSM-SAF-001': {
        name: 'Rust unsafe 块缺少 // SAFETY: 不变量证明',
        summary: '不安全代码块或 unsafe 函数声明之前未附带规范的前置安全不变量验证注释契约。',
        remediation:
            '在每处 unsafe 紧邻上方补全四要素 // SAFETY: 注释，严格论证内存与生命周期合法性。',
    },
    'SIM-ARGS-001': {
        name: '函数签名位置参数个数超过阈值 (> 4)',
        summary: '函数声明超过 4 个位置参数，调用端极易出现传参顺序错位且难以为可选维度扩展。',
        remediation: '将关联形参归组收口为具备清晰字段名的配置参数对象或只读选项接口。',
    },
    'SIM-ARGS-002': {
        name: '公开求解器或处理器声明零参数隐式耦合',
        summary: '公开状态求解器、事件监听器或处理器未声明任何输入参数，隐式读取模块可变全局态。',
        remediation: '显式传入只读上下文快照或负载数据结构参数，彻底解耦模块级隐藏状态依赖。',
    },
    'SIM-INL-001': {
        name: '高相似度单用微型辅助函数过度碎片化',
        summary: '仅被单处调用且逻辑与父函数高度同源的微小辅助函数增加了不必要的跨符号跳转成本。',
        remediation: '将微型一次性碎片内联回唯一调用处内部，提升局部代码内聚度与空间局部性。',
    },
    'TST-ORC-001': {
        name: '测试断言依赖脆弱精确数值幻数神谕',
        summary: '测试直接对浮点数标量或易演进实体总数执行严格精确相等断言，演进时极易脆弱失效。',
        remediation:
            '迁移至基于物理属性守恒、浮点包络走廊 assertWithinCorridor 或动态比例基线断言。',
    },
};
