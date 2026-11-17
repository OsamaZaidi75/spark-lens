/**
 * Parser for Spark event logs (JSON-lines format).
 *
 * Defensive by design: Spark logs vary across versions, fields are often
 * absent, and a single bad line must never kill the whole parse.
 * Unknown events are ignored; malformed lines are counted and skipped.
 */
import type {
  AppInfo,
  JobSummary,
  ParsedLog,
  StageSummary,
  TaskRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Small safe-access helpers (event keys contain spaces, values may be absent)
// ---------------------------------------------------------------------------

type AnyObj = Record<string, unknown>;

function isObj(v: unknown): v is AnyObj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function optNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function numArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is number => typeof x === "number");
}

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function median(sorted: number[]): number {
  return percentile(sorted, 50);
}

// ---------------------------------------------------------------------------
// Stage accumulator (mutable during parse, frozen into StageSummary at the end)
// ---------------------------------------------------------------------------

interface StageAcc {
  stageId: number;
  attemptId: number;
  name: string;
  details: string;
  parentIds: number[];
  numTasks?: number;
  submissionTime?: number;
  completionTime?: number;
  tasks: TaskRecord[];
}

function newStageAcc(stageId: number, attemptId: number): StageAcc {
  return {
    stageId,
    attemptId,
    name: `Stage ${stageId}`,
    details: "",
    parentIds: [],
    tasks: [],
  };
}

function keyOf(stageId: number, attemptId: number): string {
  return `${stageId}:${attemptId}`;
}

// ---------------------------------------------------------------------------
// Task parsing
// ---------------------------------------------------------------------------

function parseTask(evt: AnyObj): TaskRecord | null {
  const info = isObj(evt["Task Info"]) ? evt["Task Info"] : {};
  const m = isObj(evt["Task Metrics"]) ? evt["Task Metrics"] : {};
  const sr = isObj(m["Shuffle Read Metrics"]) ? m["Shuffle Read Metrics"] : {};
  const sw = isObj(m["Shuffle Write Metrics"]) ? m["Shuffle Write Metrics"] : {};
  const im = isObj(m["Input Metrics"]) ? m["Input Metrics"] : {};
  const om = isObj(m["Output Metrics"]) ? m["Output Metrics"] : {};

  return {
    taskId: num(info["Task ID"], -1),
    index: num(info["Index"], -1),
    attempt: num(info["Attempt"], 0),
    executorId: str(info["Executor ID"], "?"),
    host: str(info["Host"], "?"),
    failed: info["Failed"] === true,
    launchTime: optNum(info["Launch Time"]),
    finishTime: optNum(info["Finish Time"]),
    runTimeMs: num(m["Executor Run Time"]),
    cpuTimeMs: num(m["Executor CPU Time"]),
    gcTimeMs: num(m["JVM GC Time"]),
    memoryBytesSpilled: num(m["Memory Bytes Spilled"]),
    diskBytesSpilled: num(m["Disk Bytes Spilled"]),
    shuffleReadBytes:
      num(sr["Remote Bytes Read"]) + num(sr["Local Bytes Read"]),
    shuffleReadRecords: num(sr["Records Read"]),
    shuffleWriteBytes: num(sw["Bytes Written"]),
    shuffleWriteRecords: num(sw["Records Written"]),
    inputBytes: num(im["Bytes Read"]),
    inputRecords: num(im["Records Read"]),
    outputBytes: num(om["Bytes Written"]),
    outputRecords: num(om["Records Written"]),
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** Cap on tasks kept per stage (prevents huge logs blowing up memory). */
  maxTasksPerStage?: number;
}

const DEFAULT_MAX_TASKS_PER_STAGE = 5000;

/**
 * Parse a Spark event log given as text (JSON lines).
 * Never throws on bad input — malformed lines are counted and skipped.
 */
export function parseEventLog(
  text: string,
  opts: ParseOptions = {},
): ParsedLog {
  const maxTasks = opts.maxTasksPerStage ?? DEFAULT_MAX_TASKS_PER_STAGE;

  const app: AppInfo = {};
  const jobs = new Map<number, JobSummary>();
  const stages = new Map<string, StageAcc>();
  const unknownEvents = new Set<string>();
  let malformedLines = 0;
  let linesProcessed = 0;

  const getStage = (stageId: number, attemptId: number): StageAcc => {
    const k = keyOf(stageId, attemptId);
    let acc = stages.get(k);
    if (!acc) {
      acc = newStageAcc(stageId, attemptId);
      stages.set(k, acc);
    }
    return acc;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    linesProcessed++;

    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isObj(evt)) {
      malformedLines++;
      continue;
    }

    const eventType = str(evt["Event"]);
    switch (eventType) {
      case "SparkListenerApplicationStart": {
        app.appName = str(evt["App Name"]) || app.appName;
        app.appId = str(evt["App ID"]) || app.appId;
        app.sparkUser = str(evt["Spark User"]) || app.sparkUser;
        app.startTime = optNum(evt["Timestamp"]) ?? app.startTime;
        break;
      }
      case "SparkListenerApplicationEnd": {
        app.endTime = optNum(evt["Timestamp"]) ?? app.endTime;
        break;
      }
      case "SparkListenerJobStart": {
        const jobId = num(evt["Job ID"], -1);
        if (jobId >= 0) {
          jobs.set(jobId, {
            jobId,
            stageIds: numArray(evt["Stage IDs"]),
            submissionTime: optNum(evt["Submission Time"]),
          });
        }
        break;
      }
      case "SparkListenerJobEnd": {
        const jobId = num(evt["Job ID"], -1);
        const job = jobId >= 0 ? jobs.get(jobId) : undefined;
        if (job) {
          job.completionTime = optNum(evt["Completion Time"]);
          const result = isObj(evt["Job Result"]) ? evt["Job Result"] : {};
          job.succeeded = str(result["Result"]) === "JobSucceeded";
        }
        break;
      }
      case "SparkListenerStageSubmitted":
      case "SparkListenerStageCompleted": {
        const info = isObj(evt["Stage Info"]) ? evt["Stage Info"] : {};
        const stageId = num(info["Stage ID"], -1);
        if (stageId < 0) break;
        const attemptId = num(info["Attempt ID"], 0);
        const acc = getStage(stageId, attemptId);
        const name = str(info["Stage Name"]);
        if (name) acc.name = name;
        const details = str(info["Details"]);
        if (details) acc.details = details;
        const parents = numArray(info["Parent IDs"]);
        if (parents.length > 0) acc.parentIds = parents;
        const n = optNum(info["Number of Tasks"]);
        if (n !== undefined) acc.numTasks = n;
        const sub = optNum(info["Submission Time"]);
        if (sub !== undefined) acc.submissionTime = sub;
        const comp = optNum(info["Completion Time"]);
        if (comp !== undefined) acc.completionTime = comp;
        break;
      }
      case "SparkListenerTaskEnd": {
        const stageId = num(evt["Stage ID"], -1);
        if (stageId < 0) break;
        const attemptId = num(evt["Stage Attempt ID"], 0);
        const acc = getStage(stageId, attemptId);
        const task = parseTask(evt);
        if (task && acc.tasks.length < maxTasks) acc.tasks.push(task);
        break;
      }
      // Known but unused events — ignore silently.
      case "SparkListenerTaskStart":
      case "SparkListenerEnvironmentUpdate":
      case "SparkListenerBlockManagerAdded":
      case "SparkListenerBlockManagerRemoved":
      case "SparkListenerExecutorAdded":
      case "SparkListenerExecutorRemoved":
      case "SparkListenerSQLExecutionStart":
      case "SparkListenerSQLExecutionEnd":
      case "SparkListenerLogStart":
        break;
      default: {
        if (eventType) unknownEvents.add(eventType);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Freeze stages into summaries
  // -------------------------------------------------------------------------
  const stageSummaries: StageSummary[] = [...stages.values()]
    .map((acc) => {
      const completed = acc.tasks.filter((t) => !t.failed);
      const durations = completed
        .map((t) => t.runTimeMs)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const med = median(durations);
      const max = durations.length ? durations[durations.length - 1] : 0;
      const sum = (f: (t: TaskRecord) => number) =>
        acc.tasks.reduce((s, t) => s + f(t), 0);

      return {
        stageId: acc.stageId,
        attemptId: acc.attemptId,
        name: acc.name,
        details: acc.details,
        parentIds: acc.parentIds,
        numTasks: acc.numTasks,
        submissionTime: acc.submissionTime,
        completionTime: acc.completionTime,
        durationMs:
          acc.submissionTime !== undefined &&
          acc.completionTime !== undefined
            ? Math.max(0, acc.completionTime - acc.submissionTime)
            : undefined,
        tasks: acc.tasks,
        completedTasks: completed.length,
        failedTasks: acc.tasks.length - completed.length,
        taskDurations: durations,
        medianTaskMs: med,
        maxTaskMs: max,
        meanTaskMs: durations.length
          ? durations.reduce((s, d) => s + d, 0) / durations.length
          : 0,
        p95TaskMs: percentile(durations, 95),
        skewRatio: med > 0 ? max / med : 0,
        totalShuffleReadBytes: sum((t) => t.shuffleReadBytes),
        totalShuffleWriteBytes: sum((t) => t.shuffleWriteBytes),
        totalMemoryBytesSpilled: sum((t) => t.memoryBytesSpilled),
        totalDiskBytesSpilled: sum((t) => t.diskBytesSpilled),
        totalGcTimeMs: sum((t) => t.gcTimeMs),
        totalCpuTimeMs: sum((t) => t.cpuTimeMs),
        totalRunTimeMs: sum((t) => t.runTimeMs),
        totalInputBytes: sum((t) => t.inputBytes),
        totalOutputBytes: sum((t) => t.outputBytes),
      } satisfies StageSummary;
    })
    .sort((a, b) => a.stageId - b.stageId || a.attemptId - b.attemptId);

  const jobSummaries: JobSummary[] = [...jobs.values()]
    .map((j) => ({
      ...j,
      durationMs:
        j.submissionTime !== undefined && j.completionTime !== undefined
          ? Math.max(0, j.completionTime - j.submissionTime)
          : undefined,
    }))
    .sort((a, b) => a.jobId - b.jobId);

  const totalTasks = stageSummaries.reduce(
    (s, st) => s + st.tasks.length,
    0,
  );
  const totalFailedTasks = stageSummaries.reduce(
    (s, st) => s + st.failedTasks,
    0,
  );

  let totalDurationMs: number | undefined;
  if (app.startTime !== undefined && app.endTime !== undefined) {
    totalDurationMs = Math.max(0, app.endTime - app.startTime);
  } else {
    const subs = stageSummaries
      .map((s) => s.submissionTime)
      .filter((t): t is number => t !== undefined);
    const comps = stageSummaries
      .map((s) => s.completionTime)
      .filter((t): t is number => t !== undefined);
    if (subs.length && comps.length) {
      totalDurationMs = Math.max(0, Math.max(...comps) - Math.min(...subs));
    }
  }

  return {
    app,
    jobs: jobSummaries,
    stages: stageSummaries,
    totalDurationMs,
    totalTasks,
    totalFailedTasks,
    malformedLines,
    unknownEvents: [...unknownEvents].sort(),
    linesProcessed,
  };
}

/** A stage counts as skewed when its slowest task dwarfs the median task. */
export const SKEW_RATIO_THRESHOLD = 3;
export const SKEW_MIN_TASKS = 5;

export function isSkewed(stage: StageSummary): boolean {
  return (
    stage.completedTasks >= SKEW_MIN_TASKS &&
    stage.skewRatio >= SKEW_RATIO_THRESHOLD &&
    stage.maxTaskMs > 1000
  );
}
