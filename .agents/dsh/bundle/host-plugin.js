/**
 * Module: Workspace Path Jail
 * File Path: .agents/dsh/bundle/host-plugin.js
 * Architecture Role: 治理模式族的 Host 插件本体。把工作区治理公理「SubAgent 严禁触碰授权路径之外的文件」
 *   从提示词层承诺升级为运行时执行点，由四个 Agent Preset 各自的声明行挂载。
 * Dependencies & Triggers: 依赖宿主 `tools` 注册表服务（经 preset 挂载域解析）与 `agentPresets` 注册表
 *   （按调用方 Agent 的 ctx 反查其预设身份）。挂载时注册一个单调 ToolGuard；该守卫在
 *   `tools/pre-execute` waterfall 之后、工具派发之前执行。
 * Responsibilities: 按调用方 Agent 的预设身份解析姿态策略；归一化工作区相对路径；拒绝命中禁用工具、
 *   读姿态下的写类工具、禁止根与授权面之外的目标，并以结构化原因字符串给出被拒路径与规则名。
 * Exit Semantics & Design Rationale: 拒绝只以「返回原因字符串」表达，这是 ToolGuard 契约的全部通道。
 *   姿态必须按调用方解析而非按注册域解析：同一 bundle 的四个声明行由同一个进程级注册表服务持有，
 *   按注册域区分的姿态会让某个模式的只读姿态泄漏到其他模式的会话（实测 wg-construct 的授权路径写入
 *   曾被读姿态拒绝）；按调用方解析后，四种模式的判定与挂载顺序、注册域归属均无关，且未登记预设放行。
 *   守卫对自身缺陷采取 fail-open（告警一次后放行），因为宿主沙箱仍是外层边界，且此处缺陷绝不能让会话变砖。
 *   判定次序为 deny 优先于 allow：禁止根压过授权列表，使重叠配置不会被误读为授权。
 */

export const name = 'wg-path-jail'
export const inject = ['tools']

/** 代码代际标记：写入拒绝文案，用于在真实会话中判定运行态加载的是哪一代模块。 */
const GUARD_GENERATION = 'caller-resolved-2'

const WRITE_TOOL_NAMES = Object.freeze([
  'write',
  'edit',
  'str_replace_editor',
  'notebook_edit',
])

const PATH_ARGUMENT_NAMES = Object.freeze([
  'file_path',
  'path',
  'notebook_path',
  'target_path',
])

const MODE_WRITE = 'write'
const MODE_READ = 'read'

function normalizeSlashes(value) {
  return String(value).replace(/\\/gu, '/')
}

function stripDotPrefix(value) {
  let result = value
  while (result.startsWith('./')) result = result.slice(2)
  return result
}

function trimTrailingSlash(value) {
  let result = value
  while (result.length > 1 && result.endsWith('/')) result = result.slice(0, -1)
  return result
}

function stripLeadingSlash(value) {
  let result = value
  while (result.startsWith('/')) result = result.slice(1)
  return result
}

function stripDrivePrefix(value) {
  return value.replace(/^[a-zA-Z]:/u, '')
}

function dropEmptySegments(segments) {
  return segments.filter((segment) => segment.length > 0 && segment !== '.')
}

function joinParentSegment(prefix, segment) {
  if (segment !== '..') return `${prefix}${segment}/`
  const segments = dropEmptySegments(prefix.split('/'))
  if (segments.length === 0) return ''
  return `${segments.slice(0, -1).join('/')}/`
}

function resolveDotSegments(segments) {
  let result = ''
  for (const segment of segments) result = joinParentSegment(result, segment)
  return result
}

function normalizeRelativePath(rawPath) {
  const slashed = stripDrivePrefix(stripLeadingSlash(stripDotPrefix(normalizeSlashes(rawPath))))
  return trimTrailingSlash(resolveDotSegments(slashed.split('/')))
}

const POLICY_TABLE = Object.freeze({
  'wg-construct': Object.freeze({
    mode: MODE_WRITE,
    allowRoots: Object.freeze(['workspace-timing', 'auto-refactor', 'WebGames', '.agents']),
    denyRoots: Object.freeze(['scripts', 'archive', '.git']),
    deniedTools: Object.freeze([]),
  }),
  'wg-refactor': Object.freeze({
    mode: MODE_WRITE,
    allowRoots: Object.freeze(['workspace-timing', 'auto-refactor', 'WebGames']),
    denyRoots: Object.freeze(['scripts', 'archive', '.git']),
    deniedTools: Object.freeze([]),
  }),
  'wg-review': Object.freeze({
    mode: MODE_READ,
    allowRoots: Object.freeze([]),
    denyRoots: Object.freeze([]),
    deniedTools: Object.freeze([]),
  }),
  'wg-explore': Object.freeze({
    mode: MODE_READ,
    allowRoots: Object.freeze([]),
    denyRoots: Object.freeze([]),
    deniedTools: Object.freeze([]),
  }),
})

function buildPolicy(spec) {
  return {
    mode: spec.mode,
    allowRoots: spec.allowRoots.map(normalizeRelativePath),
    denyRoots: spec.denyRoots.map(normalizeRelativePath),
    deniedTools: new Set(spec.deniedTools),
  }
}

const POLICIES = new Map(
  Object.entries(POLICY_TABLE).map(([presetId, spec]) => [presetId, buildPolicy(spec)]),
)

function isWithinRoot(target, root) {
  if (root.length === 0) return true
  return target === root || target.startsWith(`${root}/`)
}

function findFirstMatchingRoot(target, roots) {
  for (const root of roots) {
    if (isWithinRoot(target, root)) return root
  }
  return undefined
}

function extractPathArgument(args) {
  if (args === null || typeof args !== 'object') return undefined
  for (const key of PATH_ARGUMENT_NAMES) {
    if (typeof args[key] === 'string' && args[key].length > 0) return args[key]
  }
  return undefined
}

function collectPathArguments(args) {
  const single = extractPathArgument(args)
  if (single !== undefined) return [single]
  if (args === null || typeof args !== 'object' || !Array.isArray(args.paths)) return []
  return args.paths.filter((item) => typeof item === 'string' && item.length > 0)
}

function deniedToolReason(policy, toolName) {
  if (!policy.deniedTools.has(toolName)) return undefined
  return `${name}: tool "${toolName}" is disabled in the ${policy.mode} posture for this preset.`
}

function writePostureReason(policy, toolName) {
  if (!WRITE_TOOL_NAMES.includes(toolName)) return undefined
  return `${name}[${GUARD_GENERATION}]: tool "${toolName}" writes to disk, but this preset runs the read posture.`
}

function denyRootReason(policy, target) {
  const matched = findFirstMatchingRoot(target, policy.denyRoots)
  if (matched === undefined) return undefined
  return `${name}: "${target}" sits under forbidden root "${matched}" (workspace governance denial).`
}

function authorizationReason(policy, target, toolName) {
  const matched = findFirstMatchingRoot(target, policy.allowRoots)
  if (matched !== undefined) return undefined
  return `${name}: tool "${toolName}" may not touch "${target}"; authorized roots are [${
    policy.allowRoots.join(', ')
  }].`
}

function decide(policy, toolName, rawPath, caller) {
  const target = normalizeRelativePath(rawPath)
  const suffix = ` Target "${target}" stays untouched. (resolved caller: ${caller})`
  const toolReason = deniedToolReason(policy, toolName)
  if (toolReason !== undefined) return `${toolReason}${suffix}`
  const postureReason = writePostureReason(policy, toolName)
  if (postureReason !== undefined) return `${postureReason}${suffix}`
  const rootReason = denyRootReason(policy, target)
  if (rootReason !== undefined) return `${rootReason}${suffix}`
  if (policy.allowRoots.length === 0) return undefined
  const authReason = authorizationReason(policy, target, toolName)
  if (authReason === undefined) return undefined
  return `${authReason}${suffix}`
}

function checkPaths(policy, toolName, args, caller) {
  for (const rawPath of collectPathArguments(args)) {
    const reason = decide(policy, toolName, rawPath, caller)
    if (reason !== undefined) return reason
  }
  return undefined
}

function readPresetRegistry(ctx) {
  if (typeof ctx.get !== 'function') return undefined
  const registry = ctx.get('agentPresets')
  if (registry === null || registry === undefined) return undefined
  if (typeof registry.composedPreset !== 'function') return undefined
  return registry
}

function resolveCaller(ctx, execution) {
  const agent = execution.agent
  if (agent === null || agent === undefined) return { id: 'no-agent', policy: undefined }
  if (agent.ctx === undefined) return { id: 'no-agent-ctx', policy: undefined }
  const registry = readPresetRegistry(ctx)
  if (registry === undefined) return { id: 'no-registry', policy: undefined }
  const id = registry.composedPreset(agent.ctx)
  return { id: id === undefined || id === null ? 'unbound' : String(id), policy: POLICIES.get(id) }
}

function createGuard(ctx) {
  let warned = false
  return (execution) => {
    try {
      const { id, policy } = resolveCaller(ctx, execution)
      if (policy === undefined) return undefined
      return checkPaths(policy, String(execution.name), execution.arguments, id)
    } catch (error) {
      if (!warned) {
        warned = true
        ctx.logger.warn('[%s] path check failed and the call was allowed: %s', name, error)
      }
      return undefined
    }
  }
}

function warnWhenRegistryMissing(ctx) {
  if (readPresetRegistry(ctx) !== undefined) return
  ctx.logger.warn(
    '[%s] agentPresets registry is unavailable; caller postures cannot be resolved and every call is allowed',
    name,
  )
}

export function apply(ctx) {
  warnWhenRegistryMissing(ctx)
  ctx.effect(() => ctx.tools.guard(createGuard(ctx)))
  ctx.logger.info(
    '[%s] guard active: caller-resolved postures for [%s]',
    name,
    [...POLICIES.keys()].join(', '),
  )
}
