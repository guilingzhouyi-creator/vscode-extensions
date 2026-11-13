//! Module: Native Acceleration Kernel — Flat Scope Arena & Symbol Interner
//! Crate: ops-scope
//! Architecture Role: High-performance flat scope graph representation, symbol interner,
//! and integer-based variable shadowing detector providing 100% parity with AST ScopeGraph.

use std::collections::HashMap;

/// High-performance symbol interner mapping string slices to contiguous u32 identifiers.
#[derive(Debug, Default, Clone)]
pub struct SymbolInterner {
    map: HashMap<String, u32>,
    symbols: Vec<String>,
}

impl SymbolInterner {
    /// Creates a new empty symbol interner.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates a symbol interner with pre-allocated capacity.
    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            map: HashMap::with_capacity(capacity),
            symbols: Vec::with_capacity(capacity),
        }
    }

    /// Interns a string identifier, returning its contiguous u32 index.
    pub fn intern(&mut self, name: &str) -> u32 {
        if let Some(&id) = self.map.get(name) {
            return id;
        }
        let id = self.symbols.len() as u32;
        let owned = name.to_string();
        self.map.insert(owned.clone(), id);
        self.symbols.push(owned);
        id
    }

    /// Resolves an interned u32 identifier back to its original string slice.
    #[must_use]
    pub fn resolve(&self, id: u32) -> Option<&str> {
        self.symbols.get(id as usize).map(|s| s.as_str())
    }

    /// Returns the total number of unique symbols registered.
    #[must_use]
    pub fn len(&self) -> usize {
        self.symbols.len()
    }

    /// Returns true if the interner has not registered any symbols.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.symbols.is_empty()
    }
}

/// Scope boundary kinds aligned with Language AST semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ScopeKind {
    Module = 0,
    Function = 1,
    Class = 2,
    Block = 3,
}

impl ScopeKind {
    /// Converts a u8 representation into a ScopeKind enum.
    #[must_use]
    pub fn from_u8(val: u8) -> Self {
        match val {
            1 => ScopeKind::Function,
            2 => ScopeKind::Class,
            3 => ScopeKind::Block,
            _ => ScopeKind::Module,
        }
    }
}

/// Binding declaration kinds aligned with AST BindingKind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum BindingKind {
    Variable = 0,
    Constant = 1,
    Function = 2,
    Class = 3,
    Parameter = 4,
    Import = 5,
}

impl BindingKind {
    /// Converts a u8 representation into a BindingKind enum.
    #[must_use]
    pub fn from_u8(val: u8) -> Self {
        match val {
            1 => BindingKind::Constant,
            2 => BindingKind::Function,
            3 => BindingKind::Class,
            4 => BindingKind::Parameter,
            5 => BindingKind::Import,
            _ => BindingKind::Variable,
        }
    }
}

/// A compact, contiguous scope node stored within the arena.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeNode {
    pub id: u32,
    pub parent: Option<u32>,
    pub kind: ScopeKind,
    pub start_line: u32,
    pub end_line: u32,
}

/// A single binding record in the arena.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeBinding {
    pub scope_id: u32,
    pub symbol_id: u32,
    pub kind: BindingKind,
    pub line: u32,
}

/// Output item representing a detected variable shadowing incident.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShadowingDefect {
    pub symbol: String,
    pub inner_scope_id: u32,
    pub inner_line: u32,
    pub outer_scope_id: u32,
    pub outer_line: u32,
    pub binding_kind: u8,
}

/// Scope boundary descriptor parameter object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScopeDescriptor {
    pub parent: Option<u32>,
    pub kind: ScopeKind,
    pub start_line: u32,
    pub end_line: u32,
}

impl ScopeDescriptor {
    #[must_use]
    pub const fn new(parent: Option<u32>, kind: ScopeKind, start_line: u32, end_line: u32) -> Self {
        Self {
            parent,
            kind,
            start_line,
            end_line,
        }
    }
}

/// Scope binding declaration parameter object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BindingDeclaration<'a> {
    pub scope_id: u32,
    pub symbol_name: &'a str,
    pub kind: BindingKind,
    pub line: u32,
}

impl<'a> BindingDeclaration<'a> {
    #[must_use]
    pub const fn new(scope_id: u32, symbol_name: &'a str, kind: BindingKind, line: u32) -> Self {
        Self {
            scope_id,
            symbol_name,
            kind,
            line,
        }
    }
}

/// Contiguous Flat Arena hosting the full hierarchy of scopes and declaration bindings.
#[derive(Debug, Default, Clone)]
pub struct FlatScopeArena {
    pub interner: SymbolInterner,
    pub scopes: Vec<ScopeNode>,
    pub bindings: Vec<ScopeBinding>,
    scope_children: Vec<Vec<u32>>,
    scope_bindings: Vec<Vec<u32>>,
}

impl FlatScopeArena {
    /// Creates an empty scope arena.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Pre-allocates memory for scopes and bindings.
    #[must_use]
    pub fn with_capacity(scope_cap: usize, binding_cap: usize) -> Self {
        Self {
            interner: SymbolInterner::with_capacity(binding_cap),
            scopes: Vec::with_capacity(scope_cap),
            bindings: Vec::with_capacity(binding_cap),
            scope_children: Vec::with_capacity(scope_cap),
            scope_bindings: Vec::with_capacity(scope_cap),
        }
    }

    /// Registers a new scope boundary via structured descriptor, returning its unique scope ID.
    pub fn add_scope_descriptor(&mut self, desc: ScopeDescriptor) -> u32 {
        let id = self.scopes.len() as u32;
        self.scopes.push(ScopeNode {
            id,
            parent: desc.parent,
            kind: desc.kind,
            start_line: desc.start_line,
            end_line: desc.end_line,
        });
        self.scope_children.push(Vec::new());
        self.scope_bindings.push(Vec::new());

        if let Some(parent_id) = desc.parent {
            if let Some(children) = self.scope_children.get_mut(parent_id as usize) {
                children.push(id);
            }
        }
        id
    }

    /// Registers a new scope boundary in the arena (convenience forwarder).
    pub fn add_scope(
        &mut self,
        parent: Option<u32>,
        kind: ScopeKind,
        start_line: u32,
        end_line: u32,
    ) -> u32 {
        self.add_scope_descriptor(ScopeDescriptor::new(parent, kind, start_line, end_line))
    }

    /// Registers a binding declaration under a specific scope ID using structured parameter object.
    pub fn add_binding_declaration(&mut self, decl: BindingDeclaration<'_>) {
        let symbol_id = self.interner.intern(decl.symbol_name);
        let binding_idx = self.bindings.len() as u32;
        self.bindings.push(ScopeBinding {
            scope_id: decl.scope_id,
            symbol_id,
            kind: decl.kind,
            line: decl.line,
        });
        if (decl.scope_id as usize) >= self.scope_bindings.len() {
            self.scope_bindings
                .resize(decl.scope_id as usize + 1, Vec::new());
        }
        self.scope_bindings[decl.scope_id as usize].push(binding_idx);
    }

    /// Registers a binding declaration under a specific scope ID (convenience forwarder).
    pub fn add_binding(&mut self, scope_id: u32, symbol_name: &str, kind: BindingKind, line: u32) {
        self.add_binding_declaration(BindingDeclaration::new(scope_id, symbol_name, kind, line));
    }

    /// Looks up a symbol starting from a given scope and walking up ancestor scopes.
    /// Returns binding line numbers matching the symbol (closest first).
    #[must_use]
    pub fn lookup(&self, scope_id: u32, symbol_name: &str) -> Vec<u32> {
        let Some(&symbol_id) = self.interner.map.get(symbol_name) else {
            return Vec::new();
        };

        let mut matching_lines = Vec::new();
        let mut curr = Some(scope_id);

        while let Some(sid) = curr {
            if let Some(binding_indices) = self.scope_bindings.get(sid as usize) {
                for &b_idx in binding_indices {
                    let b = &self.bindings[b_idx as usize];
                    if b.symbol_id == symbol_id {
                        matching_lines.push(b.line);
                    }
                }
            }
            curr = self.scopes.get(sid as usize).and_then(|s| s.parent);
        }

        matching_lines
    }

    /// Checks if a symbol is shadowed in ancestor scopes starting from the given scope.
    #[must_use]
    pub fn is_shadowed(&self, scope_id: u32, symbol_name: &str) -> bool {
        self.lookup(scope_id, symbol_name).len() > 1
    }

    /// Discovers the innermost scope encompassing the given 1-based line number.
    #[must_use]
    pub fn scope_at_line(&self, line: u32) -> Option<u32> {
        if self.scopes.is_empty() {
            return None;
        }
        self.find_innermost(0, line)
    }

    fn find_innermost(&self, current_id: u32, line: u32) -> Option<u32> {
        let scope = self.scopes.get(current_id as usize)?;
        if line < scope.start_line || (scope.end_line > 0 && line > scope.end_line) {
            return None;
        }

        if let Some(children) = self.scope_children.get(current_id as usize) {
            for &child_id in children {
                if let Some(inner) = self.find_innermost(child_id, line) {
                    return Some(inner);
                }
            }
        }

        Some(current_id)
    }

    fn collect_ancestor_shadowing(
        &self,
        binding: &ScopeBinding,
        ancestor_id: u32,
        defects: &mut Vec<ShadowingDefect>,
    ) {
        let Some(ancestor_binding_indices) = self.scope_bindings.get(ancestor_id as usize) else {
            return;
        };
        for &b_idx in ancestor_binding_indices {
            let outer = &self.bindings[b_idx as usize];
            if outer.symbol_id != binding.symbol_id {
                continue;
            }
            let symbol_str = self
                .interner
                .resolve(binding.symbol_id)
                .unwrap_or_default()
                .to_string();
            defects.push(ShadowingDefect {
                symbol: symbol_str,
                inner_scope_id: binding.scope_id,
                inner_line: binding.line,
                outer_scope_id: outer.scope_id,
                outer_line: outer.line,
                binding_kind: binding.kind as u8,
            });
        }
    }

    /// Single-pass batch detection of all variable shadowing incidents across the entire arena.
    #[must_use]
    pub fn detect_all_shadowing(&self) -> Vec<ShadowingDefect> {
        let mut defects = Vec::new();

        for binding in &self.bindings {
            let mut curr = self
                .scopes
                .get(binding.scope_id as usize)
                .and_then(|scope| scope.parent);
            while let Some(ancestor_id) = curr {
                self.collect_ancestor_shadowing(binding, ancestor_id, &mut defects);
                curr = self
                    .scopes
                    .get(ancestor_id as usize)
                    .and_then(|scope| scope.parent);
            }
        }

        defects
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symbol_interner_idempotence() {
        let mut interner = SymbolInterner::new();
        let a1 = interner.intern("count");
        let a2 = interner.intern("total");
        let a3 = interner.intern("count");

        assert_eq!(a1, a3);
        assert_ne!(a1, a2);
        assert_eq!(interner.resolve(a1), Some("count"));
        assert_eq!(interner.resolve(a2), Some("total"));
        assert_eq!(interner.len(), 2);
    }

    #[test]
    fn test_scope_hierarchy_and_shadowing() {
        let mut arena = FlatScopeArena::new();
        // Scope 0: Module [1..100]
        let root = arena.add_scope(None, ScopeKind::Module, 1, 100);
        arena.add_binding(root, "x", BindingKind::Variable, 5);

        // Scope 1: Function [10..50], parent: 0
        let fn_scope = arena.add_scope(Some(root), ScopeKind::Function, 10, 50);
        arena.add_binding(fn_scope, "y", BindingKind::Variable, 15);
        arena.add_binding(fn_scope, "x", BindingKind::Variable, 20); // Shadows outer x!

        assert!(arena.is_shadowed(fn_scope, "x"));
        assert!(!arena.is_shadowed(fn_scope, "y"));
        assert!(!arena.is_shadowed(root, "x"));

        let lookup_x = arena.lookup(fn_scope, "x");
        assert_eq!(lookup_x, vec![20, 5]);

        let defects = arena.detect_all_shadowing();
        assert_eq!(defects.len(), 1);
        assert_eq!(defects[0].symbol, "x");
        assert_eq!(defects[0].inner_line, 20);
        assert_eq!(defects[0].outer_line, 5);
    }

    #[test]
    fn test_scope_at_line_innermost() {
        let mut arena = FlatScopeArena::new();
        let root = arena.add_scope(None, ScopeKind::Module, 1, 100);
        let fn1 = arena.add_scope(Some(root), ScopeKind::Function, 10, 50);
        let fn2 = arena.add_scope(Some(fn1), ScopeKind::Function, 20, 30);

        assert_eq!(arena.scope_at_line(5), Some(root));
        assert_eq!(arena.scope_at_line(15), Some(fn1));
        assert_eq!(arena.scope_at_line(25), Some(fn2));
        assert_eq!(arena.scope_at_line(35), Some(fn1));
        assert_eq!(arena.scope_at_line(80), Some(root));
        assert_eq!(arena.scope_at_line(150), None);
    }

    #[test]
    fn test_large_scale_arena_performance() {
        let mut arena = FlatScopeArena::with_capacity(100, 1000);
        for i in 0..100 {
            let parent = if i == 0 { None } else { Some((i - 1) / 3) };
            arena.add_scope(parent, ScopeKind::Function, i * 20 + 1, (i + 1) * 20);
        }
        for s in 0..100 {
            for b in 0..10 {
                let name = format!("var_sym_{}", b % 6);
                arena.add_binding(s, &name, BindingKind::Variable, s * 20 + b + 2);
            }
        }

        let start = std::time::Instant::now();
        let defects = arena.detect_all_shadowing();
        let elapsed = start.elapsed();
        println!(
            "[Rust Benchmark] 1000 bindings detect_all_shadowing: {:?}",
            elapsed
        );
        assert!(!defects.is_empty());
    }
}
