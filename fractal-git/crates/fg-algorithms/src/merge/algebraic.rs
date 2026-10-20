//! Module: fg-algorithms — Jujutsu-Style Algebraic Merge & First-Class Conflict
//! File Path: crates/fg-algorithms/src/merge/algebraic.rs
//! Architecture Role: Implements Jujutsu-style first-class conflict algebra `AlgebraicMerge<T>`,
//!   representing multi-way tree and content states as odd-order algebraic terms.
//! Dependencies & Triggers: Utilized by three-way merge, rebase, and lockless staging index.
//! Responsibilities: Term cancellation, algebraic composition, and conflict resolution testing.
//! Exit Semantics & Design Rationale: Resolves associativity and commutativity of Git conflicts
//!   without embedding dirty conflict markers into working directory files.

/// Immutable Jujutsu-style algebraic conflict representation.
/// Invariant: An unresolved conflict has `adds.len() == removes.len() + 1`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AlgebraicMerge<T> {
    removes: Vec<T>,
    adds: Vec<T>,
}

impl<T> AlgebraicMerge<T> {
    /// Creates a resolved, non-conflicting single value term.
    pub fn resolved(value: T) -> Self {
        Self {
            removes: Vec::new(),
            adds: vec![value],
        }
    }

    /// Creates an algebraic merge from raw remove and add collections.
    pub fn new(removes: Vec<T>, adds: Vec<T>) -> Self {
        Self { removes, adds }
    }

    /// Read-only access to removed terms (ancestors / bases).
    pub fn removes(&self) -> &[T] {
        &self.removes
    }

    /// Read-only access to added terms (divergent heads).
    pub fn adds(&self) -> &[T] {
        &self.adds
    }

    /// Checks if this term represents an unambiguous resolved value.
    pub fn is_resolved(&self) -> bool {
        self.removes.is_empty() && self.adds.len() == 1
    }

    /// Extracts resolved value if unambiguous, otherwise None.
    pub fn resolved_value(&self) -> Option<&T> {
        if self.is_resolved() {
            self.adds.first()
        } else {
            None
        }
    }

    /// Maps values through a projection function.
    pub fn map<U, F: Fn(&T) -> U>(&self, transform: F) -> AlgebraicMerge<U> {
        AlgebraicMerge {
            removes: self.removes.iter().map(&transform).collect(),
            adds: self.adds.iter().map(&transform).collect(),
        }
    }
}

impl<T: PartialEq + Clone> AlgebraicMerge<T> {
    /// Synthesizes a three-way merge from base, ours, and theirs inputs.
    pub fn from_three_way(base: T, ours: T, theirs: T) -> Self {
        let initial_term = Self {
            removes: vec![base],
            adds: vec![ours, theirs],
        };
        initial_term.simplify()
    }

    /// Simplifies the merge by cancelling identical terms across removes and adds.
    pub fn simplify(mut self) -> Self {
        let mut remove_index = 0;
        while remove_index < self.removes.len() {
            let target_remove = &self.removes[remove_index];
            if let Some(matching_add_index) = self
                .adds
                .iter()
                .position(|add_term| add_term == target_remove)
            {
                self.removes.remove(remove_index);
                self.adds.remove(matching_add_index);
            } else {
                remove_index += 1;
            }
        }

        // If all adds are identical and match count invariant, collapse to single add
        if !self.adds.is_empty()
            && self.adds.iter().all(|term| term == &self.adds[0])
            && self.removes.len() + 1 == self.adds.len()
        {
            let single_val = self.adds[0].clone();
            self.removes.clear();
            self.adds = vec![single_val];
        }

        self
    }

    /// Combines two merges against a common ancestor merge algebraically.
    /// Formula:
    ///   combined_removes = self.removes + other.removes + base.adds
    ///   combined_adds    = self.adds + other.adds + base.removes
    pub fn combine(&self, other: &Self, base: &Self) -> Self {
        let mut combined_removes = self.removes.clone();
        combined_removes.extend(other.removes.iter().cloned());
        combined_removes.extend(base.adds.iter().cloned());

        let mut combined_adds = self.adds.clone();
        combined_adds.extend(other.adds.iter().cloned());
        combined_adds.extend(base.removes.iter().cloned());

        Self {
            removes: combined_removes,
            adds: combined_adds,
        }
        .simplify()
    }
}

impl<T: std::fmt::Display> AlgebraicMerge<T> {
    /// Produces a human-readable summary of the algebraic conflict state.
    pub fn describe(&self) -> String {
        if let Some(resolved_val) = self.resolved_value() {
            format!("Resolved({})", resolved_val)
        } else {
            let removes_str = self
                .removes
                .iter()
                .map(|term| term.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            let adds_str = self
                .adds
                .iter()
                .map(|term| term.to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!("Conflict(removes=[{}], adds=[{}])", removes_str, adds_str)
        }
    }
}
