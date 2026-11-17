import type { Finding } from "../lib/types";
import { ArrowRightIcon, CheckIcon } from "./icons";

interface FindingsPanelProps {
  findings: Finding[];
  onSelectStage: (stageId: number) => void;
}

export default function FindingsPanel({
  findings,
  onSelectStage,
}: FindingsPanelProps) {
  if (findings.length === 0) {
    return (
      <p className="no-findings">
        <CheckIcon />
        No problems detected — no skewed stages, no spill, no failed tasks,
        and shuffle volumes look reasonable.
      </p>
    );
  }

  return (
    <div>
      {findings.map((f) => (
        <div key={f.id} className={`finding ${f.severity}`}>
          <div className="finding-dot">
            <span />
          </div>
          <div className="finding-body">
            <h4>{f.title}</h4>
            <p>{f.detail}</p>
            {f.stageId !== undefined && (
              <button
                className="finding-link"
                onClick={() => onSelectStage(f.stageId!)}
              >
                Inspect stage {f.stageId}
                <ArrowRightIcon size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
