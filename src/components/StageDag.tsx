import { useMemo } from "react";
import { isSkewed } from "../lib/parser";
import { formatMs } from "../lib/format";
import type { StageSummary } from "../lib/types";

interface StageDagProps {
  stages: StageSummary[];
  selectedStageId: number | null;
  onSelect: (stageId: number) => void;
}

const NODE_W = 150;
const NODE_H = 72;
const GAP_X = 30;
const GAP_Y = 28;
const PAD = 12;

/** Quiet hairline for node borders; severity lives in the dot only. */
const NODE_STROKE = "rgba(238,240,245,0.14)";
const NODE_FILL = "#101d33";
const EDGE = "rgba(163,169,184,0.4)";

type Severity = "critical" | "warning" | "ok";

function severityOf(stage: StageSummary): Severity {
  if (isSkewed(stage) || stage.failedTasks > 0) return "critical";
  if (
    stage.totalDiskBytesSpilled > 0 ||
    stage.totalShuffleReadBytes + stage.totalShuffleWriteBytes >=
      100 * 1024 * 1024
  )
    return "warning";
  return "ok";
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#e5484d",
  warning: "#f5a524",
  ok: "#4cc38a",
};

interface LayoutNode {
  stage: StageSummary;
  x: number;
  y: number;
  depth: number;
  severity: Severity;
}

/** Layered layout: depth = longest parent chain; nodes grouped by depth. */
function layout(stages: StageSummary[]): LayoutNode[] {
  const byId = new Map<number, StageSummary>();
  for (const s of stages) byId.set(s.stageId, s);

  const depthCache = new Map<number, number>();
  const depthOf = (id: number, seen: Set<number>): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const stage = byId.get(id);
    const parents = (stage?.parentIds ?? []).filter((p) => byId.has(p));
    const d =
      parents.length === 0
        ? 0
        : 1 + Math.max(...parents.map((p) => depthOf(p, seen)));
    seen.delete(id);
    depthCache.set(id, d);
    return d;
  };

  const columns = new Map<number, StageSummary[]>();
  for (const s of stages) {
    const d = depthOf(s.stageId, new Set());
    const col = columns.get(d) ?? [];
    col.push(s);
    columns.set(d, col);
  }

  const nodes: LayoutNode[] = [];
  for (const [depth, col] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    col.sort((a, b) => a.stageId - b.stageId);
    col.forEach((stage, i) => {
      nodes.push({
        stage,
        depth,
        x: PAD + depth * (NODE_W + GAP_X),
        y: PAD + i * (NODE_H + GAP_Y),
        severity: severityOf(stage),
      });
    });
  }
  return nodes;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export default function StageDag({
  stages,
  selectedStageId,
  onSelect,
}: StageDagProps) {
  const nodes = useMemo(() => layout(stages), [stages]);
  const byId = useMemo(
    () => new Map(nodes.map((n) => [n.stage.stageId, n])),
    [nodes],
  );

  const width =
    nodes.reduce((m, n) => Math.max(m, n.x + NODE_W), 0) + PAD;
  const height =
    nodes.reduce((m, n) => Math.max(m, n.y + NODE_H), 0) + PAD;

  const edges: { key: string; d: string }[] = [];
  for (const n of nodes) {
    for (const parentId of n.stage.parentIds) {
      const p = byId.get(parentId);
      if (!p) continue;
      const x1 = p.x + NODE_W;
      const y1 = p.y + NODE_H / 2;
      const x2 = n.x;
      const y2 = n.y + NODE_H / 2;
      const mx = (x1 + x2) / 2;
      edges.push({
        key: `${parentId}->${n.stage.stageId}`,
        d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
      });
    }
  }

  if (stages.length === 0) return null;

  return (
    <div className="dag-scroll">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Stage dependency DAG"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE} />
          </marker>
        </defs>

        {edges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            fill="none"
            stroke={EDGE}
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        ))}

        {nodes.map((n) => {
          const color = SEVERITY_COLOR[n.severity];
          const selected = n.stage.stageId === selectedStageId;
          return (
            <g
              key={n.stage.stageId}
              className={`dag-node${selected ? " selected" : ""}`}
              transform={`translate(${n.x}, ${n.y})`}
              onClick={() => onSelect(n.stage.stageId)}
            >
              <title>
                {`Stage ${n.stage.stageId}: ${n.stage.name}\n${n.stage.completedTasks} tasks · ${formatMs(n.stage.durationMs)}`}
              </title>
              {selected && (
                <rect
                  className="dag-ring"
                  x={-3}
                  y={-3}
                  width={NODE_W + 6}
                  height={NODE_H + 6}
                  rx={13}
                />
              )}
              <rect
                className="node-body"
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={NODE_FILL}
                stroke={NODE_STROKE}
                strokeWidth={1.5}
              />
              <circle cx={16} cy={22} r={5} fill={color} />
              <text
                className="dag-label"
                x={30}
                y={27}
                fontSize={13}
                fontWeight={500}
                fill="#eef0f5"
              >
                Stage {n.stage.stageId}
              </text>
              <text
                className="dag-label"
                x={12}
                y={47}
                fontSize={12}
                fill="#a3a9b8"
              >
                {truncate(n.stage.name, 20)}
              </text>
              <text
                className="dag-label dag-meta"
                x={12}
                y={63}
                fontSize={11}
                fill="#7a8296"
              >
                {n.stage.completedTasks} tasks ·{" "}
                {formatMs(n.stage.durationMs)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span>
          <span className="dot" style={{ background: "#e5484d" }} /> Skewed /
          failed tasks
        </span>
        <span>
          <span className="dot" style={{ background: "#f5a524" }} /> Spill or
          shuffle-heavy
        </span>
        <span>
          <span className="dot" style={{ background: "#4cc38a" }} /> Looks
          healthy
        </span>
      </div>
    </div>
  );
}
