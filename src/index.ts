import express from "express";
import { readFileSync } from "fs";
import { analyze, TableMeta } from "./analyzer";

const app = express();
app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "migrascope", version: "1.0.0" });
});

app.post("/api/v1/analyze", (req, res) => {
  const { sql, tableMeta } = req.body;
  if (!sql || typeof sql !== "string") {
    res.status(400).json({ error: "'sql' field is required and must be a string" });
    return;
  }
  const report = analyze(sql, tableMeta || []);
  res.json(report);
});

export { app };

function cli() {
  const args = process.argv.slice(2);

  if (args[0] === "serve") {
    const port = parseInt(args[1] || "3000", 10);
    app.listen(port, () => console.log(`🔬 MigraScope API running on http://localhost:${port}`));
    return;
  }

  if (args[0] === "analyze" && args[1]) {
    const sql = readFileSync(args[1], "utf-8");
    let meta: TableMeta[] = [];
    const mi = args.indexOf("--meta");
    if (mi !== -1 && args[mi + 1]) {
      meta = JSON.parse(readFileSync(args[mi + 1], "utf-8"));
    }
    const report = analyze(sql, meta);
    const colors: Record<string, string> = { low: "\x1b[32m", medium: "\x1b[33m", high: "\x1b[31m", critical: "\x1b[35m" };
    const X = "\x1b[0m";
    console.log(`\n🔬 MigraScope Analysis Report`);
    console.log("─".repeat(50));
    console.log(`Overall Risk: ${colors[report.overallRisk]}${report.overallRisk.toUpperCase()}${X}  (score: ${report.score}/100)`);
    console.log(`Estimated Duration: ${report.totalEstimatedDurationMs}ms`);
    console.log(`Operations found: ${report.operations.length}\n`);
    for (const op of report.operations) {
      const c = colors[op.riskLevel];
      console.log(`  ${c}●${X} [${op.riskLevel.toUpperCase()}] ${op.operation} on \"${op.table}\"`);
      console.log(`    Lock: ${op.lockType} | ~${op.estimatedDurationMs}ms | Data Loss: ${op.dataLoss ? "⚠️  YES" : "✅ No"}`);
      console.log(`    💡 ${op.suggestion}\n`);
    }
    process.exit(report.overallRisk === "critical" ? 2 : report.overallRisk === "high" ? 1 : 0);
    return;
  }

  console.log("🔬 MigraScope — Database Migration Risk Analyzer\n");
  console.log("Usage:");
  console.log("  migrascope analyze <file.sql> [--meta meta.json]");
  console.log("  migrascope serve [port]");
  console.log("\nExamples:");
  console.log("  npx tsx src/index.ts analyze migration.sql");
  console.log("  npx tsx src/index.ts serve 3000");
}

cli();
