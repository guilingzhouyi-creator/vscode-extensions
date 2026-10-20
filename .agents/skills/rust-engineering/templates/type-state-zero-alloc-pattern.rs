//! Module: Fractal Git Industrial Rust Pattern Template
//! File Path: .agents/skills/rust-engineering/templates/type-state-zero-alloc-pattern.rs
//! Architecture Role: Reference scaffolding demonstrating type-state zero-cost state machines,
//!   zero-transient-allocation buffer borrowing, and strict safety proof discipline.
//! Responsibilities:
//!   1. Enforce compile-time lifecycle transitions via zero-sized phantom state types.
//!   2. Eliminate hot-loop allocations using reusable capacity-preserved buffers.
//!   3. Propagate strong-typed crate errors with thiserror derivation.
//!   4. Document every unsafe operation with formal safety invariants.

use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;

/// Strong-typed domain errors for the template crate.
#[derive(Debug, Error)]
pub enum TemplateError {
    #[error("I/O error encountered during staging: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid transition attempted on active transaction")]
    InvalidStateTransition,

    #[error("Buffer capacity exceeded maximum limit of {max_bytes} bytes")]
    CapacityExceeded { max_bytes: usize },
}

/// State marker trait for compile-time transition verification.
pub trait TransactionState {}

/// Marker for an initialized, uncommitted transaction.
pub struct Staging;
impl TransactionState for Staging {}

/// Marker for a validated transaction ready for CAS atomic commit.
pub struct Validated;
impl TransactionState for Validated {}

/// Marker for a committed, immutable transaction snapshot.
pub struct Committed;
impl TransactionState for Committed {}

/// High-performance transaction unit governed by the Type-State pattern.
pub struct Transaction<S: TransactionState> {
    id: u64,
    payload: Vec<u8>,
    _state: PhantomData<S>,
}

impl Transaction<Staging> {
    /// Creates a new staging transaction with pre-allocated buffer capacity.
    ///
    /// # Errors
    /// Returns [`TemplateError::CapacityExceeded`] if `initial_capacity` exceeds 16MB.
    ///
    /// # Examples
    /// ```rust
    /// use type_state_zero_alloc_pattern::{Transaction, Staging};
    /// let tx = Transaction::new(1001, 4096).unwrap();
    /// ```
    pub fn new(id: u64, initial_capacity: usize) -> Result<Self, TemplateError> {
        if initial_capacity > 16 * 1024 * 1024 {
            return Err(TemplateError::CapacityExceeded {
                max_bytes: 16 * 1024 * 1024,
            });
        }
        Ok(Self {
            id,
            payload: Vec::with_capacity(initial_capacity),
            _state: PhantomData,
        })
    }

    /// Appends incoming bytes without transient allocation, reusing existing capacity.
    pub fn append_record(&mut self, record: &[u8]) {
        self.payload.extend_from_slice(record);
    }

    /// Transitions transaction from Staging to Validated state by consuming ownership.
    ///
    /// This method enforces compile-time state advancement: the staging instance
    /// cannot be used once transitioned.
    pub fn validate(self) -> Result<Transaction<Validated>, TemplateError> {
        if self.payload.is_empty() {
            return Err(TemplateError::InvalidStateTransition);
        }
        Ok(Transaction {
            id: self.id,
            payload: self.payload,
            _state: PhantomData,
        })
    }
}

impl Transaction<Validated> {
    /// Commits the validated transaction atomically.
    ///
    /// Consumes the validated transaction and returns an immutable committed snapshot.
    pub fn commit(self, sequence_counter: &AtomicU64) -> Transaction<Committed> {
        let seq = sequence_counter.fetch_add(1, Ordering::SeqCst);
        let _ = seq;
        Transaction {
            id: self.id,
            payload: self.payload,
            _state: PhantomData,
        }
    }
}

impl Transaction<Committed> {
    /// Returns an immutable borrow of the committed payload.
    #[inline(always)]
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Demonstrates safe, documented unsafe slice casting with boundary proof.
    ///
    /// # Safety
    /// 1. `self.payload` is guaranteed valid and non-null for `self.payload.len()` bytes.
    /// 2. Alignment requirement of `u8` is 1, which trivially holds for any byte pointer.
    /// 3. The returned lifetime is strictly bound to `&self`, preventing use-after-free.
    pub unsafe fn as_raw_byte_slice(&self) -> &[u8] {
        // SAFETY: self.payload is an allocated Vec<u8> whose pointer is valid and non-null
        // for self.payload.len() continuous bytes, and lifetime is bounded by &self.
        std::slice::from_raw_parts(self.payload.as_ptr(), self.payload.len())
    }
}
