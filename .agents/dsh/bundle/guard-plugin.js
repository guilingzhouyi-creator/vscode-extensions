/**
 * Module: Workspace Path Jail
 * File Path: .agents/dsh/bundle/guard-plugin.js
 * Architecture Role: 治理模式族的 Host 插件本体。把工作区治理公理「SubAgent 严禁触碰授权路径之外的文件」
 *   从提示词层承诺升级为运行时执行点，由四个 Agent Preset 各自的声明行挂载。
 * Dependencies & Triggers: 依赖宿主 `tools` 注册表服务（经 preset 挂载域解析）、`agentPresets` 注册表
 *   （按调用方 Agent 的 ctx 反查其预设身份）与同目录的 `jail-policy.json`（策略单源）。
 * Responsibilities: 按调用方 Agent 的预设身份解析姿态策略；归一化工作区相对路径；拒绝命中禁用工具、
 *   读姿态下的写类工具、禁止根与授权面之外的目标，并以结构化原因字符串给出被拒路径与规则名。
 * Exit Semantics & Design Rationale: 拒绝只以「返回原因字符串」表达，这是 ToolGuard 契约的全部通道。
 *   姿态按调用方 Agent 的预设身份解析，而策略只在 `jail-policy.json` 定义一份：四个声明行共享同一份
 *   物理实现与同一张策略表，避免四份配置各自漂移，也使判定与挂载顺序无关。声明行仍携带一个模式身份
 *   标签（`config.preset`），它只在 `agentPresets` 注册表不可用的降级路径上作为姿态来源，绝不参与正常判定。
 *   策略只表达姿态与全仓恒禁的构建/元数据目录；领域边界由各原型的 pathJail 在提示词层承担，两处不得
 *   重复表达同一约束——重复即必然分叉，实测曾出现 8 条写姿态预置被自己声明的模式拒绝其根目录。
 *   守卫对自身缺陷采取 fail-open（告警一次后放行），因为宿主沙箱仍是外层边界，且此处缺陷绝不能让会话变砖。
 *   判定次序为 deny 优先于 allow：禁止根压过授权列表，使重叠配置不会被误读为授权。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'wg-path-jail'
export const inject = ['tools']

/** 声明行携带的模式身份标签格式；仅用于注册表不可用时的姿态兜底。 */
const PRESET_ID_PATTERN = /^wg-[a-z]+$/u

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

/** 递归通配前缀：`**\/target` 命中任意深度的 target 目录。 */
const RECURSIVE_PREFIX = '**/'

const POLICY_PATH = fileURLToPath(new URL('./jail-policy.json', import.meta.url))

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

/**
 * 读取策略单源。
 *
 * 策略曾内联在本文件里，于是「哪个目录可写」同时存在于本表与各原型的 pathJail 中，两处必然分叉：
 * 实测 `scripts` 被列为禁用根、`fractal-git` 不在授权面，导致 8 条写姿态预置连自己的根目录都写不进。
 * 现在本文件只表达姿态，领域边界留在原型侧，单一真源因此可被目录校验器直接读取比对。
 *
 * @returns {object} 模式的策略字面量。
 * @throws {Error} 策略文件缺失或格式非法时抛出。
 */
function loadPolicyTable() {
  const document = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))
  if (document === null || typeof document !== 'object') {
    throw new Error('jail-policy.json must contain an object')
  }
  if (document.modes === null || typeof document.modes !== 'object') {
    throw new Error("jail-policy.json must declare a 'modes' object")
  }
  return document.modes
}

function buildPolicy(spec) {
  return {
    mode: spec.mode,
    allowRoots: (spec.allowRoots ?? []).map(normalizeRelativePath),
    denyRoots: (spec.denyRoots ?? []).map(normalizeRelativePath),
    deniedTools: new Set(spec.deniedTools ?? []),
  }
}

/**
 * 装载策略表。
 *
 * 模块作用域里抛异常会让整个 preset 装配失败，会话直接起不来——这与「守卫缺陷绝不能让会话变砖」
 * 的设计承诺相反。因此装载失败降级为空表（每次调用放行）并记录一次原因，由 apply 告警一次。
 *
 * @returns {{ policies: Map<string, object>, failure: string|undefined }} 策略表与降级原因。
 */
function loadPolicies() {
  try {
    const modes = loadPolicyTable()
    return { policies: new Map(Object.entries(modes).map(([id, spec]) => [id, buildPolicy(spec)])) }
  } catch (error) {
    return { policies: new Map(), failure: error instanceof Error ? error.message : String(error) }
  }
}

const LOADED = loadPolicies()
const POLICIES = LOADED.policies

function isWithinRoot(target, root) {
  if (root.length === 0) return true
  return target === root || target.startsWith(`${root}/`)
}

/**
 * 判定目标是否命中一条禁用根模式。
 *
 * 精确模式沿用前缀语义；`**\/x` 形式的递归模式命中任意深度的同名片段，因为构建产物
 * 目录（target/dist/out/bin/obj）会出现在每个子项目里，逐条枚举子项目路径等于把
 * 「项目清单」第二次抄进策略表。
 *
 * @param {string} target - 已归一化的工作区相对路径。
 * @param {string} pattern - 已归一化的禁用根模式。
 * @returns {boolean} 命中为 true。
 */
function matchesDenyRoot(target, pattern) {
  if (!pattern.startsWith(RECURSIVE_PREFIX)) return isWithinRoot(target, pattern)
  const suffix = pattern.slice(RECURSIVE_PREFIX.length)
  if (suffix.length === 0) return true
  const segments = dropEmptySegments(target.split('/'))
  const wanted = dropEmptySegments(suffix.split('/'))
  for (let start = 0; start + wanted.length <= segments.length; start += 1) {
    if (wanted.every((segment, offset) => segments[start + offset] === segment)) return true
  }
  return false
}

function findFirstMatchingRoot(target, roots) {
  for (const root of roots) {
    if (isWithinRoot(target, root)) return root
  }
  return undefined
}

function findFirstMatchingDeny(target, denyRoots) {
  for (const pattern of denyRoots) {
    if (matchesDenyRoot(target, pattern)) return pattern
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
  if (policy.mode !== MODE_READ) return undefined
  return `${name}: tool "${toolName}" writes to disk, but this preset runs the read posture.`
}

function denyRootReason(policy, target) {
  const matched = findFirstMatchingDeny(target, policy.denyRoots)
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

/**
 * 读取声明行的模式身份标签。该标签只在 `agentPresets` 注册表不可用时充当姿态兜底，
 * 正常判定一律以调用方 Agent 的实时预设身份为准；非法或缺失一律视为未标注。
 */
function readRowPreset(config) {
  if (config === null || typeof config !== 'object') return undefined
  const candidate = config.preset
  if (typeof candidate !== 'string') return undefined
  return PRESET_ID_PATTERN.test(candidate) ? candidate : undefined
}

function resolveCaller(ctx, execution, rowPreset) {
  const fallback = rowPreset === undefined ? undefined : POLICIES.get(rowPreset)
  const agent = execution.agent
  if (agent === null || agent === undefined) return { id: 'no-agent', policy: fallback }
  if (agent.ctx === undefined) return { id: 'no-agent-ctx', policy: fallback }
  const registry = readPresetRegistry(ctx)
  if (registry === undefined) return { id: 'no-registry', policy: fallback }
  const id = registry.composedPreset(agent.ctx)
  if (id === undefined || id === null) return { id: 'unbound', policy: fallback }
  return { id: String(id), policy: POLICIES.get(id) ?? fallback }
}

function createGuard(ctx, rowPreset) {
  let warned = false
  return (execution) => {
    try {
      const { id, policy } = resolveCaller(ctx, execution, rowPreset)
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

function warnWhenRegistryMissing(ctx, rowPreset) {
  if (readPresetRegistry(ctx) !== undefined) return
  ctx.logger.warn(
    '[%s] agentPresets registry is unavailable; postures resolve from the declaration row tag (row tag: %s)',
    name,
    rowPreset === undefined ? 'absent, every call allowed' : rowPreset,
  )
}

export function apply(ctx, config) {
  const rowPreset = readRowPreset(config)
  if (LOADED.failure !== undefined) {
    ctx.logger.warn('[%s] jail policy unreadable, every path check is bypassed: %s', name, LOADED.failure)
  }
  warnWhenRegistryMissing(ctx, rowPreset)
  ctx.effect(() => ctx.tools.guard(createGuard(ctx, rowPreset)))
  ctx.logger.info(
    '[%s] guard active: caller-resolved postures for [%s] (row tag: %s)',
    name,
    [...POLICIES.keys()].join(', '),
    rowPreset === undefined ? 'absent' : rowPreset,
  )
}
