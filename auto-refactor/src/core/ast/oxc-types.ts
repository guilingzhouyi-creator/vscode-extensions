/**
 * Module: Core Engine — Parser Adapters (oxc types and vocabulary)
 * File Path: src/core/ast/oxc-types.ts
 * Architecture Role: Shared AST node definitions, vocabulary constants, and reflection skip
 *   tables for the oxc parser adapter and projector.
 * Dependencies & Triggers: Core engine multilang definitions; imported by oxcAdapter,
 *   oxcPredicates, and oxcProjector when compiling and executing oxc fast-path.
 * Responsibilities: Define OxcNode, OxcParseResult, ParseSyncFn, and Ctx; define AST kind
 *   string constants, typeof string tags, AST traversal skip sets, and computeLineStarts.
 * Exit Semantics & Design Rationale: Pure type definitions and frozen constant sets; safe for
 *   stateless concurrent execution across scanner workers.
 */

/** Loose structural view of an oxc ESTree-style node (reflection traversal). */
export interface OxcNode {
    type: string;
    /** UTF-16 code-unit offsets — identical to JS string indices and TS offsets. */
    start: number;
    end: number;
    [key: string]: any;
}

/** Result shape returned by the oxc parser sync entry point. */
export interface OxcParseResult {
    program: OxcNode;
    comments: unknown[];
    errors: unknown[];
}

/** Function signature for oxc parser parseSync. */
export type ParseSyncFn = (
    filename: string,
    sourceText: string,
    options?: {
        lang?: typeof OXC_LANGUAGE_JS | 'jsx' | typeof OXC_LANGUAGE_TS | 'tsx' | 'dts';
        sourceType?: 'script' | 'module' | 'commonjs' | 'unambiguous';
        astType?: typeof OXC_LANGUAGE_JS | typeof OXC_LANGUAGE_TS;
        preserveParens?: boolean;
    },
) => OxcParseResult;

/** oxc node type of a function declaration. */
export const NODE_KIND_FUNCTION_DECLARATION = 'FunctionDeclaration';
/** oxc node type of a class declaration. */
export const NODE_KIND_CLASS_DECLARATION = 'ClassDeclaration';
/** oxc node type of a function expression. */
export const NODE_KIND_FUNCTION_EXPRESSION = 'FunctionExpression';
/** oxc node type of a method definition. */
export const NODE_KIND_METHOD_DEFINITION = 'MethodDefinition';
/** oxc node type of an object property. */
export const NODE_KIND_PROPERTY = 'Property';
/** oxc node type of a class expression. */
export const NODE_KIND_CLASS_EXPRESSION = 'ClassExpression';
/** oxc node type of an assignment expression. */
export const NODE_KIND_ASSIGNMENT_EXPRESSION = 'AssignmentExpression';
/** oxc node type of a member expression. */
export const NODE_KIND_MEMBER_EXPRESSION = 'MemberExpression';
/** oxc node type of a named export declaration. */
export const NODE_KIND_EXPORT_NAMED_DECLARATION = 'ExportNamedDeclaration';
/** oxc node type of a default export declaration. */
export const NODE_KIND_EXPORT_DEFAULT_DECLARATION = 'ExportDefaultDeclaration';
/** oxc node type of a call expression. */
export const NODE_KIND_CALL_EXPRESSION = 'CallExpression';

/** Type tag string for JavaScript number values. */
export const TYPEOF_NUMBER = 'number';
/** Type tag string for JavaScript string values. */
export const TYPEOF_STRING = 'string';
/** Type tag string for JavaScript object values. */
export const TYPEOF_OBJECT = 'object';

/** Raw oxc node key holding parent reference. */
export const OXC_NODE_KEY_PARENT = 'parent';
/** Raw oxc node key holding AST node type name. */
export const OXC_NODE_KEY_TYPE = 'type';
/** Raw oxc node key holding start offset. */
export const OXC_NODE_KEY_START = 'start';
/** Raw oxc node key holding end offset. */
export const OXC_NODE_KEY_END = 'end';

/** Set of metadata keys ignored during AST child reflection walk. */
export const OXC_META_KEYS = new Set([
    OXC_NODE_KEY_PARENT,
    OXC_NODE_KEY_TYPE,
    OXC_NODE_KEY_START,
    OXC_NODE_KEY_END,
]);

/** Language mode identifier for JavaScript parsing in oxc. */
export const OXC_LANGUAGE_JS = 'js';
/** Language mode identifier for TypeScript parsing in oxc. */
export const OXC_LANGUAGE_TS = 'ts';

/** Set of statement types representing control flow or block structures. */
export const CONTROL_OR_BLOCK = new Set([
    'BlockStatement',
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'SwitchStatement',
    'TryStatement',
]);

/** Set of declaration AST node types appearing at top-level module scope. */
export const TOP_LEVEL_DECL = new Set([
    NODE_KIND_FUNCTION_DECLARATION,
    NODE_KIND_CLASS_DECLARATION,
    'TSInterfaceDeclaration',
    'TSEnumDeclaration',
    'TSTypeAliasDeclaration',
    'TSModuleDeclaration',
    'TSDeclareFunction',
    'VariableDeclaration',
]);

/** Set of AST node types representing function-like units. */
export const FN_TYPES = new Set([
    NODE_KIND_FUNCTION_DECLARATION,
    NODE_KIND_FUNCTION_EXPRESSION,
    'ArrowFunctionExpression',
]);

/** Set of non-semantic or uninteresting AST node types skipped during traversal. */
export const SKIP_TYPES = new Set([
    'Identifier',
    'TemplateElement',
    'PrivateIdentifier',
    'Hashbang',
    'JSXIdentifier',
    'JSXText',
    'JSXNamespacedName',
    'JSXMemberExpression',
    'JSXOpeningFragment',
    'JSXClosingFragment',
    'JSXSpreadAttribute',
    'JSXSpreadChild',
    'ImportAttribute',
    'Super',
    'MetaProperty',
    'TSImportEqualsDeclaration',
    'TSNamespaceExportDeclaration',
    'TSExportAssignment',
    'TSEmptyBodyFunctionExpression',
    'TSAbstractMethodDefinition',
    'TSAbstractPropertyDefinition',
    'TSAbstractAccessorProperty',
    'AccessorProperty',
]);

/** Set of TypeScript type-position AST node types where inner literals are collected. */
export const TYPE_SKIP_TYPES = new Set([
    'TSTypeAnnotation',
    'TSTypeReference',
    'TSNumberKeyword',
    'TSStringKeyword',
    'TSBooleanKeyword',
    'TSAnyKeyword',
    'TSUnknownKeyword',
    'TSNullKeyword',
    'TSUndefinedKeyword',
    'TSVoidKeyword',
    'TSNeverKeyword',
    'TSObjectKeyword',
    'TSBigIntKeyword',
    'TSIntrinsicKeyword',
    'TSSymbolKeyword',
    'TSThisType',
    'TSLiteralType',
    'TSUnionType',
    'TSIntersectionType',
    'TSArrayType',
    'TSTupleType',
    'TSOptionalType',
    'TSRestType',
    'TSTypeOperator',
    'TSIndexedAccessType',
    'TSConditionalType',
    'TSInferType',
    'TSMappedType',
    'TSNamedTupleMember',
    'TSTemplateLiteralType',
    'TSConstructorType',
    'TSFunctionType',
    'TSImportType',
    'TSQualifiedName',
    'TSTypeQuery',
    'TSTypePredicate',
    'TSParenthesizedType',
    'TSJSDocNullableType',
    'TSJSDocNonNullableType',
    'TSJSDocUnknownType',
    'TSTypeParameter',
    'TSTypeParameterDeclaration',
    'TSTypeParameterInstantiation',
    'TSPropertySignature',
    'TSMethodSignature',
    'TSCallSignatureDeclaration',
    'TSConstructSignatureDeclaration',
    'TSIndexSignature',
    'TSInterfaceBody',
    'TSInterfaceHeritage',
    'TSClassImplements',
    'TSExternalModuleReference',
]);

/** ASCII character code for line-feed (\n). */
export const LINE_FEED_CHAR_CODE = 10;

/** Parse context threaded through one file's mapping (adapter stays stateless between files). */
export interface Ctx {
    src: string;
    lineStarts: number[];
}

/**
 * Build the line-start table (\n -> next line start) used for 1-based positions.
 *
 * @param content - Source file content string.
 * @returns Array of character offsets marking the start of each line.
 */
export function computeLineStarts(content: string): number[] {
    const lineStarts: number[] = [];
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === LINE_FEED_CHAR_CODE) lineStarts.push(i + 1);
    }
    return lineStarts;
}
