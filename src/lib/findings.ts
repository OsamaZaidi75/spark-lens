/**
 * Findings — plain-language callouts derived from parsed stage data.
 * No thresholds are invented per-run: they are constants, documented here.
 */
import { isSkewed } from "./parser";
import { formatBytes, formatMs, formatRatio } from "./format";
import type { Finding, ParsedLog, StageSummary } from "./types";

/** GC time above this share of total executor run time is flagged. */
export const GC_SHARE_THRESHOLD = 0.1;
/** A stage moving this much shuffle data (read + write) is shuffle-heavy. */
export const SHUFFLE_HEAVY_BYTES = 100 * 1024 * 1024; // 100 MB

function stageLabel(stage: StageSummary): string {
  return `Stage ${stage.stageId} — ${stage.name}`;
}

export function computeFindings(log: ParsedLog): Finding[] {
  const findings: Finding[] = [];

  for (const stage of log.stages) {
    // --- Skew ---------------------------------------------------------------
    if (isSkewed(stage)) {
      findings.push({
        id: `skew:${stage.stageId}`,
        severity: "critical",
        kind: "skew",
        title: `Skewed stage: ${stageLabel(stage)}`,
        detail: `Slowest task ran ${formatMs(stage.maxTaskMs)} vs a median of ${formatMs(stage.medianTaskMs)} (${formatRatio(stage.skewRatio)} the median). A few keys are doing most of the work — consider salting the join key or repartitioning on a more even key.`,
        stageId: stage.stageId,
      });
    }

    // --- Spill ----------------------------------------------------------------
    if (stage.totalDiskBytesSpilled > 0) {
      findings.push({
        id: `spill:${stage.stageId}`,
        severity: "warning",
        kind: "spill",
        title: `Disk spill in ${stageLabel(stage)}`,
        detail: `${formatBytes(stage.totalDiskBytesSpilled)} spilled to disk (${formatBytes(stage.totalMemoryBytesSpilled)} in memory). Tasks are running out of executor memory — raise spark.executor.memory or increase partitions so each task holds less data.`,
        stageId: stage.stageId,
      });
    } else if (stage.totalMemoryBytesSpilled > 0) {
      findings.push({
        id: `spill-mem:${stage.stageId}`,
        severity: "info",
        kind: "spill",
        title: `Memory spill in ${stageLabel(stage)}`,
        detail: `${formatBytes(stage.totalMemoryBytesSpilled)} spilled in memory (nothing hit disk yet). Worth watching — it is one bad partition away from disk spill.`,
        stageId: stage.stageId,
      });
    }

    // --- Shuffle-heavy ---------------------------------------------------------
    const shuffleTotal =
      stage.totalShuffleReadBytes + stage.totalShuffleWriteBytes;
    if (shuffleTotal >= SHUFFLE_HEAVY_BYTES) {
      findings.push({
        id: `shuffle:${stage.stageId}`,
        severity: "warning",
        kind: "shuffle",
        title: `Shuffle-heavy: ${stageLabel(stage)}`,
        detail: `Moved ${formatBytes(shuffleTotal)} of shuffle data (read ${formatBytes(stage.totalShuffleReadBytes)}, wrote ${formatBytes(stage.totalShuffleWriteBytes)}). Shuffle is usually the most expensive part of a stage — check whether a broadcast join or fewer wide transformations would cut it down.`,
        stageId: stage.stageId,
      });
    }

    // --- GC --------------------------------------------------------------------
    if (
      stage.totalRunTimeMs > 0 &&
      stage.totalGcTimeMs / stage.totalRunTimeMs >= GC_SHARE_THRESHOLD
    ) {
      const pct = Math.round(
        (stage.totalGcTimeMs / stage.totalRunTimeMs) * 100,
      );
      findings.push({
        id: `gc:${stage.stageId}`,
        severity: "warning",
        kind: "gc",
        title: `High GC time in ${stageLabel(stage)}`,
        detail: `${formatMs(stage.totalGcTimeMs)} of GC across tasks — ${pct}% of executor run time. Heavy object churn or tight memory; consider larger executors or fewer, bigger tasks.`,
        stageId: stage.stageId,
      });
    }

    // --- Failed tasks ------------------------------------------------------------
    if (stage.failedTasks > 0) {
      findings.push({
        id: `failure:${stage.stageId}`,
        severity: "critical",
        kind: "failure",
        title: `${stage.failedTasks} failed task${stage.failedTasks === 1 ? "" : "s"} in ${stageLabel(stage)}`,
        detail: `Spark retried these tasks, but failures usually mean OOM, a bad partition, or a flaky executor. Check the executor logs for the failing task attempts.`,
        stageId: stage.stageId,
      });
    }
  }

  // Longest stage (info, only if there is anything to say)
  const withDuration = log.stages.filter(
    (s) => s.durationMs !== undefined && s.durationMs > 0,
  );
  if (withDuration.length > 1) {
    const longest = withDuration.reduce((a, b) =>
      (b.durationMs ?? 0) > (a.durationMs ?? 0) ? b : a,
    );
    findings.push({
      id: "duration:longest",
      severity: "info",
      kind: "duration",
      title: `Longest stage: ${stageLabel(longest)}`,
      detail: `Took ${formatMs(longest.durationMs)} of wall-clock time. If you only optimise one stage, start here.`,
      stageId: longest.stageId,
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
