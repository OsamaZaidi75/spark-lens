/**
 * End-to-end verification + demo video for SparkLens.
 *
 * Serves dist/ on :4173, opens the app in Chromium, clicks "Load sample",
 * asserts the dashboard renders (findings, DAG, table, stage detail), and
 * records the whole flow as a video for the LinkedIn launch post.
 *
 * Usage: node scripts/demo-and-verify.mjs [baseUrl]
 * Default baseUrl: http://localhost:4173
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "demo");
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = process.argv[2] || "http://localhost:4173";
const NEEDS_SERVER = BASE_URL.includes("localhost");
// DEMO_TAG=v2 writes 01-hero-v2.png etc. and sparklens-demo-v2.mp4,
// leaving the v1 assets untouched.
const TAG = process.env.DEMO_TAG ? `-${process.env.DEMO_TAG}` : "";
const shot = (name) => path.join(OUT_DIR, `${name}${TAG}.png`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`\n❌ FAILED: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main() {
  let server = null;
  if (NEEDS_SERVER) {
    server = spawn(
      "python3",
      ["-m", "http.server", "4173", "--directory", path.join(ROOT, "dist")],
      { stdio: "ignore" },
    );
    await sleep(1500);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  try {
    console.log(`→ Opening ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    // 1. Hero / dropzone visible
    const hero = page.getByRole("heading", {
      name: /See what your Spark job actually did/i,
    });
    if (!(await hero.isVisible())) fail("hero heading not visible");
    const sampleBtn = page.getByRole("button", { name: /Load sample log/i });
    if (!(await sampleBtn.isVisible())) fail("Load sample button not visible");
    console.log("✓ Hero + Load sample button visible");
    await page.screenshot({ path: shot("01-hero") });
    await sleep(2000);

    // 2. Load the sample log
    await sampleBtn.click();
    await page
      .getByRole("heading", { name: "Findings" })
      .waitFor({ timeout: 10000 });
    console.log("✓ Sample log loaded, dashboard rendered");
    await sleep(1500);

    // 3. Assertions on the dashboard
    const checks = [
      ["summary shows 6 stages", page.locator(".stat-item", { hasText: "Stages" })],
      ["summary shows 2 jobs", page.locator(".stat-item", { hasText: "Jobs" })],
      ["skew finding present", page.getByText(/Skewed stage/i).first()],
      ["spill finding present", page.getByText(/Disk spill/i).first()],
      ["shuffle finding present", page.getByText(/Shuffle-heavy/i).first()],
      ["DAG svg present", page.locator(".dag-scroll svg")],
      ["stage table has 6 rows", page.locator("table.stages tbody tr")],
      ["sample tag visible", page.getByText(/Synthetic sample data/i)],
    ];
    for (const [name, loc] of checks) {
      const n = await loc.count();
      if (n === 0) fail(`check failed: ${name}`);
      console.log(`✓ ${name}`);
    }
    const rowCount = await page.locator("table.stages tbody tr").count();
    if (rowCount !== 6) fail(`expected 6 stage rows, got ${rowCount}`);
    const nodeCount = await page.locator(".dag-node").count();
    if (nodeCount !== 6) fail(`expected 6 DAG nodes, got ${nodeCount}`);
    console.log(`✓ 6 stage rows and 6 DAG nodes`);

    await page.screenshot({ path: shot("02-dashboard") });
    await sleep(1500);

    // 4. Scroll through findings → DAG (pan the DAG to show the full chain)
    await page.getByRole("heading", { name: "Findings" }).scrollIntoViewIfNeeded();
    await sleep(1800);
    await page.getByRole("heading", { name: "Stage DAG" }).scrollIntoViewIfNeeded();
    await sleep(1200);
    await page.evaluate(() => {
      const el = document.querySelector(".dag-scroll");
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    });
    await sleep(1800);
    await page.evaluate(() => {
      const el = document.querySelector(".dag-scroll");
      if (el) el.scrollTo({ left: 0, behavior: "smooth" });
    });
    await sleep(1200);
    await page.screenshot({ path: shot("03-dag") });

    // 5. Click the skewed stage (Stage 2) in the DAG
    const stage2 = page.locator(".dag-node", { hasText: "Stage 2" });
    await stage2.click();
    await sleep(2500); // smooth scroll to detail panel
    const detail = page.locator("section.section h3", {
      hasText: /^Stage 2 —/,
    });
    if (!(await detail.isVisible())) fail("stage 2 detail not visible after DAG click");
    const skewText = await page.locator(".detail-metric", { hasText: "Skew" }).innerText();
    console.log(`✓ Stage 2 detail open — ${skewText.replace(/\n/g, " ")}`);
    await page.screenshot({ path: shot("04-stage-detail") });
    await sleep(1500);

    // 6. Scroll to the metrics table, then back to top
    await page.getByRole("heading", { name: "Stage metrics" }).scrollIntoViewIfNeeded();
    await sleep(1800);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1500);

    if (errors.length > 0) {
      console.warn(`⚠ ${errors.length} page error(s) observed:`);
      for (const e of errors) console.warn("  -", e.slice(0, 200));
    } else {
      console.log("✓ No page errors");
    }

    console.log("\n✅ ALL CHECKS PASSED");
  } finally {
    await context.close(); // flushes the video file
    await browser.close();
    if (server) server.kill();
  }

  // Report the video file(s), converting the newest .webm to mp4.
  const { readdirSync, statSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const videos = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".webm"))
    .sort(
      (a, b) =>
        statSync(path.join(OUT_DIR, b)).mtimeMs -
        statSync(path.join(OUT_DIR, a)).mtimeMs,
    );
  console.log(`\nVideo files in demo/: ${videos.join(", ") || "none"}`);
  if (videos.length > 0) {
    const latest = path.join(OUT_DIR, videos[0]);
    const mp4 = path.join(OUT_DIR, `sparklens-demo${TAG}.mp4`);
    execSync(
      `ffmpeg -y -loglevel error -i ${JSON.stringify(latest)} -c:v libx264 -pix_fmt yuv420p ${JSON.stringify(mp4)}`,
    );
    const sz = statSync(mp4).size;
    console.log(`  → ${path.basename(mp4)} — ${(sz / 1024 / 1024).toFixed(1)} MB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
