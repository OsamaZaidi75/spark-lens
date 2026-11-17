import { isSkewed } from "../lib/parser";
import {
  formatBytes,
  formatMs,
  formatNumber,
  formatRatio,
} from "../lib/format";
import type { StageSummary } from "../lib/types";

interface StageDetailProps {
  stage: StageSummary;
}

const HIST_W = 520;
const HIST_H = 180;
const HIST_PAD = { top: 8, right: 8, bottom: 28, left: 44 };

/** Bucket task durations into a histogram (12 bins). */
function histogram(durations: number[], bins = 12) {
  if (durations.length === 0) return { buckets: [] as number[], max: 0 };
  const max = Math.max(...durations);
  const width = max / bins || 1;
  const buckets = new Array<number>(bins).fill(0);
  for (const d of durations) {
    const i = Math.min(bins - 1, Math.floor(d / width));
    buckets[i]++;
  }
  return { buckets, max };
}

export default function StageDetail({ stage }: StageDetailProps) {
  const { buckets, max } = histogram(stage.taskDurations);
  const peak = Math.max(...buckets, 1);
  const chartW = HIST_W - HIST_PAD.left - HIST_PAD.right;
  const chartH = HIST_H - HIST_PAD.top - HIST_PAD.bottom;
  const barW = chartW / Math.max(buckets.length, 1);

  return (
    <div className="detail-grid">
      <div>
        <div className="detail-metrics">
          <div className="detail-metric">
            <div className="label">Tasks</div>
            <div className="value">{formatNumber(stage.completedTasks)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">Stage duration</div>
            <div className="value">{formatMs(stage.durationMs)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">Median task</div>
            <div className="value">{formatMs(stage.medianTaskMs)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">Max task</div>
            <div className="value">{formatMs(stage.maxTaskMs)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">p95 task</div>
            <div className="value">{formatMs(stage.p95TaskMs)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">Skew (max / median)</div>
            <div
              className="value"
              style={
                isSkewed(stage) ? { color: "var(--red)" } : undefined
              }
            >
              {formatRatio(stage.skewRatio)}
            </div>
          </div>
          <div className="detail-metric">
            <div className="label">Shuffle read</div>
            <div className="value">
              {formatBytes(stage.totalShuffleReadBytes)}
            </div>
          </div>
          <div className="detail-metric">
            <div className="label">Shuffle write</div>
            <div className="value">
              {formatBytes(stage.totalShuffleWriteBytes)}
            </div>
          </div>
          <div className="detail-metric">
            <div className="label">Spill (memory / disk)</div>
            <div className="value">
              {formatBytes(stage.totalMemoryBytesSpilled)} /{" "}
              {formatBytes(stage.totalDiskBytesSpilled)}
            </div>
          </div>
          <div className="detail-metric">
            <div className="label">GC time</div>
            <div className="value">{formatMs(stage.totalGcTimeMs)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">Input</div>
            <div className="value">{formatBytes(stage.totalInputBytes)}</div>
          </div>
          <div className="detail-metric">
            <div className="label">Output</div>
            <div className="value">{formatBytes(stage.totalOutputBytes)}</div>
          </div>
        </div>
        {stage.parentIds.length > 0 && (
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              marginTop: 12,
            }}
          >
            Depends on stage{stage.parentIds.length > 1 ? "s" : ""}{" "}
            {stage.parentIds.join(", ")}.
          </p>
        )}
      </div>

      <div>
        <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
          Task duration distribution
        </h4>
        {buckets.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            No completed tasks with timing data in this stage.
          </p>
        ) : (
          <svg
            className="histogram"
            viewBox={`0 0 ${HIST_W} ${HIST_H}`}
            role="img"
            aria-label={`Histogram of ${stage.taskDurations.length} task durations`}
          >
            {buckets.map((count, i) => {
              const h = (count / peak) * chartH;
              const x = HIST_PAD.left + i * barW;
              const y = HIST_PAD.top + (chartH - h);
              const isTail =
                isSkewed(stage) && i >= buckets.length - 2 && count > 0;
              return (
                <g key={i}>
                  <title>
                    {`${formatMs((i * max) / buckets.length)} – ${formatMs(((i + 1) * max) / buckets.length)}: ${count} task${count === 1 ? "" : "s"}`}
                  </title>
                  <rect
                    x={x + 1}
                    y={y}
                    width={Math.max(barW - 2, 1)}
                    height={h}
                    rx={2}
                    fill={isTail ? "#f87171" : "#f5a524"}
                    opacity={count === 0 ? 0 : 0.9}
                  />
                  {count > 0 && (
                    <text
                      className="bar-label"
                      x={x + barW / 2}
                      y={y - 4}
                      textAnchor="middle"
                    >
                      {count}
                    </text>
                  )}
                </g>
              );
            })}
            <text
              className="axis-label"
              x={HIST_PAD.left}
              y={HIST_H - 8}
            >
              0
            </text>
            <text
              className="axis-label"
              x={HIST_W - HIST_PAD.right}
              y={HIST_H - 8}
              textAnchor="end"
            >
              {formatMs(max)}
            </text>
            <text
              className="axis-label"
              x={HIST_W / 2}
              y={HIST_H - 8}
              textAnchor="middle"
            >
              task duration →
            </text>
          </svg>
        )}
        <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
          {stage.taskDurations.length} completed tasks. A long right tail (red
          bars) means a few tasks ran far longer than the rest — the classic
          sign of skew.
        </p>
      </div>
    </div>
  );
}
