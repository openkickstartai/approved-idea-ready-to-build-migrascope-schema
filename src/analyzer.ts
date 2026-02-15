export interface TableMeta {
  name: string;
  rowCount: number;
  sizeBytes: number;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskItem {
  operation: string;
  table: string;
  riskLevel: RiskLevel;
  lockType: string;
  estimatedDurationMs: number;
  dataLoss: boolean;
  suggestion: string;
}

export interface AnalysisReport {
  operations: RiskItem[];
  overallRisk: RiskLevel;
  totalEstimatedDurationMs: number;
  score: number;
}

interface Rule {
  pattern: RegExp;
  assess: (meta: TableMeta, sql: string) => Omit<RiskItem, "table">;
}

const R = 0.01; // ms per row baseline
const SCORES: Record<RiskLevel, number> = { low: 10, medium: 40, high: 70, critical: 100 };
const DEFAULT_META: TableMeta = { name: "unknown", rowCount: 100000, sizeBytes: 1e7 };

const mk = (operation: string, riskLevel: RiskLevel, lockType: string, estimatedDurationMs: number, dataLoss: boolean, suggestion: string): Omit<RiskItem, "table"> =>
  ({ operation, riskLevel, lockType, estimatedDurationMs, dataLoss, suggestion });

const RULES: Rule[] = [
  {
    pattern: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)/i,
    assess: (m) => mk("DROP TABLE", "critical", "ACCESS EXCLUSIVE", 50, true, "Ensure full backup. Consider renaming to _deprecated instead."),
  },
  {
    pattern: /ALTER\s+TABLE\s+"?(\w+)"?\s+DROP\s+COLUMN/i,
    assess: (m) => mk("DROP COLUMN", "high", "ACCESS EXCLUSIVE", m.rowCount * R, true, "Column data will be permanently lost. Add deprecation period first."),
  },
  {
    pattern: /ALTER\s+TABLE\s+"?(\w+)"?\s+ALTER\s+COLUMN\s+\w+\s+(?:SET\s+DATA\s+)?TYPE/i,
    assess: (m) => mk("ALTER COLUMN TYPE", "high", "ACCESS EXCLUSIVE", m.rowCount * R * 2, false, "Full table rewrite required. Schedule during maintenance window."),
  },
  {
    pattern: /ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN/i,
    assess: (m, sql) => /NOT\s+NULL/i.test(sql) && !/DEFAULT/i.test(sql)
      ? mk("ADD COLUMN (NOT NULL, no default)", "high", "ACCESS EXCLUSIVE", m.rowCount * R * 2, false, "Add DEFAULT value or use nullable + backfill + set NOT NULL strategy.")
      : mk("ADD COLUMN", "low", "ACCESS EXCLUSIVE (brief)", 10, false, "Safe in PostgreSQL 11+. Fast metadata-only operation."),
  },
  {
    pattern: /CREATE\s+INDEX\s+CONCURRENTLY\s+\w+\s+ON\s+"?(\w+)/i,
    assess: (m) => mk("CREATE INDEX CONCURRENTLY", "low", "SHARE UPDATE EXCLUSIVE", m.rowCount * R * 3, false, "Good practice. Monitor for long-running transactions that may block."),
  },
  {
    pattern: /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)\w+\s+ON\s+"?(\w+)/i,
    assess: (m) => mk("CREATE INDEX", "high", "SHARE", m.rowCount * R * 3, false, "Use CREATE INDEX CONCURRENTLY to avoid blocking writes."),
  },
  {
    pattern: /ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+CONSTRAINT/i,
    assess: (m) => mk("ADD CONSTRAINT", "medium", "ACCESS EXCLUSIVE", m.rowCount * R, false, "For FK constraints, use NOT VALID then VALIDATE CONSTRAINT separately."),
  },
  {
    pattern: /ALTER\s+TABLE\s+"?(\w+)"?\s+RENAME/i,
    assess: () => mk("RENAME", "medium", "ACCESS EXCLUSIVE (brief)", 10, false, "Update all application queries referencing the old name."),
  },
];

export function analyze(sql: string, tableMeta: TableMeta[] = []): AnalysisReport {
  const metaMap = new Map(tableMeta.map((t) => [t.name.toLowerCase(), t]));
  const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
  const operations: RiskItem[] = [];

  for (const stmt of stmts) {
    for (const rule of RULES) {
      const match = rule.pattern.exec(stmt);
      if (match) {
        const table = match[1] || "unknown";
        const meta = metaMap.get(table.toLowerCase()) || { ...DEFAULT_META, name: table };
        operations.push({ ...rule.assess(meta, stmt), table });
        break;
      }
    }
  }

  const overallRisk = operations.reduce<RiskLevel>((max, op) =>
    SCORES[op.riskLevel] > SCORES[max] ? op.riskLevel : max, "low");
  const totalEstimatedDurationMs = Math.round(operations.reduce((s, o) => s + o.estimatedDurationMs, 0));
  const score = operations.length === 0 ? 0 : Math.round(operations.reduce((s, o) => s + SCORES[o.riskLevel], 0) / operations.length);

  return { operations, overallRisk, totalEstimatedDurationMs, score };
}
