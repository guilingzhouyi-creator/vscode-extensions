---
name: remotion-best-practices
description: Remotion programmatic video creation guidelines covering composition design, frame-accurate animation, audio-visual synchronization, and asset preloading.
---

# Remotion Video Creation & Programmatic Motion Guide

## 1. Frame-Driven Determinism
- **Use `useCurrentFrame` & `useVideoConfig`**: All animations, transformations, and transitions must be pure mathematical functions of `frame` and `fps`.
- **Avoid Non-Deterministic Timing**: Never use `setTimeout`, `setInterval`, or wall-clock `Date.now()` inside Remotion compositions.

## 2. Interpolation & Physics Springs
- **Spring Animations**: Use `spring({ frame, fps, config: { damping: 10, mass: 0.5 } })` for natural kinetic movement.
- **Clamped Interpolation**: Use `interpolate(frame, [0, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })` to prevent unintended overflow values.

## 3. Sequences, Transitions & Audio Sync
- **Modular Sequences**: Break video timelines into `<Sequence from={0} durationInFrames={60}>` for clean scene isolation.
- **Audio Visualizers**: Use `@remotion/media-utils` with `useAudioData` and `visualizeAudio` for frame-accurate waveform and spectrum rendering.

## 4. Resource Preloading & Performance
- **Preload Assets**: Use `continueRender` and `delayRender` during asset loading (fonts, external images, heavy JSON datasets) to prevent dropped frames during headless rendering.
