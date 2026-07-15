import { useMemo, useState } from "react";
import type { ExportAnimationField, SavedExportAnimationValue } from "./exportAnimation";
import { clampExportValue } from "./exportAnimation";
import "./particle-export-animation.css";

interface ParticleExportAnimationDialogProps<K extends string> {
  fields: readonly ExportAnimationField<K>[];
  values: Record<K, number>;
  config: readonly SavedExportAnimationValue<K>[];
  onCancel: () => void;
  onConfirm: (config: SavedExportAnimationValue<K>[]) => void;
}

export function ParticleExportAnimationDialog<K extends string>({
  fields,
  values,
  config,
  onCancel,
  onConfirm,
}: ParticleExportAnimationDialogProps<K>) {
  const [enabled, setEnabled] = useState<Set<K>>(() => new Set(config.map((item) => item.key)));
  const savedTargets = useMemo(() => new Map(config.map((item) => [item.key, item.to])), [config]);
  const [targets, setTargets] = useState<Record<K, string>>(() => Object.fromEntries(
    fields.map((field) => [field.key, String(savedTargets.get(field.key) ?? values[field.key])]),
  ) as Record<K, string>);
  const errors = useMemo(() => new Set(fields.filter((field) => {
    if (!enabled.has(field.key)) return false;
    return !Number.isFinite(Number(targets[field.key]));
  }).map((field) => field.key)), [enabled, fields, targets]);

  const confirm = (): void => {
    if (errors.size > 0) return;
    onConfirm(fields.flatMap((field) => {
      if (!enabled.has(field.key)) return [];
      return [{
        key: field.key,
        to: clampExportValue(Number(targets[field.key]), field.min, field.max),
      }];
    }));
  };

  return <div className="particle-export-dialog" role="dialog" aria-modal="true" aria-labelledby="particle-export-title">
    <div className="particle-export-dialog__panel">
      <header>
        <div><strong id="particle-export-title">动画参数设置</strong><small>播放预览与 MP4 导出共用</small></div>
        <button type="button" onClick={onCancel} aria-label="关闭">×</button>
      </header>
      <p>勾选需要变化的参数并设置结束值。保存一次后，播放预览和 MP4 导出都会直接使用。</p>
      <div className="particle-export-dialog__table">
        <div className="particle-export-dialog__labels"><span>启用 / 参数</span><span>当前</span><span>结束</span></div>
        {fields.map((field) => {
          const checked = enabled.has(field.key);
          return <label key={field.key} className={checked ? "is-enabled" : ""}>
            <span><input type="checkbox" checked={checked} onChange={(event) => setEnabled((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(field.key); else next.delete(field.key);
              return next;
            })} />{field.label}</span>
            <output>{values[field.key]}</output>
            <span><input type="number" disabled={!checked} min={field.min} max={field.max} step={field.step}
              value={targets[field.key]} onChange={(event) => setTargets((current) => ({ ...current, [field.key]: event.target.value }))} />
              {errors.has(field.key) && <small>请输入数字</small>}
            </span>
          </label>;
        })}
      </div>
      <footer>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" className="is-primary" disabled={errors.size > 0} onClick={confirm}>保存设置</button>
      </footer>
    </div>
  </div>;
}
