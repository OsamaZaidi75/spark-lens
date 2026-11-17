/**
 * Types for SparkLens — a client-side Spark event log visualizer.
 *
 * Spark event logs are JSON-lines files. Event keys contain spaces
 * (e.g. "Stage Info", "Task Metrics") and many fields are optional,
 * so every consumer must treat fields as possibly absent.
 */

/** One task's metrics, as aggregated from a SparkListenerTaskEnd event. */
export interface TaskRecord {
  taskId: number;
  index: number;
  attempt: number;
  executorId: string;
  host: string;
  failed: boolean;
  launchTime?: number;
  finishTime?: number;
  /** Executor Run Time (ms) — the main per-task duration signal. */
  runTimeMs: number;
  cpuTimeMs: number;
  gcTimeMs: number;
  memoryBytesSpilled: number;
  diskBytesSpilled: number;
  shuffleReadBytes: number;
  shuffleReadRecords: number;
  shuffleWriteBytes: number;
  shuffleWriteRecords: number;
  inputBytes: number;
  inputRecords: number;
  outputBytes: number;
  outputRecords: number;
}

/** Aggregated view of one stage (identified by stage id + attempt id). */
export interface StageSummary {
  stageId: number;
  attemptId: number;
  name: string;
  details: string;
  parentIds: number[];
  /** Declared number of tasks (from StageSubmitted), if known. */
  numTasks?: number;
  submissionTime?: number;
  completionTime?: number;
  /** Wall-clock stage duration in ms (completion - submission), if known. */
  durationMs?: number;
  tasks: TaskRecord[];
  /** Completed (non-failed) task count. */
  completedTasks: number;
  failedTasks: number;
  /** Sorted Executor Run Times of completed tasks (ms). */
  taskDurations: number[];
  medianTaskMs: number;
  maxTaskMs: number;
  meanTaskMs: number;
  p95TaskMs: number;
  /** max / median task duration; 0 when there are no completed tasks. */
  skewRatio: number;
  totalShuffleReadBytes: number;
  totalShuffleWriteBytes: number;
  totalMemoryBytesSpilled: number;
  totalDiskBytesSpilled: number;
  totalGcTimeMs: number;
  totalCpuTimeMs: number;
  totalRunTimeMs: number;
  totalInputBytes: number;
  totalOutputBytes: number;
}

/** One Spark job, as seen from JobStart/JobEnd events. */
export interface JobSummary {
  jobId: number;
  stageIds: number[];
  submissionTime?: number;
  completionTime?: number;
  durationMs?: number;
  succeeded?: boolean;
}

export interface AppInfo {
  appName?: string;
  appId?: string;
  startTime?: number;
  endTime?: number;
  sparkUser?: string;
}

/** A plain-language callout surfaced in the findings panel. */
export interface Finding {
  /** stable key, e.g. "skew:3" */
  id: string;
  severity: "critical" | "warning" | "info";
  kind: "skew" | "spill" | "shuffle" | "gc" | "failure" | "duration";
  title: string;
  detail: string;
  stageId?: number;
}

/** The full result of parsing one event log. */
export interface ParsedLog {
  app: AppInfo;
  jobs: JobSummary[];
  stages: StageSummary[];
  /** Total wall-clock span covered by the log (ms), if derivable. */
  totalDurationMs?: number;
  totalTasks: number;
  totalFailedTasks: number;
  /** Lines that were not valid JSON or not objects — skipped, never fatal. */
  malformedLines: number;
  /** Event types seen that the parser does not use (informational). */
  unknownEvents: string[];
  /** Number of JSON lines processed. */
  linesProcessed: number;
}
