import { useMemo, useRef, useState } from "react";
import DropZone from "./components/DropZone";
import StageDag from "./components/StageDag";
import StageTable from "./components/StageTable";
import StageDetail from "./components/StageDetail";
import FindingsPanel from "./components/FindingsPanel";
import { parseEventLog } from "./lib/parser";
import { computeFindings } from "./lib/findings";
import { readLogFile } from "./lib/loadFile";
import { formatBytes, formatMs, formatNumber } from "./lib/format";
import type { ParsedLog } from "./lib/types";

interface LoadedLog {
  log: ParsedLog;
  sourceName: string;
  isSample: boolean;
}

export default function App() {
  const [loaded, setLoaded] = useState<LoadedLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const findings = useMemo(
    () => (loaded ? computeFindings(loaded.log) : []),
    [loaded],
  );

  const selectedStage = useMemo(() => {
    if (!loaded) return null;
    if (selectedStageId === null) return loaded.log.stages[0] ?? null;
    return (
      loaded.log.stages.find((s) => s.stageId === selectedStageId) ??
      loaded.log.stages[0] ??
      null
    );
  }, [loaded, selectedStageId]);

  const selectStage = (stageId: number) => {
    setSelectedStageId(stageId);
    // Scroll the detail panel into view when jumping from findings/DAG.
    setTimeout(
      () => detailRef.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  };

  const handleText = (text: string, sourceName: string, isSample: boolean) => {
    try {
      const log = parseEventLog(text);
      if (log.stages.length === 0 && log.jobs.length === 0) {
        setError(
          "No stages or jobs found in this file. Make sure it is a Spark event log (JSON lines with SparkListener events).",
        );
        return;
      }
      setError(null);
      setLoaded({ log, sourceName, isSample });
      setSelectedStageId(null);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(
        `Could not parse this file: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const text = await readLogFile(file);
      handleText(text, file.name, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this file.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSample = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}sample-eventlog.json`,
      );
      if (!res.ok) throw new Error(`Sample log failed to load (${res.status})`);
      const text = await res.text();
      handleText(text, "sample-eventlog.json", true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load the sample log.",
      );
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setLoaded(null);
    setSelectedStageId(null);
    setError(null);
  };

  const totalShuffle = loaded
    ? loaded.log.stages.reduce(
        (s, st) => s + st.totalShuffleReadBytes + st.totalShuffleWriteBytes,
        0,
      )
    : 0;
  const totalSpill = loaded
    ? loaded.log.stages.reduce((s, st) => s + st.totalDiskBytesSpilled, 0)
    : 0;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">🔍</div>
          <div>
            <h1>
              Spark<span>Lens</span>
            </h1>
            <p>Understand any Spark job from its event log</p>
          </div>
        </div>
        <div className="privacy-badge">
          🔒 100% client-side — your log never leaves this browser
        </div>
      </header>

      {!loaded && (
        <>
          <DropZone
            onFile={handleFile}
            onLoadSample={handleLoadSample}
            loading={loading}
          />
          {error && <div className="error-box">{error}</div>}
        </>
      )}

      {loaded && (
        <>
          <div className="toolbar">
            <span className="file-chip">📄 {loaded.sourceName}</span>
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              Load a different log
            </button>
          </div>

          <div className="summary-bar">
            <div className="summary-title">
              <h2>{loaded.log.app.appName ?? "Spark application"}</h2>
              {loaded.isSample && (
                <span className="sample-tag">Synthetic sample data</span>
              )}
              {loaded.log.app.appId && (
                <span className="app-id">{loaded.log.app.appId}</span>
              )}
            </div>
          </div>

          <div className="stat-cards">
            <div className="stat-card">
              <div className="label">Total duration</div>
              <div className="value">
                {formatMs(loaded.log.totalDurationMs)}
              </div>
              <div className="sub">wall-clock</div>
            </div>
            <div className="stat-card">
              <div className="label">Jobs</div>
              <div className="value">{formatNumber(loaded.log.jobs.length)}</div>
              <div className="sub">
                {loaded.log.jobs.filter((j) => j.succeeded === false).length >
                0
                  ? "some failed"
                  : "all succeeded"}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Stages</div>
              <div className="value">
                {formatNumber(loaded.log.stages.length)}
              </div>
              <div className="sub">click any stage to inspect</div>
            </div>
            <div className="stat-card">
              <div className="label">Tasks</div>
              <div className="value">{formatNumber(loaded.log.totalTasks)}</div>
              <div className="sub">
                {loaded.log.totalFailedTasks > 0
                  ? `${loaded.log.totalFailedTasks} failed`
                  : "none failed"}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">Shuffle moved</div>
              <div className="value">{formatBytes(totalShuffle)}</div>
              <div className="sub">read + write</div>
            </div>
            <div className="stat-card">
              <div className="label">Disk spill</div>
              <div className="value">{formatBytes(totalSpill)}</div>
              <div className="sub">
                {totalSpill > 0 ? "memory pressure" : "no spill"}
              </div>
            </div>
          </div>

          <section className="section">
            <h3>🔎 Findings</h3>
            <p className="hint">
              What stands out in this run — skew, spill, shuffle, GC, failures.
            </p>
            <FindingsPanel
              findings={findings}
              onSelectStage={selectStage}
            />
          </section>

          <section className="section">
            <h3>🗺️ Stage DAG</h3>
            <p className="hint">
              Stages and their dependencies, coloured by health. Click a stage
              to inspect it.
            </p>
            <StageDag
              stages={loaded.log.stages}
              selectedStageId={selectedStage?.stageId ?? null}
              onSelect={selectStage}
            />
          </section>

          <section className="section">
            <h3>📊 Stage metrics</h3>
            <p className="hint">
              One row per stage. Skew = slowest task ÷ median task.
            </p>
            <StageTable
              stages={loaded.log.stages}
              selectedStageId={selectedStage?.stageId ?? null}
              onSelect={selectStage}
            />
          </section>

          {selectedStage && (
            <section className="section" ref={detailRef}>
              <h3>
                Stage {selectedStage.stageId} — {selectedStage.name}
              </h3>
              <p className="hint">
                Per-task breakdown for the selected stage.
              </p>
              <StageDetail stage={selectedStage} />
            </section>
          )}

          <p
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              marginTop: 8,
            }}
          >
            Parsed {formatNumber(loaded.log.linesProcessed)} log lines
            {loaded.log.malformedLines > 0 &&
              ` (${loaded.log.malformedLines} malformed lines skipped)`}
            {loaded.log.unknownEvents.length > 0 &&
              ` · ${loaded.log.unknownEvents.length} unrecognised event type${loaded.log.unknownEvents.length === 1 ? "" : "s"} ignored`}
            .
          </p>
        </>
      )}

      <footer className="app-footer">
        <span>
          SparkLens — open source. Your event log is parsed locally and never
          uploaded.
        </span>
        <span>
          Built by <a href="https://github.com/OsamaZaidi75">Osama Shahid</a>
        </span>
      </footer>
    </div>
  );
}
