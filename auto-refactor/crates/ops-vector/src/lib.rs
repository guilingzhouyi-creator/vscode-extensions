//! Module: Native Acceleration Kernel — Vector Space & Code Density Geometry
//! Crate: ops-vector
//! Architecture Role: High-performance linear algebra and metric space primitives for
//!   code density vector space projection, cosine similarity, Euclidean distance,
//!   and spatial clustering.

/// Computes inner dot product between two slices: \sum a_i * b_i.
/// Uses 4-way loop unrolling for cache pipeline saturation.
pub fn dot_product(a: &[f64], b: &[f64]) -> f64 {
    let len = a.len().min(b.len());
    let mut sum0 = 0.0;
    let mut sum1 = 0.0;
    let mut sum2 = 0.0;
    let mut sum3 = 0.0;

    let chunks = len / 4;
    for i in 0..chunks {
        let idx = i * 4;
        sum0 += a[idx] * b[idx];
        sum1 += a[idx + 1] * b[idx + 1];
        sum2 += a[idx + 2] * b[idx + 2];
        sum3 += a[idx + 3] * b[idx + 3];
    }

    let remainder = chunks * 4;
    let mut rem_sum = 0.0;
    for i in remainder..len {
        rem_sum += a[i] * b[i];
    }

    sum0 + sum1 + sum2 + sum3 + rem_sum
}

/// Computes Euclidean norm (L2 norm) of a vector: \sqrt{\sum a_i^2}.
pub fn euclidean_norm(a: &[f64]) -> f64 {
    dot_product(a, a).sqrt()
}

/// Computes Euclidean distance between two vectors: \sqrt{\sum (a_i - b_i)^2}.
pub fn euclidean_distance(a: &[f64], b: &[f64]) -> f64 {
    let len = a.len().min(b.len());
    let mut diff_sum = 0.0;
    for i in 0..len {
        let diff = a[i] - b[i];
        diff_sum += diff * diff;
    }
    diff_sum.sqrt()
}

/// Computes Manhattan distance (L1 norm) between two vectors: \sum |a_i - b_i|.
pub fn manhattan_distance(a: &[f64], b: &[f64]) -> f64 {
    let len = a.len().min(b.len());
    let mut sum = 0.0;
    for i in 0..len {
        sum += (a[i] - b[i]).abs();
    }
    sum
}

/// Computes Cosine Similarity between two vectors: (a \cdot b) / (||a|| * ||b||).
/// Returns 1.0 for identical zero vectors, or 0.0 if either norm is zero.
pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let norm_a = euclidean_norm(a);
    let norm_b = euclidean_norm(b);

    if norm_a < 1e-12 && norm_b < 1e-12 {
        return 1.0;
    }
    if norm_a < 1e-12 || norm_b < 1e-12 {
        return 0.0;
    }

    let dot = dot_product(a, b);
    let sim = dot / (norm_a * norm_b);
    sim.clamp(-1.0, 1.0)
}

/// Normalizes a vector to unit length (L2 norm = 1.0).
/// Returns a zero vector if the input norm is near zero.
pub fn normalize_l2(a: &[f64]) -> Vec<f64> {
    let norm = euclidean_norm(a);
    if norm < 1e-12 {
        return vec![0.0; a.len()];
    }
    a.iter().map(|&x| x / norm).collect()
}

/// Computes the arithmetic centroid (center of mass) of an ensemble of vectors.
pub fn compute_centroid(vectors: &[Vec<f64>]) -> Vec<f64> {
    if vectors.is_empty() {
        return Vec::new();
    }
    let dim = vectors[0].len();
    if dim == 0 {
        return Vec::new();
    }

    let mut centroid = vec![0.0; dim];
    let mut count = 0usize;

    for v in vectors {
        if v.len() == dim {
            count += 1;
            for i in 0..dim {
                centroid[i] += v[i];
            }
        }
    }

    if count == 0 {
        return centroid;
    }

    let n = count as f64;
    for val in &mut centroid {
        *val /= n;
    }

    centroid
}

/// Determines whether a vector is an outlier relative to a reference centroid and distance threshold.
pub fn is_spatial_outlier(point: &[f64], centroid: &[f64], max_radius: f64) -> bool {
    let dist = euclidean_distance(point, centroid);
    dist > max_radius
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dot_product_unrolled() {
        let v1 = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let v2 = vec![2.0, 3.0, 4.0, 5.0, 6.0];
        // 1*2 + 2*3 + 3*4 + 4*5 + 5*6 = 2 + 6 + 12 + 20 + 30 = 70
        assert_eq!(dot_product(&v1, &v2), 70.0);
    }

    #[test]
    fn test_euclidean_distance_and_norm() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![3.0, 4.0, 0.0];
        assert_eq!(euclidean_norm(&b), 5.0);
        assert_eq!(euclidean_distance(&a, &b), 5.0);
        assert_eq!(manhattan_distance(&a, &b), 7.0);
    }

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert_eq!(cosine_similarity(&a, &b), 1.0);

        let orthogonal = vec![0.0, 1.0, 0.0];
        assert_eq!(cosine_similarity(&a, &orthogonal), 0.0);

        let opposite = vec![-1.0, 0.0, 0.0];
        assert_eq!(cosine_similarity(&a, &opposite), -1.0);
    }

    #[test]
    fn test_normalize_l2() {
        let v = vec![3.0, 4.0];
        let unit = normalize_l2(&v);
        assert_eq!(unit, vec![0.6, 0.8]);
        assert_eq!(euclidean_norm(&unit), 1.0);
    }

    #[test]
    fn test_centroid_and_outlier() {
        let ensemble = vec![vec![1.0, 2.0], vec![3.0, 4.0], vec![2.0, 3.0]];
        let centroid = compute_centroid(&ensemble);
        assert_eq!(centroid, vec![2.0, 3.0]);

        // Point (2, 3) distance is 0 -> not an outlier
        assert!(!is_spatial_outlier(&[2.0, 3.0], &centroid, 1.0));
        // Point (10, 10) distance is ~10 > 1.0 -> outlier
        assert!(is_spatial_outlier(&[10.0, 10.0], &centroid, 1.0));
    }
}
