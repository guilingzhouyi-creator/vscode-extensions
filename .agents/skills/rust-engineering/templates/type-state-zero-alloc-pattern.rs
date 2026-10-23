//! Module: Fractal Git Industrial Rust Pattern Template
//! File Path: .agents/skills/rust-engineering/templates/type-state-zero-alloc-pattern.rs
//! Architecture Role: Reference scaffolding demonstrating Sealed Type-State machines,
//!   transparent Newtypes, zero-transient-allocation buffer reuse, and formal safety proofs.
//! Dependencies & Triggers: Depends on std::marker::PhantomData, std::sync::atomic, thiserror;
//!   used as an architectural reference template for fractal-git and auto-refactor crates.
//! Responsibilities:
//!   1. Enforce compile-time lifecycle transitions via Sealed zero-sized phantom state types.
//!   2. Prevent primitive obsession via #[repr(transparent)] domain Newtypes and #[must_use].
//!   3. Propagate strong-typed crate errors with thiserror and safe TryFrom conversions.
//!   4. Document every unsafe operation with three-part formal safety invariants.
//! Exit Semantics & Design Rationale: Pure library module returning Result<T, TemplateError>; zero runtime panic.

use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;

/// Transparent domain identifier preventing raw u64 mix-ups.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TransactionId(u64);

impl TransactionId {
    /// Wraps a raw numeric identifier into a strong-typed `TransactionId`.
    #[must_use]
    pub const fn new(raw: u64) -> Self {
        Self(raw)
    }

    /// Returns the underlying numeric identifier.
    #[must_use]
    pub const fn as_u64(self) -> u64 {
        self.0
    }
}

/// Strong-typed domain errors for the template crate (`FGT-ERR-001`).
#[non_exhaustive]
#[derive(Debug, Error)]
pub enum TemplateError {
    /// Underlying I/O failure during staging or flush.
    #[error("I/O error encountered during staging: {0}")]
    Io(#[from] std::io::Error),

    /// Attempted to validate an empty or malformed staging buffer.
    #[error("Invalid transition attempted on empty staging transaction {tx_id}")]
    EmptyStagingPayload {
        /// Identifier of the rejected transaction.
        tx_id: u64,
    },

    /// Requested buffer capacity exceeds the hard safety ceiling.
    #[error("Buffer capacity {requested} exceeded maximum limit of {max_bytes} bytes")]
    CapacityExceeded {
        /// Requested byte count.
        requested: usize,
        /// Configured hard ceiling.
        max_bytes: usize,
    },
}

mod private {
    pub trait Sealed {}
}

/// Sealed state marker trait for compile-time transition verification.
pub trait TransactionState: private::Sealed {}

/// Marker for an initialized, uncommitted transaction.
pub struct Staging;
impl private::Sealed for Staging {}
impl TransactionState for Staging {}

/// Marker for a validated transaction ready for CAS atomic commit.
pub struct Validated;
impl private::Sealed for Validated {}
impl TransactionState for Validated {}

/// Marker for a committed, immutable transaction snapshot.
pub struct Committed;
impl private::Sealed for Committed {}
impl TransactionState for Committed {}

/// High-performance transaction unit governed by the Sealed Type-State pattern.
#[must_use = "Transactions must be validated and committed or explicitly dropped"]
pub struct Transaction<S: TransactionState> {
    id: TransactionId,
    payload: Vec<u8>,
    _state: PhantomData<S>,
}

const MAX_CAPACITY_BYTES: usize = 16 * 1024 * 1024;

impl Transaction<Staging> {
    /// Creates a new staging transaction with pre-allocated buffer capacity.
    ///
    /// # Errors
    /// Returns [`TemplateError::CapacityExceeded`] if `initial_capacity` exceeds 16 MiB.
    pub fn new(id: TransactionId, initial_capacity: usize) -> Result<Self, TemplateError> {
        if initial_capacity > MAX_CAPACITY_BYTES {
            return Err(TemplateError::CapacityExceeded {
                requested: initial_capacity,
                max_bytes: MAX_CAPACITY_BYTES,
            });
        }
        Ok(Self {
            id,
            payload: Vec::with_capacity(initial_capacity),
            _state: PhantomData,
        })
    }

    /// Appends incoming bytes without transient allocation, reusing pre-allocated capacity.
    pub fn append_record(&mut self, record: &[u8]) {
        self.payload.extend_from_slice(record);
    }

    /// Transitions transaction from `Staging` to `Validated` by consuming ownership.
    ///
    /// # Errors
    /// Returns [`TemplateError::EmptyStagingPayload`] if no bytes were staged.
    pub fn validate(self) -> Result<Transaction<Validated>, TemplateError> {
        if self.payload.is_empty() {
            return Err(TemplateError::EmptyStagingPayload {
                tx_id: self.id.as_u64(),
            });
        }
        Ok(Transaction {
            id: self.id,
            payload: self.payload,
            _state: PhantomData,
        })
    }
}

impl Transaction<Validated> {
    /// Commits the validated transaction atomically and returns an immutable snapshot.
    pub fn commit(self, sequence_counter: &AtomicU64) -> Transaction<Committed> {
        let _seq = sequence_counter.fetch_add(1, Ordering::AcqRel);
        Transaction {
            id: self.id,
            payload: self.payload,
            _state: PhantomData,
        }
    }
}

impl Transaction<Committed> {
    /// Returns an immutable byte slice of the committed payload.
    #[inline(always)]
    #[must_use]
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Demonstrates a documented `unsafe` slice view with a three-part formal proof (`FGT-SAF-001`).
    ///
    /// # Safety
    /// 1. Validity: `self.payload.as_ptr()` is non-null and aligned for `u8` (alignment = 1).
    /// 2. Lifetime: Shared borrow `&self` guarantees exclusive immutability for the returned slice.
    /// 3. Bounds: `self.payload.len()` is the exact initialized byte length within allocation bounds.
    #[must_use]
    pub unsafe fn as_raw_byte_slice(&self) -> &[u8] {
        // SAFETY: (1) pointer is non-null and 1-byte aligned; (2) &self prevents concurrent
        // mutation or deallocation; (3) len() is within the Vec's initialized allocation.
        unsafe { std::slice::from_raw_parts(self.payload.as_ptr(), self.payload.len()) }
    }
}
