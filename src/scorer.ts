export interface ParsedMigration {
  sql: string;
  operation: string;
  table: string;
  details?: {
    isNullable?: boolean;
    hasDefault?: boolean;
    columnTypeChange?: boolean;
    isConcurrent?: boolean;
  };
}

export interface TableMetadata {
  name: string;
  rowCount: number;
  sizeBytes: number;
  foreignKeyCount?: number;
  referencedByCount?: number;
}

export interface RiskFactor {
  name: string;
  score: number;
  explanation: string;
}

export interface RiskReport {
  overallScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
}

const WEIGHTS = {
  tableSize: 0.25,
  lockRisk: 0.30,
  cascadeRisk: 0.20,
  dataLoss: 0.25,
};

function scoreTableSize(rowCount: number): RiskFactor {
  let score: number;
  let explanation: string;

  if (rowCount <= 0) {
    score = 0;
    explanation = 'Empty table — no size impact.';
  } else if (rowCount < 10_000) {
    score = 5;
    explanation = `Small table (${rowCount.toLocaleString()} rows) — minimal size impact.`;
  } else if (rowCount < 100_000) {
    score = 15;
    explanation = `Moderate table (${rowCount.toLocaleString()} rows) — low size impact.`;
  } else if (rowCount < 1_000_000) {
    score = 35;
    explanation = `Large table (${rowCount.toLocaleString()} rows) — notable size impact.`;
  } else if (rowCount < 10_000_000) {
    score = 65;
    explanation = `Very large table (${rowCount.toLocaleString()} rows) — significant size impact.`;
  } else if (rowCount < 100_000_000) {
    score = 85;
    explanation = `Massive table (${rowCount.toLocaleString()} rows) — high size impact.`;
  } else {
    score = 100;
    explanation = `Enormous table (${rowCount.toLocaleString()} rows) — extreme size impact.`;
  }

  return { name: 'Table Size Impact', score, explanation };
}

function scoreLockRisk(migration: ParsedMigration): RiskFactor {
  const op = migration.operation.toUpperCase();
  const details = migration.details || {};
  let score: number;
  let explanation: string;

  if (op === 'ALTER COLUMN TYPE' || details.columnTypeChange) {
    score = 90;
    explanation = 'Column type change requires full table rewrite with ACCESS EXCLUSIVE lock.';
  } else if (op === 'CREATE INDEX' || op === 'ADD INDEX') {
    if (details.isConcurrent) {
      score = 15;
      explanation = 'Concurrent index creation uses SHARE UPDATE EXCLUSIVE lock — minimal blocking.';
    } else {
      score = 80;
      explanation = 'Non-concurrent index creation holds SHARE lock, blocking all writes.';
    }
  } else if (op === 'TRUNCATE') {
    score = 75;
    explanation = 'TRUNCATE requires ACCESS EXCLUSIVE lock.';
  } else if (op === 'DROP TABLE') {
    score = 70;
    explanation = 'DROP TABLE requires ACCESS EXCLUSIVE lock, blocking all concurrent operations.';
  } else if (op === 'DROP COLUMN') {
    score = 70;
    explanation = 'DROP COLUMN requires ACCESS EXCLUSIVE lock on the table.';
  } else if (op === 'ADD COLUMN') {
    if (!details.isNullable && !details.hasDefault) {
      score = 60;
      explanation = 'ADD COLUMN NOT NULL without DEFAULT requires table rewrite and ACCESS EXCLUSIVE lock.';
    } else {
      score = 10;
      explanation = 'ADD COLUMN (nullable or with default) is a metadata-only change — minimal lock.';
    }
  } else {
    score = 20;
    explanation = `Operation "${op}" may require table-level lock.`;
  }

  return { name: 'Lock Risk', score, explanation };
}

function scoreCascadeRisk(metadata: TableMetadata): RiskFactor {
  const fkCount = (metadata.foreignKeyCount || 0) + (metadata.referencedByCount || 0);
  let score: number;
  let explanation: string;

  if (fkCount === 0) {
    score = 0;
    explanation = 'No foreign key relationships — no cascade risk.';
  } else if (fkCount <= 2) {
    score = 20;
    explanation = `${fkCount} foreign key relationship(s) — low cascade risk.`;
  } else if (fkCount <= 4) {
    score = 50;
    explanation = `${fkCount} foreign key relationships — moderate cascade risk.`;
  } else if (fkCount <= 9) {
    score = 80;
    explanation = `${fkCount} foreign key relationships — high cascade risk. Changes may trigger cascading locks or constraint checks.`;
  } else {
    score = 100;
    explanation = `${fkCount} foreign key relationships — extreme cascade risk.`;
  }

  return { name: 'Cascade Risk', score, explanation };
}

function scoreDataLoss(migration: ParsedMigration): RiskFactor {
  const op = migration.operation.toUpperCase();
  let score: number;
  let explanation: string;

  if (op === 'DROP TABLE') {
    score = 100;
    explanation = 'DROP TABLE permanently destroys the entire table and all its data.';
  } else if (op === 'TRUNCATE') {
    score = 90;
    explanation = 'TRUNCATE removes all rows from the table.';
  } else if (op === 'DROP COLUMN') {
    score = 80;
    explanation = 'DROP COLUMN permanently removes column data from all rows.';
  } else {
    score = 0;
    explanation = 'No data loss risk detected for this operation.';
  }

  return { name: 'Data Loss Risk', score, explanation };
}

function determineRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score <= 25) return 'low';
  if (score <= 50) return 'medium';
  if (score <= 75) return 'high';
  return 'critical';
}

export function calculateRiskScore(migration: ParsedMigration, metadata: TableMetadata): RiskReport {
  const tableSizeFactor = scoreTableSize(metadata.rowCount);
  const lockRiskFactor = scoreLockRisk(migration);
  const cascadeRiskFactor = scoreCascadeRisk(metadata);
  const dataLossFactor = scoreDataLoss(migration);

  const factors: RiskFactor[] = [
    tableSizeFactor,
    lockRiskFactor,
    cascadeRiskFactor,
    dataLossFactor,
  ];

  const overallScore = Math.round(
    WEIGHTS.tableSize * tableSizeFactor.score +
    WEIGHTS.lockRisk * lockRiskFactor.score +
    WEIGHTS.cascadeRisk * cascadeRiskFactor.score +
    WEIGHTS.dataLoss * dataLossFactor.score
  );

  const riskLevel = determineRiskLevel(overallScore);

  return {
    overallScore,
    riskLevel,
    factors,
  };
}
