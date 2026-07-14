import { useCallback, useState } from "react";
import DepthParticleStudio from "./DepthParticleStudio";
import DissolutionStudio from "./dissolution/DissolutionStudio";
import "./particle-studio.css";

type ParticleEngine = "depth" | "dissolution";

export default function ParticleStudio({ onBack }: { onBack: () => void }) {
  const [engine, setEngine] = useState<ParticleEngine>("depth");
  const [file, setFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const handleExportingChange = useCallback((value: boolean) => setExporting(value), []);

  return <div className="particle-workbench">
    <div className="particle-workbench__engine-switch" aria-label="粒子引擎">
      <button type="button" className={engine === "depth" ? "is-active" : ""} disabled={exporting}
        aria-pressed={engine === "depth"} onClick={() => setEngine("depth")}>深度 3D</button>
      <button type="button" className={engine === "dissolution" ? "is-active" : ""} disabled={exporting}
        aria-pressed={engine === "dissolution"} onClick={() => setEngine("dissolution")}>粒子溶解</button>
    </div>
    {engine === "depth"
      ? <DepthParticleStudio onBack={onBack} file={file} onFileChange={setFile}
          onExportingChange={handleExportingChange} />
      : <DissolutionStudio onBack={onBack} file={file} onFileChange={setFile}
          onExportingChange={handleExportingChange} />}
  </div>;
}
