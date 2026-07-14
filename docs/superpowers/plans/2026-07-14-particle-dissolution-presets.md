# Particle Dissolution Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把正式粒子工作台收敛为“人像柔边”及五种确认过的溶解效果，同时保留深度、旋转、参数控制和 MP4 导出。

**Architecture:** 继续使用单一 `ParticleRenderer`。类型和预设负责效果选择，Renderer 把效果映射为 GPU uniforms，粒子与图像平面 Shader 共用同一溶解场；普通参数调整不触发 Worker 重建。

**Tech Stack:** React 19, TypeScript, Three.js, GLSL, node:test, Vite.

---

### Task 1: Replace the preset contract

**Files:**
- Modify: `src/features/particle-studio/types.ts`
- Modify: `src/features/particle-studio/presets.ts`
- Modify: `src/features/particle-studio/ParticleStudio.tsx`
- Modify: `tests/particle-studio.test.ts`

- [ ] 将 `PresetId` 改为 `portrait | dust | nebula | linear | fog | fire`。
- [ ] 给 `ParticleParams` 增加 `effectMode`、`dissolveDirection`、`dissolveProgress`、`dissolveBandwidth`。
- [ ] 保留 `portrait` 当前参数，按独立 Demo 参数添加五套效果。
- [ ] 更新预设按钮中文名称和唯一预设契约测试。
- [ ] 运行 `npm run test:particle`，预期预设测试和既有粒子测试通过。

### Task 2: Port the shared dissolve field

**Files:**
- Create: `src/features/particle-studio/effectModes.ts`
- Modify: `src/features/particle-studio/shaders.ts`
- Modify: `src/features/particle-studio/ParticleRenderer.ts`

- [ ] 把字符串效果和方向映射为稳定整数 uniform。
- [ ] 粒子 Shader 使用方向、进度、带宽和多尺度噪声生成过渡带。
- [ ] 图像平面使用相同 dissolve field，保证原图与粒子边界连续。
- [ ] 为灰尘、星云、线性、雾化和火焰添加各自运动；火焰仅在过渡边缘加入橙红高光和热浪。
- [ ] 在 `setParams` 与 `applySurfaceParams` 中同步全部新 uniforms。

### Task 3: Keep controls responsive

**Files:**
- Modify: `src/features/particle-studio/ParticleControls.tsx`
- Modify: `src/features/particle-studio/presets.ts`

- [ ] 在侵蚀边界组加入“侵蚀进度”和“过渡带宽”。
- [ ] 字符串效果字段不进入数值滑杆类型。
- [ ] 确认新效果参数不是结构参数，预设切换与滑杆拖动只更新 uniform。

### Task 4: Verify and commit

**Files:**
- Verify: `src/features/particle-studio/**`
- Verify: `tests/particle-studio.test.ts`

- [ ] 运行 `npm run test:particle`。
- [ ] 运行 `npm run lint`。
- [ ] 运行 `npm run build`。
- [ ] 本地重建 3005，逐个切换六种预设并确认入口可用。
- [ ] 只提交计划、粒子工作台和粒子测试文件，不提交知识库工作区改动。
