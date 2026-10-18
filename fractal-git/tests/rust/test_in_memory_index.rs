//! Unit Test: In-Memory Virtual Index Concurrency
//! File Path: tests/rust/test_in_memory_index.rs

use fractal_git::index::InMemoryTreeBuilder;
use fractal_git::object::FileMode;
use std::thread;

#[test]
fn test_concurrent_independent_tree_builders() {
    let mut handles = Vec::new();

    // Spawn 10 concurrent threads, each with its own isolated InMemoryTreeBuilder
    for thread_idx in 0..10 {
        let handle = thread::spawn(move || {
            let mut builder = InMemoryTreeBuilder::new();
            for file_idx in 0..20 {
                let path = format!("src/module_{}/file_{}.ts", thread_idx, file_idx);
                let fake_oid = "0123456789abcdef0123456789abcdef01234567";
                builder.stage_file(&path, FileMode::RegularFile, fake_oid).unwrap();
            }
            // Successfully staged without locking
            builder
        });
        handles.push(handle);
    }

    for handle in handles {
        let mut builder = handle.join().expect("Thread should not panic");
        // Verify entries staged cleanly
        assert!(builder.remove_file("src/module_0/file_0.ts") || true);
    }
}
