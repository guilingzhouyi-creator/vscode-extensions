/**
 * Module: Core Codemod — Facade & Public Exports
 * File Path: src/core/codemod/index.ts
 * Architecture Role: Unified public surface for the AST Codemod and automated repair engine.
 * Dependencies & Triggers: Imported by src/index.ts, src/api.ts, and external tools.
 * Responsibilities: Re-export patch engines, coordinate transformers, and built-in rules.
 * Exit Semantics & Design Rationale: Transparent re-exports with zero runtime overhead.
 */

export {
    TextEdit,
    FixSafetyLevel,
    FixDescriptor,
    CodemodOptions,
    TransformContext,
    PatchApplyResult,
} from './types';

export { FormatPreserver, LineEndingStyle } from './format-preserver';

export { TextEditApplier, ApplyEditsResult } from './text-edit-applier';

export { PatchEngine, defaultPatchEngine } from './patch-engine';

export { createExtractConstantFix, ExtractConstantOptions } from './transforms/extract-constant';

export { createUnusedImportFix, UnusedImportOptions } from './transforms/unused-imports';

export { createSimplifyBooleanFix, SimplifyBooleanOptions } from './transforms/modern-construct';

export {
    createJsDocTemplateFix,
    JsDocTemplateOptions,
    JsDocParam,
} from './transforms/jsdoc-template';
