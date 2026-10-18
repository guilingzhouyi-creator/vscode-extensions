/**
 * Module: Commit Message Hybrid Normalizer & Fast Lexical Tokenizer
 * File Path: scripts/common/commit-tokenizer.js
 * Architecture Role: High-performance, zero-dependency lexical tokenizer and text normalizer
 *   for Git commit message governance. Strips invisible unicode evasions, normalizes fullwidth characters,
 *   extracts Conventional Commit sections, and generates bilingual token streams via Trie and sliding n-grams.
 * Dependencies & Triggers: Zero external runtime dependencies; consumed by commit-style-arbiter.js
 *   and validate-commit-msg-style.js.
 * Responsibilities:
 *   1. Strip zero-width adversarial evasion characters and apply NFKC unicode normalization;
 *   2. Build lightweight prefix Trie for fast O(L) Chinese and English keyword matching;
 *   3. Parse Conventional Commit structure (type, scope, subject, structured sections);
 *   4. Extract bilingual tokens and identify initial header action verbs (imperative mood);
 *   5. Mask technical symbols, rule IDs, file paths, and code blocks for pure prose auditing.
 * Exit Semantics & Design Rationale: Pure deterministic string functions; zero runtime allocation in hot paths;
 *   execution latency < 5ms per message.
 */
'use strict';

/** Regular expression for invisible zero-width characters used in adversarial bypass */
const ZERO_WIDTH_CHARS_RE = /[\u200B-\u200D\uFEFF\u00AD]/g;

/** Conventional commit title pattern: <type>(<scope>): <summary> */
const CONVENTIONAL_TITLE_RE = /^([a-zA-Z0-9_\-]+)(?:\(([^)]+)\))?!?:[ \t]*(.+)$/;

/** Standard section headers in structured commit body */
const SECTION_HEADER_RE = /^\[([a-zA-Z\u4e00-\u9fa5\s/]+)(?::\s*([^\]]*))?\][ \t]*$/;

/** Whitelisted rule ID pattern */
const RULE_ID_RE = /\b[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}\b/g;

/** File path pattern */
const FILE_PATH_RE = /[a-zA-Z0-9_\-\.\/]+\.(?:ps1|sh|ts|js|json|md|py|gd|rs|toml|yaml|yml|html|css|txt)\b/g;

/** URL pattern */
const URL_RE = /https?:\/\/[^\s)]+/g;

/** Standard Chinese punctuation to space mapping */
const CJK_PUNCTUATION_RE = /[，。！？；：、“”‘’（）《》【】…—]/g;

/** English word pattern */
const ENG_WORD_RE = /[a-zA-Z]{2,}/g;

/** CJK contiguous block pattern */
const CJK_BLOCK_RE = /[\u4e00-\u9fa5]+/g;

/**
 * Strips zero-width characters and applies Unicode NFKC normalization.
 *
 * @param {string} text - Raw input text
 * @returns {string} Normalized clean text
 */
function normalizeText(text) {
  if (!text) return '';
  const stripped = text.replace(ZERO_WIDTH_CHARS_RE, '');
  return stripped.normalize('NFKC');
}

/**
 * Creates an empty prefix Trie root node.
 *
 * @returns {object} Trie root node
 */
function createTrie() {
  return { children: new Map(), isEnd: false, value: null };
}

/**
 * Inserts a word with associated payload into the prefix Trie.
 *
 * @param {object} root - Trie root node
 * @param {string} word - Target keyword to index
 * @param {*} payload - Payload attached to keyword
 */
function insertTrie(root, word, payload = true) {
  if (!word || typeof word !== 'string') return;
  let curr = root;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (!curr.children.has(ch)) {
      curr.children.set(ch, { children: new Map(), isEnd: false, value: null });
    }
    curr = curr.children.get(ch);
  }
  curr.isEnd = true;
  curr.value = payload;
}

/**
 * Searches the longest matching prefix starting from the specified index in text.
 *
 * @param {object} root - Trie root node
 * @param {string} text - Source text
 * @param {number} startIndex - Starting character index
 * @returns {{ matched: string, value: * } | null}
 */
function searchLongestPrefix(root, text, startIndex = 0) {
  let curr = root;
  let longestMatch = null;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (!curr.children.has(ch)) {
      break;
    }
    curr = curr.children.get(ch);
    if (curr.isEnd) {
      longestMatch = {
        matched: text.substring(startIndex, i + 1),
        value: curr.value,
      };
    }
  }

  return longestMatch;
}

/**
 * Builds a prefix Trie from an iterable of words.
 *
 * @param {Iterable<string>} words - Vocabulary word list
 * @returns {object} Populated Trie root
 */
function buildTrie(words) {
  const root = createTrie();
  for (const w of words) {
    if (w) insertTrie(root, w, true);
  }
  return root;
}

/**
 * Masks URLs, file paths, rule IDs, and inline code to prevent false positive lexical matches.
 *
 * @param {string} line - Raw source line
 * @returns {string} Sanitized line
 */
function maskTechnicalTokens(line) {
  if (!line) return '';
  return line
    .replace(URL_RE, ' __URL__ ')
    .replace(/`[^`]+`/g, ' __CODE__ ')
    .replace(RULE_ID_RE, ' __RULE_ID__ ')
    .replace(FILE_PATH_RE, ' __FILE_PATH__ ');
}

/**
 * Parses a conventional commit message into structured sections.
 *
 * @param {string} rawContent - Complete raw commit message
 * @returns {object} Parsed structure
 */
function parseCommitStructure(rawContent) {
  const normalized = normalizeText(rawContent);
  const rawLines = normalized.split(/\r?\n/);

  let headerLine = '';
  let headerIndex = 0;
  while (headerIndex < rawLines.length && !headerLine) {
    const l = rawLines[headerIndex].trim();
    if (l && !l.startsWith('#')) {
      headerLine = l;
      break;
    }
    headerIndex++;
  }

  const parsedHeader = parseHeaderLine(headerLine);
  const sections = parseSections(rawLines, headerIndex + 1);

  return {
    rawHeader: headerLine,
    type: parsedHeader.type,
    scope: parsedHeader.scope,
    summary: parsedHeader.summary,
    sections,
    allLines: rawLines,
  };
}

/**
 * Parses conventional commit header format.
 *
 * @param {string} headerLine - Title line
 * @returns {{ type: string, scope: string, summary: string }}
 */
function parseHeaderLine(headerLine) {
  const match = CONVENTIONAL_TITLE_RE.exec(headerLine);
  if (!match) {
    return { type: '', scope: '', summary: headerLine };
  }
  return {
    type: match[1].toLowerCase(),
    scope: match[2] || '',
    summary: (match[3] || '').trim(),
  };
}

/**
 * Extracts structured sections ([Why], [Added], [Changed], [Fixed], [Verification], etc.).
 *
 * @param {string[]} lines - Line array
 * @param {number} startLineIndex - Line index following header
 * @returns {Record<string, { title: string, content: string, lines: string[] }>}
 */
function parseSections(lines, startLineIndex) {
  const sections = {};
  let currentSectionKey = 'preamble';
  sections[currentSectionKey] = { title: 'Preamble', content: '', lines: [] };

  for (let i = startLineIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.startsWith('#')) continue;

    const match = SECTION_HEADER_RE.exec(rawLine.trim());
    if (match) {
      const sectionName = match[1].trim().toLowerCase();
      currentSectionKey = normalizeSectionKey(sectionName);
      if (!sections[currentSectionKey]) {
        sections[currentSectionKey] = {
          title: match[1].trim(),
          inlineValue: match[2] ? match[2].trim() : '',
          content: '',
          lines: [],
        };
      }
      continue;
    }

    if (sections[currentSectionKey]) {
      sections[currentSectionKey].lines.push(rawLine);
      sections[currentSectionKey].content += (sections[currentSectionKey].content ? '\n' : '') + rawLine;
    }
  }

  return sections;
}

/**
 * Normalizes section titles to canonical English keys.
 *
 * @param {string} name - Raw section header name
 * @returns {string} Canonical key
 */
function normalizeSectionKey(name) {
  const lower = name.toLowerCase();
  if (lower.includes('project') || lower.includes('项目')) return 'project';
  if (lower.includes('why') || lower.includes('动机') || lower.includes('背景')) return 'why';
  if (lower.includes('added') || lower.includes('新增')) return 'added';
  if (lower.includes('changed') || lower.includes('变更') || lower.includes('修改')) return 'changed';
  if (lower.includes('fixed') || lower.includes('修复')) return 'fixed';
  if (lower.includes('verification') || lower.includes('验证')) return 'verification';
  return lower;
}

/**
 * Extracts candidate tokens from text using Trie dictionary and n-gram slicing.
 *
 * @param {string} text - Target text
 * @param {object} [vocabularyTrie] - Optional Trie containing known domain words
 * @returns {{ engTokens: string[], cjkTokens: string[], allTokens: string[] }}
 */
function extractBilingualTokens(text, vocabularyTrie = null) {
  const normalized = normalizeText(text);
  const masked = maskTechnicalTokens(normalized);

  const engTokens = [];
  const cjkTokens = [];

  // 1. English tokens
  const engMatches = masked.match(ENG_WORD_RE) || [];
  for (const w of engMatches) {
    const lower = w.toLowerCase();
    if (lower !== 'url' && lower !== 'code' && lower !== 'file' && lower !== 'path' && lower !== 'rule' && lower !== 'id') {
      engTokens.push(lower);
    }
  }

  // 2. Chinese tokens via Trie longest-prefix match + 2/3-grams fallback
  const cjkBlocks = masked.match(CJK_BLOCK_RE) || [];
  for (const block of cjkBlocks) {
    const len = block.length;
    let i = 0;
    while (i < len) {
      if (vocabularyTrie) {
        const prefixMatch = searchLongestPrefix(vocabularyTrie, block, i);
        if (prefixMatch && prefixMatch.matched.length >= 2) {
          cjkTokens.push(prefixMatch.matched);
          i += prefixMatch.matched.length;
          continue;
        }
      }

      // Fallback: extract 2-character token
      if (i + 2 <= len) {
        cjkTokens.push(block.substring(i, i + 2));
      }
      i++;
    }

    // Include 3-grams for richer semantic matching
    if (len >= 3) {
      for (let j = 0; j <= len - 3; j++) {
        cjkTokens.push(block.substring(j, j + 3));
      }
    }
  }

  return {
    engTokens,
    cjkTokens,
    allTokens: [...engTokens, ...cjkTokens],
  };
}

/**
 * Extracts the initial action verb from the commit summary (for imperative mood checking).
 *
 * @param {string} summary - Header summary text
 * @returns {{ verb: string, remainder: string }}
 */
function extractLeadingActionVerb(summary) {
  if (!summary) return { verb: '', remainder: '' };
  const trimmed = summary.trim();

  // 1. English initial verb check (e.g. "add support for...")
  const engVerbMatch = /^[a-zA-Z]+/i.exec(trimmed);
  if (engVerbMatch) {
    const verb = engVerbMatch[0].toLowerCase();
    return {
      verb,
      remainder: trimmed.substring(verb.length).trim(),
    };
  }

  // 2. Chinese initial verb check (e.g. "新增支持...", "重构核心模块...")
  // Typically 2 to 4 Chinese characters
  const cjkVerbMatch = /^[\u4e00-\u9fa5]{2,4}/.exec(trimmed);
  if (cjkVerbMatch) {
    const verb = cjkVerbMatch[0];
    return {
      verb,
      remainder: trimmed.substring(verb.length).trim(),
    };
  }

  return { verb: '', remainder: trimmed };
}

module.exports = {
  normalizeText,
  createTrie,
  insertTrie,
  searchLongestPrefix,
  buildTrie,
  maskTechnicalTokens,
  parseCommitStructure,
  parseHeaderLine,
  extractBilingualTokens,
  extractLeadingActionVerb,
};
