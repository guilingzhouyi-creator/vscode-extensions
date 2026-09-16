// @ts-check
/**
 * Module: Static Quality Gate — ESLint Flat Configuration
 * File Path: eslint.config.mjs
 * Architecture Role: Lint single source of truth for src/**\/*.ts and scripts/*.js
 * Dependencies & Triggers: npm run lint / lint:fix / gate (CI)
 * Responsibilities: typescript-eslint correctness rules, JSDoc structural validation,
 *                   Node globals wiring, and Prettier conflict neutralization
 * Exit Semantics & Design Rationale: Non-zero on any error; JSDoc *presence* is deliberately
 *                   delegated to the self-hosted strict comment gate (CMT-DOC-001) so the two
 *                   layers never drift apart or double-report the same violation.
 */

import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'scripts/.corpus/**',
      'testdata/**',
      'samples/**',
      '*.tgz',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts', 'scripts/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { jsdoc },
    rules: {
      // ── Baseline engineering rules ────────────────────────────────────────────
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-console': 'off',
      'object-shorthand': ['error', 'properties'],

      // ── Modernization rules (enforced from now on; auto-fixed where possible) ─
      // Type-only imports are erased at compile time and keep the runtime module graph small.
      // `disallowTypeAnnotations: false` keeps this repository's deliberate lazy TYPE
      // annotations (`import('typescript').SourceFile`) legal — they erase exactly like
      // `import type` and document that the heavy parser types are never loaded on the cold path.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      // Optional chaining is intentionally NOT enabled yet: the rule needs typed linting
      // (`parserOptions.project*`), which this repo has not turned on — enabling typed linting is
      // a separate decision because it multiplies lint time across every file.
      // Assignment/logic shorthands and early-return discipline.
      'logical-assignment-operators': ['error', 'always'],
      'no-else-return': ['error', { allowElseIf: true }],
      'prefer-object-spread': 'error',

      // ── Deliberate exemptions (architecture, not hygiene debt) ────────────────
      // `any` is the sanctioned escape hatch at the dynamic boundaries of this tool:
      // the normalized AST, custom-analyzer plugin contract, and report payloads are
      // inherently schema-free. Type-safety debt is tracked separately; it must not
      // block the comment/format gate.
      '@typescript-eslint/no-explicit-any': 'off',
      // The CLI/daemon deliberately lazy-loads subcommands via `require()` so a cold
      // `scan` never pays for daemon/IPC modules. Converting to ESM `import()` would
      // change startup semantics of the shipped CommonJS bundle.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // ── JSDoc structure (presence is enforced by the self-hosted comment gate) ─
      // Scope of the structural checks mirrors the standard (§3): public/exported
      // declarations only — private helpers carry intent comments but are not
      // forced into full @param/@returns contracts.
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/require-param': [
        'error',
        {
          contexts: [
            'ExportNamedDeclaration > FunctionDeclaration',
            'ExportDefaultDeclaration > FunctionDeclaration',
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator',
            'ExportDefaultDeclaration > VariableDeclaration > VariableDeclarator',
          ],
        },
      ],
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': [
        'error',
        {
          contexts: [
            'ExportNamedDeclaration > FunctionDeclaration',
            'ExportDefaultDeclaration > FunctionDeclaration',
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator',
            'ExportDefaultDeclaration > VariableDeclaration > VariableDeclarator',
          ],
          publicOnly: true,
        },
      ],
      'jsdoc/require-returns-description': 'error',
      'jsdoc/no-blank-block-descriptions': 'off',
      'jsdoc/tag-lines': 'off',
    },
  },

  {
    files: ['scripts/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },

  // Must stay last: turns off rules that conflict with Prettier formatting.
  prettier,

  // Re-asserted AFTER eslint-config-prettier (which switches max-len off): the standard
  // requires <=100 columns, and Prettier cannot wrap pre-existing comments.
  // Unwrappable literals (strings, templates, regexes, URLs) stay exempt.
  {
    files: ['src/**/*.ts', 'scripts/*.js'],
    rules: {
      'max-len': [
        'error',
        {
          code: 100,
          tabWidth: 4,
          ignoreUrls: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
    },
  },
);
