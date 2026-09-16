---
name: threejs-essentials
description: Three.js 3D development guide covering scene graphs, geometry/material memory lifecycle, custom shaders, post-processing, and performance optimization.
---

# Three.js 3D Graphics & WebGL Engineering Guide

## 1. Memory Management & Disposal Lifecycle
- **Explicit Garbage Collection**: WebGL textures, geometries, and materials are not managed by JS garbage collector. Always call `.dispose()` on `geometry`, `material`, and `texture` upon component unmount.
- **Object Reuse**: Share and clone geometry/material instances across meshes instead of creating new instances in loops.

## 2. Animation & Render Loop Performance
- **Clock Delta**: Always scale motions by `clock.getDelta()` in `requestAnimationFrame` to ensure frame-rate independent physics and animation.
- **Avoid Object Allocation in Render Loop**: Never instantiate `new THREE.Vector3()` or `new THREE.Matrix4()` inside the render tick; allocate temporary scratch instances outside.

## 3. Lighting, Shadows & Shaders
- **InstancedMesh for Large Collections**: Use `THREE.InstancedMesh` when rendering hundreds/thousands of identical objects (particles, grass, tiles) in a single draw call.
- **Shader Optimization**: Minimize conditional branches (`if/else`) inside GLSL fragment shaders; prefer `step`, `mix`, and `clamp`.

## 4. Canvas & Resize Handling
- **Device Pixel Ratio**: Clamp `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` to avoid extreme performance degradation on ultra-high DPI screens.
