import { describe, it, expect } from "vitest";
import { analyze } from "./analyzer";

describe("MigraScope Analyzer", () => {
  it("flags DROP TABLE as critical risk with data loss", () => {
    const report = analyze("DROP TABLE users;");
    expect(report.operations).toHaveLength(1);
    expect(report.operations[0].riskLevel).toBe("critical");
    expect(report.operations[0].dataLoss).toBe(true);
    expect(report.operations[0].operation).toBe("DROP TABLE");
    expect(report.overallRisk).toBe("critical");
    expect(report.score).toBe(100);
  });

  it("flags plain ADD COLUMN as low risk", () => {
    const report = analyze("ALTER TABLE users ADD COLUMN bio text;");
    expect(report.operations).toHaveLength(1);
    expect(report.operations[0].riskLevel).toBe("low");
    expect(report.operations[0].dataLoss).toBe(false);
    expect(report.overallRisk).toBe("low");
  });

  it("flags ADD COLUMN NOT NULL without DEFAULT as high risk", () => {
    const report = analyze("ALTER TABLE users ADD COLUMN status int NOT NULL;");
    expect(report.operations[0].riskLevel).toBe("high");
    expect(report.operations[0].suggestion).toMatch(/DEFAULT/);
  });

  it("suggests CONCURRENTLY for blocking CREATE INDEX", () => {
    const report = analyze("CREATE INDEX idx_email ON users (email);");
    expect(report.operations[0].riskLevel).toBe("high");
    expect(report.operations[0].suggestion).toContain("CONCURRENTLY");
  });

  it("rates CREATE INDEX CONCURRENTLY as low risk", () => {
    const report = analyze("CREATE INDEX CONCURRENTLY idx_email ON users (email);");
    expect(report.operations[0].riskLevel).toBe("low");
    expect(report.operations[0].lockType).toBe("SHARE UPDATE EXCLUSIVE");
  });

  it("analyzes multi-statement migrations with correct overall risk", () => {
    const sql = [
      "ALTER TABLE orders ADD COLUMN status varchar(20)",
      "CREATE INDEX CONCURRENTLY idx_status ON orders (status)",
      "ALTER TABLE orders DROP COLUMN legacy_flag",
    ].join(";\n");
    const report = analyze(sql);
    expect(report.operations).toHaveLength(3);
    expect(report.overallRisk).toBe("high");
    expect(report.operations[2].dataLoss).toBe(true);
  });

  it("uses provided table metadata for duration estimates", () => {
    const meta = [{ name: "events", rowCount: 10_000_000, sizeBytes: 5e9 }];
    const report = analyze("ALTER TABLE events ALTER COLUMN payload TYPE jsonb;", meta);
    expect(report.operations[0].estimatedDurationMs).toBeGreaterThan(100_000);
    expect(report.operations[0].riskLevel).toBe("high");
  });

  it("returns empty report for non-migration SQL", () => {
    const report = analyze("SELECT * FROM users;");
    expect(report.operations).toHaveLength(0);
    expect(report.overallRisk).toBe("low");
    expect(report.score).toBe(0);
  });
});
