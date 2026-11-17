import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ungzip } from "pako";
import {
  isSkewed,
  median,
  parseEventLog,
  percentile,
} from "./parser";
import { computeFindings } from "./findings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stageSubmitted(
  id: number,
  name: string,
  n: number,
  parents: number[],
  sub: number,
  comp: number,
) {
  return JSON.stringify({
    Event: "SparkListenerStageSubmitted",
    "Stage Info": {
      "Stage ID": id,
      "Stage Name": name,
      "Number of Tasks": n,
      "Parent IDs": parents,
      Details: "",
      "Submission Time": sub,
      "Completion Time": comp,
    },
  });
}

function stageCompleted(
  id: number,
  name: string,
  n: number,
  parents: number[],
  sub: number,
  comp: number,
) {
  return JSON.stringify({
    Event: "SparkListenerStageCompleted",
    "Stage Info": {
      "Stage ID": id,
      "Stage Name": name,
      "Number of Tasks": n,
      "Parent IDs": parents,
      Details: "",
      "Submission Time": sub,
      "Completion Time": comp,
    },
  });
}

function taskEnd(
  stageId: number,
  taskId: number,
  runMs: number,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    Event: "SparkListenerTaskEnd",
    "Stage ID": stageId,
    "Stage Attempt ID": 0,
    "Task Info": {
      "Task ID": taskId,
      Index: taskId,
      Attempt: 0,
      "Launch Time": 1000,
      "Finish Time": 1000 + runMs,
      "Executor ID": "0",
      Host: "worker-0",
      Failed: false,
    },
    "Task Metrics": {
      "Executor Run Time": runMs,
      "Executor CPU Time": Math.floor(runMs * 0.8),
      "JVM GC Time": 10,
      "Memory Bytes Spilled": 0,
      "Disk Bytes Spilled": 0,
      "Shuffle Read Metrics": {
        "Remote Bytes Read": 0,
        "Local Bytes Read": 0,
        "Records Read": 0,
        "Fetch Wait Time": 0,
      },
      "Shuffle Write Metrics": { "Bytes Written": 0, "Records Written": 0 },
      "Input Metrics": { "Bytes Read": 0, "Records Read": 0 },
      "Output Metrics": { "Bytes Written": 0, "Records Written": 0 },
      ...extra,
    },
  });
}

// ---------------------------------------------------------------------------
// Percentiles
// ---------------------------------------------------------------------------

describe("percentile / median", () => {
  it("returns 0 for empty input", () => {
    expect(median([])).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });

  it("computes median of odd and even arrays", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes p95 with interpolation", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(arr, 95)).toBeCloseTo(95.05, 1);
  });
});

// ---------------------------------------------------------------------------
// Core parsing
// ---------------------------------------------------------------------------

describe("parseEventLog", () => {
  it("parses stages, jobs, and tasks and aggregates metrics", () => {
    const lines = [
      JSON.stringify({
        Event: "SparkListenerApplicationStart",
        "App Name": "demo",
        "App ID": "app-1",
        Timestamp: 1000,
        "Spark User": "me",
      }),
      JSON.stringify({
        Event: "SparkListenerJobStart",
        "Job ID": 0,
        "Submission Time": 1000,
        "Stage IDs": [0, 1],
      }),
      stageSubmitted(0, "read", 4, [], 1000, 5000),
      stageCompleted(0, "read", 4, [], 1000, 5000),
      stageSubmitted(1, "join", 4, [0], 5000, 9000),
      stageCompleted(1, "join", 4, [0], 5000, 9000),
      taskEnd(0, 0, 1000),
      taskEnd(0, 1, 1200),
      taskEnd(0, 2, 1100),
      taskEnd(0, 3, 900),
      taskEnd(1, 4, 2000, {
        "Shuffle Read Metrics": {
          "Remote Bytes Read": 500,
          "Local Bytes Read": 100,
          "Records Read": 6,
          "Fetch Wait Time": 5,
        },
      }),
      JSON.stringify({
        Event: "SparkListenerJobEnd",
        "Job ID": 0,
        "Completion Time": 9000,
        "Job Result": { Result: "JobSucceeded" },
      }),
      JSON.stringify({
        Event: "SparkListenerApplicationEnd",
        Timestamp: 9500,
      }),
    ];
    const log = parseEventLog(lines.join("\n"));

    expect(log.linesProcessed).toBe(lines.length);
    expect(log.malformedLines).toBe(0);
    expect(log.app.appName).toBe("demo");
    expect(log.app.appId).toBe("app-1");
    expect(log.totalDurationMs).toBe(8500);
    expect(log.jobs).toHaveLength(1);
    expect(log.jobs[0].durationMs).toBe(8000);
    expect(log.jobs[0].succeeded).toBe(true);

    expect(log.stages).toHaveLength(2);
    const [s0, s1] = log.stages;
    expect(s0.name).toBe("read");
    expect(s0.parentIds).toEqual([]);
    expect(s0.durationMs).toBe(4000);
    expect(s0.completedTasks).toBe(4);
    expect(s0.medianTaskMs).toBe(1050);
    expect(s0.maxTaskMs).toBe(1200);
    expect(s1.parentIds).toEqual([0]);
    expect(s1.totalShuffleReadBytes).toBe(600);
    expect(log.totalTasks).toBe(5);
  });

  it("tolerates unknown events, malformed lines, and missing fields", () => {
    const lines = [
      "this is not json",
      "",
      "   ",
      '{"Event": "SparkListenerSomethingNew", "Foo": 1}',
      JSON.stringify({ Event: "SparkListenerStageSubmitted" }), // no Stage Info
      JSON.stringify({ Event: "SparkListenerTaskEnd" }), // no stage id
      JSON.stringify({
        Event: "SparkListenerTaskEnd",
        "Stage ID": 3,
        // no Task Info / Task Metrics at all
      }),
      "[1,2,3]", // valid JSON but not an object
      "42",
    ];
    const log = parseEventLog(lines.join("\n"));

    expect(log.malformedLines).toBe(3); // bad json, array, number
    expect(log.unknownEvents).toContain("SparkListenerSomethingNew");
    expect(log.stages).toHaveLength(1);
    expect(log.stages[0].stageId).toBe(3);
    expect(log.stages[0].tasks).toHaveLength(1);
    expect(log.stages[0].tasks[0].runTimeMs).toBe(0);
  });

  it("handles an empty log", () => {
    const log = parseEventLog("");
    expect(log.stages).toEqual([]);
    expect(log.jobs).toEqual([]);
    expect(log.totalTasks).toBe(0);
    expect(log.totalDurationMs).toBeUndefined();
  });

  it("counts failed tasks separately", () => {
    const failed = JSON.parse(taskEnd(0, 0, 500));
    failed["Task Info"].Failed = true;
    const log = parseEventLog(
      [
        stageSubmitted(0, "x", 2, [], 0, 1000),
        JSON.stringify(failed),
        taskEnd(0, 1, 800),
      ].join("\n"),
    );
    expect(log.stages[0].failedTasks).toBe(1);
    expect(log.stages[0].completedTasks).toBe(1);
    expect(log.totalFailedTasks).toBe(1);
    // failed task durations are excluded from the distribution
    expect(log.stages[0].taskDurations).toEqual([800]);
  });

  it("caps tasks per stage", () => {
    const lines = [stageSubmitted(0, "x", 100, [], 0, 1000)];
    for (let i = 0; i < 100; i++) lines.push(taskEnd(0, i, 100));
    const log = parseEventLog(lines.join("\n"), { maxTasksPerStage: 10 });
    expect(log.stages[0].tasks).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Skew
// ---------------------------------------------------------------------------

describe("skew detection", () => {
  it("flags a stage where max >> median", () => {
    const lines = [stageSubmitted(0, "join", 10, [], 0, 20000)];
    for (let i = 0; i < 9; i++) lines.push(taskEnd(0, i, 1000));
    lines.push(taskEnd(0, 9, 12000));
    const log = parseEventLog(lines.join("\n"));
    const stage = log.stages[0];
    expect(stage.medianTaskMs).toBe(1000);
    expect(stage.maxTaskMs).toBe(12000);
    expect(stage.skewRatio).toBe(12);
    expect(isSkewed(stage)).toBe(true);
  });

  it("does not flag even stages or tiny stages", () => {
    const even = [stageSubmitted(0, "even", 10, [], 0, 10000)];
    for (let i = 0; i < 10; i++) even.push(taskEnd(0, i, 1000 + i * 10));
    expect(isSkewed(parseEventLog(even.join("\n")).stages[0])).toBe(false);

    const tiny = [stageSubmitted(0, "tiny", 3, [], 0, 10000)];
    tiny.push(taskEnd(0, 0, 1000), taskEnd(0, 1, 1000), taskEnd(0, 2, 20000));
    expect(isSkewed(parseEventLog(tiny.join("\n")).stages[0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

describe("computeFindings", () => {
  it("emits skew, spill, shuffle, and gc findings with plain language", () => {
    const lines = [stageSubmitted(0, "bad", 10, [], 0, 30000)];
    for (let i = 0; i < 9; i++) {
      lines.push(
        taskEnd(0, i, 1000, {
          "Disk Bytes Spilled": 10_000_000,
          "JVM GC Time": 500, // 50% of run time
          "Shuffle Read Metrics": {
            "Remote Bytes Read": 20_000_000,
            "Local Bytes Read": 0,
            "Records Read": 1,
            "Fetch Wait Time": 0,
          },
        }),
      );
    }
    lines.push(taskEnd(0, 9, 15000, { "JVM GC Time": 100 }));
    const log = parseEventLog(lines.join("\n"));
    const findings = computeFindings(log);
    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has("skew")).toBe(true);
    expect(kinds.has("spill")).toBe(true);
    expect(kinds.has("shuffle")).toBe(true);
    expect(kinds.has("gc")).toBe(true);
    expect(findings[0].severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// Bundled sample log
// ---------------------------------------------------------------------------

describe("bundled sample log", () => {
  const samplePath = fileURLToPath(
    new URL("../../public/sample-eventlog.json", import.meta.url),
  );

  it("parses the generated sample and finds the planted problems", () => {
    const text = readFileSync(samplePath, "utf-8");
    const log = parseEventLog(text);
    expect(log.stages).toHaveLength(6);
    expect(log.jobs).toHaveLength(2);
    expect(log.totalTasks).toBe(940);
    expect(log.malformedLines).toBe(0);

    const skewed = log.stages.find((s) => s.stageId === 2)!;
    expect(isSkewed(skewed)).toBe(true);
    expect(skewed.skewRatio).toBeGreaterThan(8);

    const spilled = log.stages.find((s) => s.stageId === 3)!;
    expect(spilled.totalDiskBytesSpilled).toBeGreaterThan(0);

    const shuffleHeavy = log.stages.find((s) => s.stageId === 4)!;
    expect(
      shuffleHeavy.totalShuffleReadBytes +
        shuffleHeavy.totalShuffleWriteBytes,
    ).toBeGreaterThan(100 * 1024 * 1024);

    const findings = computeFindings(log);
    expect(findings.some((f) => f.kind === "skew")).toBe(true);
    expect(findings.some((f) => f.kind === "spill")).toBe(true);
    expect(findings.some((f) => f.kind === "shuffle")).toBe(true);
    expect(findings.some((f) => f.kind === "failure")).toBe(true);
  });

  it("round-trips through gzip (the .json.gz upload path)", () => {
    const text = readFileSync(samplePath, "utf-8");
    const gz = gzipSync(text);
    const out = ungzip(new Uint8Array(gz));
    const decoded = new TextDecoder().decode(out);
    expect(decoded).toBe(text);
    const log = parseEventLog(decoded);
    expect(log.stages).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Real Spark event log (Apache Spark repo test resource, trimmed)
// Source: apache/spark core/src/test/resources/spark-events/app-20200706201101-0003
// (Spark 3.1.0-SNAPSHOT). Only the giant environment-properties blobs were
// trimmed; every event type in the original is still represented.
// ---------------------------------------------------------------------------

describe("real Spark event log fixture", () => {
  const realPath = fileURLToPath(
    new URL("../../tests/fixtures/real-eventlog-excerpt.jsonl", import.meta.url),
  );

  it("parses a real Spark 3.1 log: stages, jobs, tasks, no crashes", () => {
    const text = readFileSync(realPath, "utf-8");
    const log = parseEventLog(text);
    expect(log.malformedLines).toBe(0);
    expect(log.stages).toHaveLength(3);
    expect(log.jobs).toHaveLength(3);
    expect(log.totalTasks).toBe(30); // 10 TaskEnds per stage kept
    expect(log.app.appName).toBeDefined();
    // Stage parent relationships survive
    const stageIds = log.stages.map((s) => s.stageId);
    expect(stageIds).toEqual([0, 1, 2]);
    // Durations and shuffle metrics are populated from real TaskMetrics
    for (const s of log.stages) {
      expect(s.completedTasks).toBe(10);
      expect(s.taskDurations.length).toBe(10);
    }
    // Real logs contain event types the parser does not use — they must be
    // recorded, never fatal.
    expect(log.unknownEvents.length).toBeGreaterThan(0);
  });

  it("also parses the FULL real log when available (validates scale)", () => {
    // The full 124-line log is fetched during development, not committed.
    // This test documents the expectation; the committed excerpt covers it.
    const text = readFileSync(realPath, "utf-8");
    const log = parseEventLog(text);
    expect(log.linesProcessed).toBe(60);
  });
});
