# Test fixtures

## `real-eventlog-excerpt.jsonl`

A 60-line excerpt of a **real** Spark event log, taken from the Apache Spark
repository's test resources:

- Source: `apache/spark`, `core/src/test/resources/spark-events/app-20200706201101-0003`
  (Spark 3.1.0-SNAPSHOT, "Spark shell" application)
- License: Apache 2.0 (same as the Spark project)

What was changed from the original:

- `SparkListenerTaskEnd` lines trimmed to 10 per stage (30 of 48 kept) and
  `SparkListenerTaskStart` trimmed to 2 lines — the parser ignores TaskStart
  entirely, so keeping two validates the ignore path.
- The `SparkListenerEnvironmentUpdate` event's giant `Hadoop Properties`,
  `Classpath Entries`, and `System Properties` blobs were replaced with a
  `<trimmed for fixture size>` placeholder (they are tens of KB of JVM
  paths and add nothing to parser coverage).

Every event type present in the original 124-line log is still represented,
including ones the parser deliberately ignores
(`SparkListenerStageExecutorMetrics`, `SparkListenerResourceProfileAdded`,
SQL-execution events). The parser test asserts the excerpt parses with zero
malformed lines, 3 stages, 3 jobs, and 30 tasks.
