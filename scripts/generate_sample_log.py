#!/usr/bin/env python3
"""Generate a realistic synthetic Spark event log for SparkLens demos.

Writes JSON-lines in the real Spark event-log format:
  - 2 jobs, 6 stages
  - Stage 2 is clearly skewed (a few tasks run ~10x the median)
  - Stage 3 spills to disk
  - Stage 4 is shuffle-heavy
  - A couple of failed tasks in stage 5

This data is SYNTHETIC — it exists so anyone can try SparkLens instantly
without a Spark cluster. Never present it as a real production run.

Usage:
    python3 scripts/generate_sample_log.py [output_path]
Default output: public/sample-eventlog.json
"""
import json
import random
import sys
from pathlib import Path

random.seed(42)

BASE = 1_700_000_000_000  # epoch ms anchor


def ev(event, **fields):
    out = {"Event": event}
    out.update(fields)
    return out


def stage_info(stage_id, name, n_tasks, parents, sub, comp, details=""):
    return {
        "Stage ID": stage_id,
        "Stage Name": name,
        "Number of Tasks": n_tasks,
        "Parent IDs": parents,
        "Details": details,
        "Submission Time": sub,
        "Completion Time": comp,
    }


def task_end(stage_id, task_id, launch, run_ms, *, failed=False,
             gc_ms=40, mem_spill=0, disk_spill=0,
             shuf_read=0, shuf_write=0, input_bytes=0, output_bytes=0):
    return ev(
        "SparkListenerTaskEnd",
        **{
            "Stage ID": stage_id,
            "Stage Attempt ID": 0,
            "Task Info": {
                "Task ID": task_id,
                "Index": task_id,
                "Attempt": 0,
                "Launch Time": launch,
                "Finish Time": launch + run_ms,
                "Executor ID": str(task_id % 8),
                "Host": f"worker-{task_id % 8}.local",
                "Failed": failed,
            },
            "Task Metrics": {
                "Executor Run Time": run_ms,
                "Executor CPU Time": int(run_ms * 0.8),
                "JVM GC Time": gc_ms,
                "Result Size": 1024,
                "Memory Bytes Spilled": mem_spill,
                "Disk Bytes Spilled": disk_spill,
                "Shuffle Read Metrics": {
                    "Remote Bytes Read": shuf_read,
                    "Local Bytes Read": 0,
                    "Records Read": shuf_read // 100 if shuf_read else 0,
                    "Fetch Wait Time": 120,
                },
                "Shuffle Write Metrics": {
                    "Bytes Written": shuf_write,
                    "Records Written": shuf_write // 100 if shuf_write else 0,
                },
                "Input Metrics": {
                    "Bytes Read": input_bytes,
                    "Records Read": input_bytes // 200 if input_bytes else 0,
                },
                "Output Metrics": {
                    "Bytes Written": output_bytes,
                    "Records Written": output_bytes // 200 if output_bytes else 0,
                },
            },
        },
    )


def build_events():
    events = []
    t = BASE

    events.append(ev("SparkListenerLogStart", **{"Spark Version": "3.5.0"}))
    events.append(ev(
        "SparkListenerApplicationStart",
        **{
            "App Name": "Sample ETL — orders pipeline (synthetic)",
            "App ID": "app-20260101000000-0000",
            "Timestamp": t,
            "Spark User": "demo",
            "App Attempt ID": "1",
        },
    ))
    events.append(ev("SparkListenerEnvironmentUpdate", **{
        "Environment Details": {
            "JVM Information": {"Java Version": "17.0.9"},
            "Spark Properties": {"spark.app.name": "Sample ETL"},
            "System Properties": {},
            "Classpath Entries": {},
        },
    }))

    task_counter = 0

    def emit_stage(stage_id, name, n_tasks, parents, start, dur_ms,
                   run_fn, job_extra=None):
        nonlocal task_counter
        sub = start
        comp = start + dur_ms
        events.append(ev("SparkListenerStageSubmitted",
                          **{"Stage Info": stage_info(
                              stage_id, name, n_tasks, parents, sub, comp)}))
        for i in range(n_tasks):
            run_ms, kw = run_fn(i)
            launch = sub + random.randint(0, max(0, dur_ms - run_ms))
            events.append(task_end(stage_id, task_counter, launch, run_ms, **kw))
            task_counter += 1
        events.append(ev("SparkListenerStageCompleted",
                          **{"Stage Info": stage_info(
                              stage_id, name, n_tasks, parents, sub, comp)}))
        return comp

    # ---- Job 0: read + filter + aggregate --------------------------------
    job0_start = t + 1_000
    events.append(ev("SparkListenerJobStart",
                      **{"Job ID": 0, "Submission Time": job0_start,
                         "Stage IDs": [0, 1, 2]}))

    # Stage 0 — clean read stage: 200 even tasks, reads 500 MB from S3
    end0 = emit_stage(
        0, "csv at Sample.scala:21", 200, [], job0_start, 18_000,
        lambda i: (random.randint(400, 900),
                   {"input_bytes": 2_500_000, "gc_ms": random.randint(10, 60)}),
    )
    # Stage 1 — map/filter: 200 even tasks, small shuffle write
    end1 = emit_stage(
        1, "map at Sample.scala:34", 200, [0], end0 + 500, 22_000,
        lambda i: (random.randint(600, 1400),
                   {"shuf_write": 1_200_000, "gc_ms": random.randint(20, 80)}),
    )
    # Stage 2 — SKEWED join: 200 tasks, most ~1s, 6 tasks ~12s (hot keys)
    def skewed_run(i):
        if i in (17, 42, 88, 121, 150, 193):
            return 12_000 + random.randint(0, 2000), {
                "shuf_read": 45_000_000, "gc_ms": random.randint(400, 900)}
        return random.randint(800, 1500), {
            "shuf_read": 900_000, "gc_ms": random.randint(20, 90)}

    end2 = emit_stage(
        2, "sortMergeJoin at Sample.scala:57", 200, [1], end1 + 500, 31_000,
        skewed_run,
    )
    events.append(ev("SparkListenerJobEnd",
                      **{"Job ID": 0, "Completion Time": end2 + 300,
                         "Job Result": {"Result": "JobSucceeded"}}))

    # ---- Job 1: write path -------------------------------------------------
    job1_start = end2 + 2_000
    events.append(ev("SparkListenerJobStart",
                      **{"Job ID": 1, "Submission Time": job1_start,
                         "Stage IDs": [3, 4, 5]}))

    # Stage 3 — SPILL: 100 tasks, each spills ~64 MB to disk (tight memory)
    end3 = emit_stage(
        3, "sort at Sample.scala:71", 100, [2], job1_start, 26_000,
        lambda i: (random.randint(1800, 3200),
                   {"shuf_read": 3_000_000, "mem_spill": 32_000_000,
                    "disk_spill": 64_000_000,
                    "gc_ms": random.randint(300, 700)}),
    )
    # Stage 4 — SHUFFLE-HEAVY: 120 tasks moving ~4 MB each way
    end4 = emit_stage(
        4, "exchange at Sample.scala:82", 120, [3], end3 + 500, 20_000,
        lambda i: (random.randint(900, 2000),
                   {"shuf_read": 4_000_000, "shuf_write": 4_200_000,
                    "gc_ms": random.randint(30, 120)}),
    )
    # Stage 5 — write: 120 tasks, 2 failed (retried by Spark in reality)
    def write_run(i):
        if i in (7, 55):
            return 300, {"failed": True, "gc_ms": 10}
        return random.randint(700, 1600), {
            "output_bytes": 1_800_000, "gc_ms": random.randint(10, 50)}

    end5 = emit_stage(
        5, "saveAsTable at Sample.scala:95", 120, [4], end4 + 500, 15_000,
        write_run,
    )
    events.append(ev("SparkListenerJobEnd",
                      **{"Job ID": 1, "Completion Time": end5 + 300,
                         "Job Result": {"Result": "JobSucceeded"}}))
    events.append(ev("SparkListenerApplicationEnd",
                      **{"Timestamp": end5 + 1_000}))

    return events


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("public/sample-eventlog.json")
    events = build_events()
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        for e in events:
            f.write(json.dumps(e, separators=(",", ":")))
            f.write("\n")
    print(f"Wrote {len(events)} events to {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
