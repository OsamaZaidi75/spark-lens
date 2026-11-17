import { isSkewed } from "../lib/parser";
import {
  formatBytes,
  formatMs,
  formatNumber,
  formatRatio,
} from "../lib/format";
import type { StageSummary } from "../lib/types";

interface StageTableProps {
  stages: StageSummary[];
  selectedStageId: number | null;
  onSelect: (stageId: number) => void;
}

function statusBadge(stage: StageSummary) {
  if (isSkewed(stage) || stage.failedTasks > 0) {
    return (
      <span className="badge badge-red">
        {stage.failedTasks > 0 ? "Failed tasks" : "Skewed"}
      </span>
    );
  }
  if (
    stage.totalDiskBytesSpilled > 0 ||
    stage.totalShuffleReadBytes + stage.totalShuffleWriteBytes >=
      100 * 1024 * 1024
  ) {
    return (
      <span className="badge badge-amber">
        {stage.totalDiskBytesSpilled > 0 ? "Spill" : "Shuffle-heavy"}
      </span>
    );
  }
  return <span className="badge badge-green">OK</span>;
}

export default function StageTable({
  stages,
  selectedStageId,
  onSelect,
}: StageTableProps) {
  return (
    <div className="table-wrap">
      <table className="stages">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Name</th>
            <th className="num">Tasks</th>
            <th className="num">Duration</th>
            <th className="num">Median task</th>
            <th className="num">Max task</th>
            <th className="num">Skew</th>
            <th className="num">Shuffle read</th>
            <th className="num">Shuffle write</th>
            <th className="num">Spill (disk)</th>
            <th className="num">GC time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr
              key={`${s.stageId}:${s.attemptId}`}
              className={s.stageId === selectedStageId ? "selected" : ""}
              onClick={() => onSelect(s.stageId)}
            >
              <td>
                <strong>{s.stageId}</strong>
                {s.attemptId > 0 && (
                  <span style={{ color: "var(--text-dim)" }}>
                    {" "}
                    (attempt {s.attemptId})
                  </span>
                )}
              </td>
              <td>
                <div className="stage-name" title={s.name}>
                  {s.name}
                </div>
              </td>
              <td className="num">
                {formatNumber(s.completedTasks)}
                {s.failedTasks > 0 && (
                  <span style={{ color: "var(--red)" }}>
                    {" "}
                    +{s.failedTasks} failed
                  </span>
                )}
              </td>
              <td className="num">{formatMs(s.durationMs)}</td>
              <td className="num">{formatMs(s.medianTaskMs)}</td>
              <td className="num">{formatMs(s.maxTaskMs)}</td>
              <td className="num">{formatRatio(s.skewRatio)}</td>
              <td className="num">{formatBytes(s.totalShuffleReadBytes)}</td>
              <td className="num">{formatBytes(s.totalShuffleWriteBytes)}</td>
              <td className="num">{formatBytes(s.totalDiskBytesSpilled)}</td>
              <td className="num">{formatMs(s.totalGcTimeMs)}</td>
              <td>{statusBadge(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
