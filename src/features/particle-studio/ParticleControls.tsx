import type { ParticleParams } from "./types";

interface ParticleControlsProps {
  params: ParticleParams;
  collapsed: boolean;
  onChange: (params: ParticleParams) => void;
  onReset: () => void;
  onToggleCollapsed: () => void;
}

type NumericKey = Exclude<keyof ParticleParams, "autoRotate" | "backgroundColor">;
type Control = { key: NumericKey; label: string; min: number; max: number; step: number };

const groups: Array<{ title: string; controls: Control[] }> = [
  { title: "图像", controls: [
    { key: "brightnessThreshold", label: "亮度阈值", min: 0, max: 1, step: 0.01 },
    { key: "contrast", label: "对比度", min: 0.2, max: 2.5, step: 0.01 },
    { key: "edgeStrength", label: "边缘增强", min: 0, max: 1, step: 0.01 },
    { key: "alphaThreshold", label: "透明度过滤", min: 0, max: 1, step: 0.01 },
    { key: "saturation", label: "饱和度", min: 0, max: 2, step: 0.01 },
  ] },
  { title: "粒子", controls: [
    { key: "density", label: "粒子密度", min: 0.05, max: 1, step: 0.01 },
    { key: "particleSize", label: "粒子大小", min: 0.4, max: 5, step: 0.1 },
    { key: "scatter", label: "随机散射", min: 0, max: 2, step: 0.01 },
    { key: "driftSpeed", label: "漂浮速度", min: 0, max: 1, step: 0.01 },
  ] },
  { title: "立体", controls: [
    { key: "depthStrength", label: "深度强度", min: 0, max: 8, step: 0.1 },
    { key: "depthSmoothing", label: "深度平滑", min: 0, max: 1, step: 0.01 },
    { key: "depthLayers", label: "Z 轴层数", min: 2, max: 64, step: 1 },
    { key: "rotationSpeed", label: "旋转速度", min: 0, max: 2, step: 0.01 },
  ] },
  { title: "辉光", controls: [
    { key: "bloomStrength", label: "Bloom 强度", min: 0, max: 3, step: 0.01 },
    { key: "bloomRadius", label: "Bloom 半径", min: 0, max: 1, step: 0.01 },
    { key: "bloomThreshold", label: "Bloom 阈值", min: 0, max: 1, step: 0.01 },
  ] },
  { title: "场景", controls: [
    { key: "cameraDistance", label: "相机距离", min: 2.5, max: 10, step: 0.1 },
  ] },
];

export function ParticleControls({ params, collapsed, onChange, onReset, onToggleCollapsed }: ParticleControlsProps) {
  const update = <K extends keyof ParticleParams>(key: K, value: ParticleParams[K]) => onChange({ ...params, [key]: value });
  return (
    <aside className={`particle-controls ${collapsed ? "is-collapsed" : ""}`} aria-label="粒子参数">
      <button className="particle-controls__handle" type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed}>
        <span>{collapsed ? "参数" : "收起"}</span><span aria-hidden="true">{collapsed ? "‹" : "›"}</span>
      </button>
      <div className="particle-controls__body">
        <div className="particle-controls__heading"><div><strong>粒子参数</strong><small>实时 GPU 预览</small></div><button type="button" onClick={onReset}>恢复默认</button></div>
        {groups.map((group) => (
          <fieldset key={group.title} className="particle-controls__group">
            <legend>{group.title}</legend>
            {group.controls.map((control) => (
              <label key={control.key} className="particle-range">
                <span>{control.label}<output>{Number(params[control.key]).toFixed(control.step >= 1 ? 0 : 2)}</output></span>
                <input aria-label={control.label} type="range" min={control.min} max={control.max} step={control.step} value={params[control.key]}
                  onChange={(event) => update(control.key, Number(event.target.value))} />
              </label>
            ))}
            {group.title === "立体" && <label className="particle-toggle"><span>自动旋转</span><input type="checkbox" checked={params.autoRotate} onChange={(event) => update("autoRotate", event.target.checked)} /></label>}
            {group.title === "场景" && <label className="particle-color"><span>背景颜色</span><input type="color" value={params.backgroundColor} onChange={(event) => update("backgroundColor", event.target.value)} /></label>}
          </fieldset>
        ))}
      </div>
    </aside>
  );
}
