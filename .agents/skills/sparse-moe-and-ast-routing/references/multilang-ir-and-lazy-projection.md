# Multi-Language Semantic IR, Lazy Projection & Analyzer Pooling Guide

> **Parent Skill**: [sparse-moe-and-ast-routing](../SKILL.md)  
> **Source of Truth**: `auto-refactor/src/core/ast/multilang.ts`, `auto-refactor/src/core/semantic/semanticGraph.ts`, `auto-refactor/src/core/cfg/`, `auto-refactor/src/core/analyzer-pool.ts`

---

## 1. Eight-Language `NormalizedNode` & `SemanticGraph` Matrix

| Language Ecosystem | Primary Parser Backend | `NormalizedNode` Projection | Lazy Graph Capabilities |
| :--- | :--- | :--- | :--- |
| **TypeScript / JavaScript** | `oxc-parser` 0.144.0 (Mode A/B) + `typescript` 5.3 | Full AST + Type-checked symbol bindings | `CFG`, Dominator Tree, `DFG`, `CallGraph` |
| **Python** | `tree-sitter-python` | Functions, classes, async coroutines, type annotations | `CFG`, `CallGraph`, `PYM-*` modern checks |
| **Rust** | `tree-sitter-rust` | Items, `impl` blocks, `unsafe` blocks, lifetimes | `CFG`, `CallGraph`, `RSM-*` & `FGT-*` checks |
| **Go** | `tree-sitter` / Lexical-AST hybrid | Packages, goroutines, error guards, `defer` | `GOM-*` concurrency & error flow |
| **GDScript 4** | Godot 4 GDScript AST adapter | `class_name`, signals, `_process` loops, typed vars | `GDM-*` & `ADV-PRF-002` pool checks |
| **Shell (`.sh` / `.ps1`)** | Shell command & pipeline AST adapter | Subshells, pipelines, variable bindings, flags | Destructive taint chain (`GUARD-DESTR-001`) |
| **YAML / JSON** | Structured config parser | Key-value nodes, CI workflow steps | CI / config governance checks |
| **Markdown (`.md`)** | Fence & link stream parser | Code fences, relative links, headings | `DOC-FEN-001`, `DOC-LNK-001`, `DOC-DUP-001` |

---

## 2. Lazy Projection & Zero-Materialization Rules

1. **Never Materialize Unrequested Graphs**:
   - `ctx.sourceFile`, `ctx.cfg`, `ctx.dfg`, and `ctx.semanticGraph` are lazy getters on `ScanContext`.
   - Stage 0 and Stage 1 analyzers operate strictly on `ctx.rawText`, `ctx.maskedText`, `ctx.lines`, and `ctx.lineFeatures` without triggering AST or CFG construction.
2. **Analyzer Pooling Checklist (`resetState()`)**:
   - Clear all per-file `Map`, `Set`, and array accumulators in `resetState(): void`.
   - Retain precompiled regexes and `WeakMap` option caches across `resetState()` calls so pooled instances allocate zero heap objects between files.
   - See [moe-pooled-analyzer-template.ts](../templates/moe-pooled-analyzer-template.ts) for the canonical implementation pattern.
