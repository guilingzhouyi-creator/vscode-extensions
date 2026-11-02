/**
 * Module: Commit Message Structural Contract Verifier
 * File Path: scripts/common/commit-structure-contract.js
 * Architecture Role: Single implementation of the six structural commit-message checks that used
 *   to live only inside the PowerShell and Bash entry points. The entry points now delegate here, so
 *   the same rules apply whether a message arrives through the hook, through `--range` on push, or
 *   through a CI invocation that never touches a shell script.
 * Dependencies & Triggers: Consumes `commit-msg-forbidden-terms.json` for the project enumeration;
 *   invoked by `validate-commit-msg.js` and therefore by `commit-msg-gate` (ps1/sh), `pre-push-gate`
 *   (`COMMIT-HISTORY-21`) and CI.
 * Responsibilities:
 *   1. Verify the header shape (type, optional scope, length) and forbid a trailing period;
 *   2. Verify a blank second line separates header from body;
 *   3. Verify the body carries enough substantive characters for the commit type;
 *   4. Verify the required structured sections, including `[Fixed]` for `fix`;
 *   5. Verify the project-scope block exists and declares only controlled projects;
 *   6. Reject construction-batch codenames in the body;
 *   7. Report each finding with the step id the registry declares, so a caller can attribute it.
 * Exit Semantics & Design Rationale: Pure functions returning findings; the caller decides exit
 *   status. The six checks were previously duplicated as native code in two shells, which meant a
 *   fix had to be written twice and verified twice — and the Bash copy had already drifted. One
 *   implementation removes that class of divergence rather than policing it.
 *   The seventh registered step, `SLANG-GUARD-02`, is intentionally not here: it is a dictionary
 *   lookup over `commit-msg-forbidden-terms.json` with whitelist and code-block masking, which is a
 *   different mechanism from a structural predicate. Codename detection lives here; slang detection
 *   lives in `validate-commit-msg-style.js`.
 *
 * @module commit-structure-contract
 */

"use strict";

const path = require("path");

const TERMS_FILE = path.join(__dirname, "commit-msg-forbidden-terms.json");

/** Commit types that carry production-grade obligations (body density, sections, project scope). */
const CRITICAL_TYPES = Object.freeze(["feat", "fix", "refactor", "perf"]);
const ALL_TYPES = Object.freeze([
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "chore",
  "style",
  "perf",
  "ci",
  "build",
]);
const MIN_BODY_SUBSTANTIVE = 30;
const NON_CRITICAL_MIN_BODY_SUBSTANTIVE = 15;
const HEADER_LINE_MIN = 15;
const HEADER_LINE_MAX = 80;
const HEADER_SUBJECT_MIN = 10;
const HEADER_SUBJECT_MAX = 70;

const {
  ZERO_WIDTH_REGEX,
  EMOJI_REGEX,
  FULLWIDTH_COLON_REGEX,
  MISSING_COLON_SPACE_REGEX,
  MULTI_COLON_SPACE_REGEX,
  checkTypographyAndPunctuation: validateTypography,
  checkSectionDensityBounds: validateSectionDensity,
} = require("./lib/commit-typography-validator");

/**
 * Step identifiers this module can report, exactly as registered in `gate-step-registry.json`.
 *
 * `SLANG-GUARD-02` is deliberately absent: it is a dictionary check owned by
 * `validate-commit-msg-style.js`, and a constant here would advertise a step this module never
 * produces — a caller filtering on it would silently match nothing.
 */
const STEP = Object.freeze({
  header: "HEADER-FORM-01",
  split: "BODY-SPLIT-03",
  density: "BODY-DENSITY-04",
  sections: "BODY-SECTIONS-05",
  project: "PROJECT-SCOPE-06",
  batch: "BATCH-CODE-07",
});

/**
 * The header pattern.
 *
 * The scope accepts ASCII identifiers and CJK, because a Chinese project or module name is a
 * legitimate scope: `fix(门禁):` names the same thing `fix(gate):` does, and rejecting it forced
 * authors to translate their own module names. The type list stays closed — an unknown type is a
 * real contract violation, not a localization difference.
 */
const HEADER = new RegExp(
  `^(${ALL_TYPES.join("|")})(!)?\\(([\\w\\-/,@.\\u4e00-\\u9fff]+(?:,\\s*[\\w\\-/,@.\\u4e00-\\u9fff]+)*)\\)(!)?: ([\\s\\S]{${HEADER_SUBJECT_MIN},${HEADER_SUBJECT_MAX}})$`,
  "u",
);

/** A trailing ASCII or full-width period. */
const TRAILING_PERIOD = /[.。]$/;

/** Bare construction-batch codenames that carry no technical meaning. */
const BATCH_CODE =
  /\b(phase\d+|st\d+|p\d+|sprint\s*\d+|w[1-9]|pass\s*[1-6])\b/i;

/** Matches unreplaced template angle-bracket placeholders like `<...>` (e.g. `<type>`, `<scope>`, `<workspace-timing>`). */
const TEMPLATE_PLACEHOLDER = /<[a-zA-Z\u4e00-\u9fff\-_/|、\s]{2,80}>/;

/** Unresolved markers indicating incomplete or deferred technical thoughts. */
const UNRESOLVED_MARKERS =
  /\b(TODO|FIXME|TBD|XXX)\b|(?:\b|[^a-zA-Z0-9])(待补充|待确认|待办|未完待续)(?:\b|[^a-zA-Z0-9])/i;

/** Section headings, matched case-insensitively in both languages. */
const SECTION = Object.freeze({
  why: /^\s*\[(?:Why|动机|背景)/im,
  change: /^\s*\[(?:Added|Changed|Fixed|Removed|新增|变更|修改|修复|删除)/im,
  verification: /^\s*\[(?:Verification|验证)/im,
  fixed: /^\s*\[(?:Fixed|修复)/im,
});

/** Project-scope headings, including the inline `[Project: a, b]` and `[Project] a, b` forms. */
const PROJECT_HEADING =
  /^\[(?:Project(?:\s*\/\s*(?:项目|项目归属))?|项目归属|项目)(?:\s*:\s*(.*?))?\](?:\s*:?\s*(.*))?$/i;

/**
 * Reads the controlled project enumeration from the forbidden-terms dictionary.
 *
 * The list lives in the dictionary rather than here so a new project is a data edit; a second copy
 * in this module would be the same duplication the module exists to remove.
 *
 * @returns {string[]} Lower-case accepted project names.
 */
function controlledProjects() {
  try {
    const resolver = require("./project-registry-resolver");
    const dynamicNames = resolver.getControlledProjectNames();
    if (dynamicNames && dynamicNames.length > 0) {
      return dynamicNames;
    }
  } catch {
    // Fall back to dictionary if resolver fails
  }
  try {
    const dictionary = JSON.parse(
      require("fs").readFileSync(TERMS_FILE, "utf8"),
    );
    const rule = (dictionary.rules || []).find((r) => r.id === "CMG-PRJ-001");
    const declared =
      rule && Array.isArray(rule.controlledProjects)
        ? rule.controlledProjects
        : [];
    if (declared.length > 0) return declared.map((p) => p.toLowerCase());
  } catch {
    // A missing dictionary must not silently accept every project name; fall back to the shipped
    // enumeration so the guard still rejects an unauthorised identifier.
  }
  return [
    "workspace-timing",
    "auto-refactor",
    "webgames",
    "web-games",
    "fractal-git",
    "fractalgit",
    "governance",
  ];
}

/**
 * Splits a message into its header and body, dropping `#` comment lines the way Git does.
 *
 * @param {string} content - Raw commit message.
 * @returns {{lines: string[], header: string, body: string, type: string}} Parsed parts.
 */
function parseMessage(content) {
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => !/^\s*#/.test(line));
  const header = (lines[0] || "").trim();
  const body = lines.slice(2).join("\n");
  const typeMatch = /^([a-z]+)/.exec(header);
  return { lines, header, body, type: typeMatch ? typeMatch[1] : "" };
}

/**
 * Counts substantive characters in the body, excluding section headings and the project block.
 *
 * Headings are structure, not content; the project block is metadata that the scope check already
 * verifies. Counting either would let a message reach the density floor without saying anything.
 *
 * @param {string[]} bodyLines - Body lines (index 2 onward).
 * @returns {number} Non-whitespace characters of actual prose.
 */
function countSubstantive(bodyLines) {
  let total = 0;
  let inProjectBlock = false;
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (/^\[[^\]]+\](\s*:.*)?\s*$/.test(trimmed)) {
      inProjectBlock = /^\[(Project|项目|项目归属)/i.test(trimmed);
      continue;
    }
    if (inProjectBlock) {
      if (trimmed === "" || trimmed.startsWith("-")) continue;
      inProjectBlock = false;
    }
    total += trimmed.replace(/\s/g, "").length;
  }
  return total;
}

/**
 * Collects every project name declared in the scope block.
 *
 * Both the inline form (`[Project: a, b]`) and the list form (`[Project]\n- a`) are accepted, and
 * both separators are recognised, because the two shells previously split on different sets.
 *
 * @param {string} body - Body text.
 * @returns {string[]} Declared project names, in declaration order.
 */
function collectProjects(body) {
  const declared = [];
  let inSection = false;
  const pushSplit = (value) => {
    for (const part of String(value).split(/[,，、]/)) {
      const cleaned = part
        .trim()
        .replace(/^-\s*/, "")
        .replace(/\s*[（(].*$/, "")
        .replace(/\s+.*$/, "")
        .trim();
      if (cleaned) declared.push(cleaned);
    }
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = PROJECT_HEADING.exec(line);
    if (heading) {
      inSection = true;
      const inline = heading[1] || heading[2];
      if (inline) pushSplit(inline);
      continue;
    }
    if (!inSection) continue;
    if (line === "") continue;
    if (/^\[.*\]/.test(line)) {
      inSection = false;
      continue;
    }
    const item = /^-\s*(.*)$/.exec(line);
    if (item) pushSplit(item[1]);
    else inSection = false;
  }
  return declared;
}

/** Bare command line invocations that carry no assertion fact. */
const BARE_CMD =
  /^`?(?:npm|npx|node|pwsh|bash|git|vitest|cargo|tsc|python)\b[^。；]*$/i;

/** Trivial single-word completions without verifiable technical assertion. */
const HEDGE_WORD =
  /^(?:ok|done|已(?:经)?(?:改好|修复|完成|测试)|无问题|没问题|通过|pass)[。.!！]?$/i;

/** Speculative hedge phrases indicating unverified assumptions. */
const HEDGE_PHRASE =
  /(应该|大概|基本(?:上)?没问题|没问题|无问题|已经(?:改|修)好|已(?:经)?完成(?:修改|修复)|不出意外|按理)/;

/**
 * Checks the header line shape, trailing period, and the blank separator.
 *
 * @param {{lines: string[], header: string}} parsed - Parsed message parts.
 * @param add - Finding sink.
 */
function checkHeaderShape(parsed, add) {
  const { lines, header } = parsed;

  if (ZERO_WIDTH_REGEX.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      "提交标题包含非法零宽或隐藏控制字符",
      "remove zero-width and invisible control characters; ensure UTF-8 without BOM",
    );
  }

  if (EMOJI_REGEX.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      "提交标题包含装饰性 Emoji 表情符号，严禁使用 Emoji 污染提交历史",
      "remove decorative emojis from the header subject",
    );
  }

  if (FULLWIDTH_COLON_REGEX.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      "提交标题作用域后使用了全角冒号 ('：')，必须使用半角冒号加单空格 (': ')",
      "replace '：' with ': ' after the scope parenthesis",
    );
  } else if (MISSING_COLON_SPACE_REGEX.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      "提交标题半角冒号后缺少空格分隔符，必须使用半角冒号加单个空格 (': ')",
      "insert a single space after the colon (': ')",
    );
  } else if (MULTI_COLON_SPACE_REGEX.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      "提交标题半角冒号后包含多余连续空格，仅允许单个空格分隔符 (': ')",
      "use single space after colon",
    );
  }

  if (header.length < HEADER_LINE_MIN) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      `提交标题整行过短 (${header.length} < ${HEADER_LINE_MIN} 字符): ${header}`,
      `header must be between ${HEADER_LINE_MIN} and ${HEADER_LINE_MAX} characters`,
    );
  } else if (header.length > HEADER_LINE_MAX) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      `提交标题整行超长 (${header.length} > ${HEADER_LINE_MAX} 字符): ${header}`,
      `header must be between ${HEADER_LINE_MIN} and ${HEADER_LINE_MAX} characters`,
    );
  }

  if (!HEADER.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      `提交标题不符合格式契约: ${header}`,
      `expected <type>(<scope>): <summary>, subject length ${HEADER_SUBJECT_MIN}~${HEADER_SUBJECT_MAX} characters, type in ${ALL_TYPES.join("/")}, scope is required`,
    );
  }
  if (TRAILING_PERIOD.test(header)) {
    add(
      STEP.header,
      "GUARD-MSG-001",
      `提交标题末尾包含句号: ${header}`,
      "remove the trailing period",
    );
  }
  if (lines.length > 1 && (lines[1] || "").trim() !== "") {
    add(
      STEP.split,
      "GUARD-MSG-001",
      "标题与正文之间缺少空行",
      "line 2 must be blank",
    );
  }
}

/**
 * Checks body density and the presence of the required sections.
 *
 * @param {{lines: string[], body: string, type: string, header: string}} parsed - Parsed message parts.
 * @param add - Finding sink.
 */
function checkBodySections(parsed, add) {
  const { lines, body, type, header } = parsed;
  const isCritical = CRITICAL_TYPES.includes(type);
  const minSubstantive = isCritical
    ? MIN_BODY_SUBSTANTIVE
    : NON_CRITICAL_MIN_BODY_SUBSTANTIVE;
  const substantive = countSubstantive(lines.slice(2));
  if (substantive < minSubstantive) {
    add(
      STEP.density,
      "GUARD-MSG-001",
      `正文实质信息量不足 (${substantive} < ${minSubstantive})`,
      isCritical
        ? "add technical facts under [Why], [Changed] and [Verification]"
        : "add technical facts under [Why] and [Verification]",
    );
  }
  const missing = [];
  if (!SECTION.why.test(body)) missing.push("[Why]");
  if (isCritical && !SECTION.change.test(body))
    missing.push("[Changed/Added/Fixed]");
  if (!SECTION.verification.test(body)) missing.push("[Verification]");
  if (missing.length > 0) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      `缺少必需区块: ${missing.join(", ")}`,
      "add the listed sections",
    );
  }
  if (type === "fix" && !SECTION.fixed.test(body)) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      "fix 提交缺少 [Fixed] 区块",
      "state the defect and its root cause",
    );
  }
  if (type === "feat" && !/^\s*\[(?:Added|新增)/im.test(body)) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      "feat 提交缺少 [Added / 新增功能] 清单区块",
      "declare added modules, features or APIs under [Added]",
    );
  }
  if ((type === "refactor" || type === "perf") && !/^\s*\[(?:Changed|变更|修改|重构)/im.test(body)) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      `${type} 提交缺少 [Changed / 变更重构] 清单区块`,
      "declare changed or optimized modules under [Changed]",
    );
  }
  if (header && header.includes("!") && !/^\s*\[(?:Breaking\s*Changes|破坏性变更)/im.test(body)) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      "破坏性提交 (题头含 '!') 缺少 [Breaking Changes / 破坏性变更] 区块",
      "provide migration guide and breaking changes details under [Breaking Changes]",
    );
  }
}

/**
 * Determines whether a verification item contains a falsifiable technical assertion.
 *
 * @param {string} item - Raw text line from verification section.
 * @returns {boolean} True if the item carries substantive technical assertions.
 */
function isFalsifiableItem(item) {
  const plain = item.replace(/`[^`]*`/g, "").trim();
  if (!plain) return false;
  if (HEDGE_WORD.test(plain) || HEDGE_PHRASE.test(plain)) return false;
  if (BARE_CMD.test(plain)) return false;
  const substantive = plain.replace(/[\s。，,、；;：:!！\-*]/g, "").length;
  return substantive >= 8;
}

/**
 * Extracts bullet or prose items from the Verification section of the body.
 *
 * @param {string} body - Commit body.
 * @returns {string[]} Verification bullet items or prose lines.
 */
function extractVerificationItems(body) {
  let inside = false;
  const collected = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (SECTION.verification.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^\s*\[[^\]]+\]/.test(line)) {
      inside = false;
      continue;
    }
    if (inside && line !== "") {
      collected.push(line);
    }
  }
  const bullets = collected
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim());
  if (bullets.length > 0) return bullets;
  const prose = collected.join(" ").trim();
  return prose ? [prose] : [];
}

/**
 * Verifies that the Verification section contains at least one falsifiable assertion.
 *
 * @param {string} body - Commit body.
 * @param add - Finding sink.
 */
function checkVerificationAssertion(body, add) {
  if (!SECTION.verification.test(body)) return;
  const items = extractVerificationItems(body);
  const hasRealAssertion = items.some(isFalsifiableItem);
  if (!hasRealAssertion) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      "验证结论缺少实质技术断言或仅包含敷衍占位符/裸命令",
      "provide at least one concrete, falsifiable technical assertion under [Verification]",
    );
  }
}

/**
 * Maps section name to canonical rank to enforce topological ordering.
 *
 * @param {string} name - Lower-case section heading keyword.
 * @returns {number} Rank (1 to 4), or 99 for unknown/custom sections.
 */
function getSectionRank(name) {
  if (/^(project|项目|项目归属)$/.test(name)) return 1;
  if (/^(why|动机|背景|动机背景)$/.test(name)) return 2;
  if (/^(added|changed|fixed|removed|新增|变更|修改|修复|删除)$/.test(name))
    return 3;
  if (/^(verification|验证|验证结论)$/.test(name)) return 4;
  return 99;
}

/**
 * Checks section uniqueness and topological ordering across the body.
 *
 * @param {string} body - Commit body.
 * @param add - Finding sink.
 */
function checkSectionOrderAndDuplication(body, add) {
  const headings = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[([a-zA-Z\u4e00-\u9fff]+)(?:\s*[\/|].*?)?\]/.exec(lines[i]);
    if (m) {
      headings.push({ name: m[1].toLowerCase(), raw: m[0].trim() });
    }
  }
  const seen = new Set();
  for (const h of headings) {
    if (seen.has(h.name)) {
      add(
        STEP.sections,
        "GUARD-MSG-001",
        `正文存在重复区块: ${h.raw}`,
        "each section must appear at most once",
      );
    }
    seen.add(h.name);
  }
  let lastRank = 0;
  for (const h of headings) {
    const r = getSectionRank(h.name);
    if (r < 99) {
      if (r < lastRank) {
        add(
          STEP.sections,
          "GUARD-MSG-001",
          `区块顺序颠倒: ${h.raw}`,
          "sections must follow order: [Project] -> [Why] -> [Changed/Added/Fixed] -> [Verification]",
        );
        break;
      }
      lastRank = r;
    }
  }
}

/**
 * Checks declared project ownership against the controlled set and leases.
 *
 * @param {string} body - Message body.
 * @param {{ projects?: string[] }} options - Overrides for testing.
 * @param add - Finding sink.
 */
function checkProjectScope(body, options, add) {
  const declared = collectProjects(body);
  if (declared.length === 0) {
    add(
      STEP.project,
      "CMG-PRJ-001",
      "缺少项目归属区块或未声明任何项目",
      "declare [Project / 项目归属] with at least one controlled project",
    );
    return;
  }

  const legal = new Set(options.projects || controlledProjects());
  const invalid = declared.filter((p) => !legal.has(p.toLowerCase()));
  if (invalid.length > 0) {
    add(
      STEP.project,
      "CMG-PRJ-001",
      `项目归属包含未授权标识: ${invalid.join(", ")}`,
      `allowed: ${[...legal].join(", ")}`,
    );
  }
  try {
    const resolver = require("./project-registry-resolver");
    for (const p of declared) {
      if (resolver.getProjectStatus(p) === "Frozen") {
        add(
          STEP.project,
          "CMG-PRJ-001",
          `项目 '${p}' TTL 租约已过期，提交权限已被拒绝 (Commit Lockdown)`,
          `run 'taxis project renew ${p}' to unfreeze commit privileges`,
        );
      }
    }
  } catch {
    // Ignore if resolver is unavailable
  }
}

/**
 * Checks the body for sprint codenames.
 *
 * @param {string} body - Message body.
 * @param add - Finding sink.
 */
function checkBatchCodenames(body, add) {
  // The line number is reported so a caller that prints it does not have to
  // re-scan with a second copy of the pattern — that copy is how the two
  // vocabularies drifted.
  const batchLines = [];
  body.split(/\r?\n/).forEach((line, index) => {
    const hit = BATCH_CODE.exec(line);
    if (hit) batchLines.push({ line: index + 3, token: hit[0] });
  });
  if (batchLines.length === 0) return;
  const first = batchLines[0];
  add(
    STEP.batch,
    "CMG-STY-001",
    `正文包含批次代号: ${first.token}`,
    "describe the technical fact instead",
    {
      line: first.line,
      token: first.token,
    },
  );
}

/**
 * Checks for unreplaced template angle-bracket placeholders in the header or body.
 *
 * @param {{header: string, body: string}} parsed - Parsed message parts.
 * @param add - Finding sink.
 */
function checkTemplatePlaceholders(parsed, add) {
  const content = parsed.header + "\n\n" + parsed.body;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = TEMPLATE_PLACEHOLDER.exec(line);
    if (m && !line.includes("](" + m[0])) {
      add(
        STEP.density,
        "GUARD-MSG-001",
        `提交信息残留未替换的模板尖括号占位符: "${m[0]}" (第 ${i + 1} 行)`,
        "replace template placeholders with substantive technical facts",
      );
      break;
    }
  }
}

/**
 * Verifies that declared structured sections carry substantive body text, not just bare headings.
 *
 * @param {string} body - Commit body.
 * @param add - Finding sink.
 */
function checkEmptySections(body, add) {
  const lines = body.split(/\r?\n/);
  let currentSection = null;
  let sectionContentLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const headingMatch = /^\[([a-zA-Z\u4e00-\u9fff\s/]+)\]/.exec(line);
    if (headingMatch) {
      if (currentSection !== null && sectionContentLength === 0) {
        add(
          STEP.sections,
          "GUARD-MSG-001",
          `结构化区块 ${currentSection} 为空壳，缺少实质内容`,
          `fill in substantive facts under ${currentSection} or remove it`,
        );
      }
      currentSection = headingMatch[0];
      sectionContentLength = 0;
      continue;
    }
    if (currentSection !== null && line.length > 0) {
      const substantive = line.replace(/^[-*]\s*/, "").trim();
      if (substantive.length > 0) {
        sectionContentLength += substantive.length;
      }
    }
  }
  if (currentSection !== null && sectionContentLength === 0) {
    add(
      STEP.sections,
      "GUARD-MSG-001",
      `结构化区块 ${currentSection} 为空壳，缺少实质内容`,
      `fill in substantive facts under ${currentSection} or remove it`,
    );
  }
}

/**
 * Checks for unresolved markers (TODO/FIXME/TBD/待补充) in header or body.
 *
 * @param {{header: string, body: string}} parsed - Parsed message parts.
 * @param add - Finding sink.
 */
function checkUnresolvedMarkers(parsed, add) {
  const content = parsed.header + "\n\n" + parsed.body;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/`[^`]*(?:TODO|FIXME|TBD)[^`]*`/.test(line)) continue;
    const m = UNRESOLVED_MARKERS.exec(line);
    if (m) {
      const token = m[1] || m[2] || m[0];
      add(
        STEP.density,
        "CMG-STY-001",
        `提交信息包含未决占位标记 "${token}" (第 ${i + 1} 行)`,
        "resolve all TODO/TBD markers before committing to the repository",
      );
      break;
    }
  }
}

/**
 * Verifies typography, character encoding, hidden control characters, and punctuation.
 *
 * @param {string} content - Full raw commit message.
 * @param {{body: string}} parsed - Parsed message parts.
 * @param {Function} add - Finding sink.
 */
function checkTypographyAndPunctuation(content, parsed, add) {
  validateTypography(content, parsed, STEP, add);
}

/**
 * Checks density and substantive bounds of individual declared sections.
 *
 * @param {string} body - Commit body.
 * @param {Function} add - Finding sink.
 */
function checkSectionDensityBounds(body, add) {
  validateSectionDensity(body, countSubstantive, STEP, add);
}

/**
 * Runs the seven structural checks.
 *
 * @param {string} content - Raw commit message.
 * @param {{ projects?: string[] }} [options] - Overrides for testing.
 * @returns {Array<{step: string, ruleId: string, message: string, detail: string, line?: number, token?: string}>} Findings.
 */
function verifyStructure(content, options = {}) {
  const parsed = parseMessage(content);
  const findings = [];
  const add = (step, ruleId, message, detail, extra) =>
    findings.push({ step, ruleId, message, detail, ...(extra || {}) });

  if (parsed.header === "") {
    add(STEP.header, "GUARD-MSG-001", "提交标题为空", "header is empty");
    return findings;
  }

  checkHeaderShape(parsed, add);
  checkTypographyAndPunctuation(content, parsed, add);
  checkTemplatePlaceholders(parsed, add);
  checkUnresolvedMarkers(parsed, add);
  checkProjectScope(parsed.body, options, add);
  checkBodySections(parsed, add);
  checkSectionDensityBounds(parsed.body, add);
  checkEmptySections(parsed.body, add);
  checkSectionOrderAndDuplication(parsed.body, add);
  checkVerificationAssertion(parsed.body, add);
  checkBatchCodenames(parsed.body, add);
  return findings;
}

/**
 * Proves each check fires on its own defect and stays silent on a compliant message.
 *
 * @returns {string[]} Probe failures.
 */
function runSelfProbes() {
  const { runSelfProbes: executeProbes } = require("./lib/commit-structure-probes");
  return executeProbes(verifyStructure, STEP);
}

module.exports = Object.freeze({
  verifyStructure,
  parseMessage,
  collectProjects,
  countSubstantive,
  controlledProjects,
  runSelfProbes,
  STEP,
  CRITICAL_TYPES,
  ALL_TYPES,
});
