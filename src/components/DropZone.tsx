import { useRef, useState } from "react";
import { ArrowRightIcon, HeroMotif, UploadIcon } from "./icons";

interface DropZoneProps {
  onFile: (file: File) => void;
  onLoadSample: () => void;
  loading: boolean;
}

export default function DropZone({
  onFile,
  onLoadSample,
  loading,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div>
      <div className="hero">
        <div className="hero-motif">
          <HeroMotif />
        </div>
        <h2>See what your Spark job actually did</h2>
        <p>
          Drop in a Spark event log and get the stage DAG, per-stage metrics,
          skew detection, and plain-language findings — in seconds, entirely in
          your browser.
        </p>
      </div>

      <div className="dropzone-shell">
        <div
          className={`dropzone${dragging ? " dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          aria-label="Drop a Spark event log file here, or click to browse"
        >
          <div className="dropzone-icon">
            <UploadIcon />
          </div>
          <h3>Drop your Spark event log here</h3>
          <p>or click to browse your files</p>
          <p className="formats">.json &nbsp;·&nbsp; .json.gz</p>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.json.gz,.gz,application/json,application/gzip"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="hero-actions">
        <button
          className="btn btn-primary"
          onClick={onLoadSample}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load sample log"}
          <span className="btn-icon-circle">
            <ArrowRightIcon size={13} color="#1a1205" />
          </span>
        </button>
      </div>
      <p className="sample-note">
        The sample is synthetic demo data (2 jobs, 6 stages, with a skewed
        stage, a spilling stage, and a shuffle-heavy stage) — try it instantly,
        no cluster needed.
      </p>

      <div className="howto">
        <h3>How to get an event log from your Spark job</h3>
        <p>
          Enable event logging in your Spark config (or <code>spark-defaults.conf</code>):
        </p>
        <ul>
          <li>
            <code>spark.eventLog.enabled=true</code>
          </li>
          <li>
            <code>spark.eventLog.dir=/path/to/event-logs</code>{" "}
            (local dir, S3, GCS, or ADLS)
          </li>
        </ul>
        <p>
          Spark writes one JSON-lines file per application. Download it (or its{" "}
          <code>.gz</code> version) and drop it above. Logs never leave your
          browser — parsing happens locally, nothing is uploaded anywhere.
        </p>
      </div>
    </div>
  );
}
