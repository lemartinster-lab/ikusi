import { STAGE_LABEL, type AiProgress } from "../lib/aiApi";

interface Props {
  progress: AiProgress | null;
  /** Texto mientras arranca, antes del primer aviso de progreso. */
  starting: string;
  onCancel: () => void;
}

export function AiTaskToast({ progress, starting, onCancel }: Props) {
  const pct = progress ? Math.round(progress.percent) : null;
  return (
    <div className="ai-toast" role="status" onDoubleClick={(e) => e.stopPropagation()}>
      <div className="ai-toast-row">
        <span>{progress ? STAGE_LABEL[progress.stage] : starting}…</span>
        <span className="muted">{pct != null ? `${pct} %` : ""}</span>
        <button className="text-btn" onClick={onCancel}>Cancelar</button>
      </div>
      <div className="ai-bar">
        <div className={`ai-bar-fill ${pct == null ? "indeterminate" : ""}`} style={{ width: `${pct ?? 30}%` }} />
      </div>
    </div>
  );
}
