import { describe, it, expect } from 'vitest';
import { calculateRiskScore, ParsedMigration, TableMetadata } from './scorer';

describe('Migration Risk Scoring Engine', () => {
  // Acceptance criterion: DROP TABLE on a 10M row table with 5 FKs scores 'critical'
  it('scores DROP TABLE on a 10M row table with 5 FKs as critical', () => {
    const migration: ParsedMigration = {
      sql: 'DROP TABLE users;',
      operation: 'DROP TABLE',
      table: 'users',
    };
    const metadata: TableMetadata = {
      name: 'users',
      rowCount: 10_000_000,
      sizeBytes: 5e9,
      foreignKeyCount: 5,
    };
    const report = calculateRiskScore(migration, metadata);
    expect(report.riskLevel).toBe('critical');
    expect(report.overallScore).toBeGreaterThanOrEqual(76);
    expect(report.factors).toHaveLength(4);
  });

  // Acceptance criterion: ADD COLUMN nullable on small table scores 'low'
  it('scores ADD COLUMN nullable on small table as low', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE tags ADD COLUMN description text;',
      operation: 'ADD COLUMN',
      table: 'tags',
      details: { isNullable: true },
    };
    const metadata: TableMetadata = {
      name: 'tags',
      rowCount: 500,
      sizeBytes: 50_000,
      foreignKeyCount: 0,
    };
    const report = calculateRiskScore(migration, metadata);
    expect(report.riskLevel).toBe('low');
    expect(report.overallScore).toBeLessThanOrEqual(25);
  });

  // Risk factor: table size impact — large table scores higher
  it('scores table size impact higher for tables with >1M rows', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE logs ADD COLUMN level text;',
      operation: 'ADD COLUMN',
      table: 'logs',
      details: { isNullable: true },
    };
    const smallMeta: TableMetadata = { name: 'logs', rowCount: 1_000, sizeBytes: 1e5 };
    const largeMeta: TableMetadata = { name: 'logs', rowCount: 5_000_000, sizeBytes: 5e9 };

    const smallReport = calculateRiskScore(migration, smallMeta);
    const largeReport = calculateRiskScore(migration, largeMeta);

    expect(largeReport.overallScore).toBeGreaterThan(smallReport.overallScore);
    const smallSizeFactor = smallReport.factors.find(f => f.name === 'Table Size Impact')!;
    const largeSizeFactor = largeReport.factors.find(f => f.name === 'Table Size Impact')!;
    expect(largeSizeFactor.score).toBeGreaterThan(smallSizeFactor.score);
  });

  // Risk factor: lock risk — ALTER COLUMN TYPE scores high
  it('scores ALTER COLUMN TYPE with high lock risk', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE users ALTER COLUMN age TYPE bigint;',
      operation: 'ALTER COLUMN TYPE',
      table: 'users',
      details: { columnTypeChange: true },
    };
    const metadata: TableMetadata = { name: 'users', rowCount: 100_000, sizeBytes: 1e8 };
    const report = calculateRiskScore(migration, metadata);
    const lockFactor = report.factors.find(f => f.name === 'Lock Risk')!;
    expect(lockFactor.score).toBeGreaterThanOrEqual(80);
  });

  // Risk factor: lock risk — non-concurrent ADD INDEX scores high
  it('scores non-concurrent CREATE INDEX with high lock risk', () => {
    const migration: ParsedMigration = {
      sql: 'CREATE INDEX idx_email ON users (email);',
      operation: 'CREATE INDEX',
      table: 'users',
      details: { isConcurrent: false },
    };
    const metadata: TableMetadata = { name: 'users', rowCount: 500_000, sizeBytes: 5e8 };
    const report = calculateRiskScore(migration, metadata);
    const lockFactor = report.factors.find(f => f.name === 'Lock Risk')!;
    expect(lockFactor.score).toBeGreaterThanOrEqual(70);
  });

  // Risk factor: cascade risk — many FKs score higher
  it('scores cascade risk higher for tables with many foreign keys', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE orders DROP COLUMN user_id;',
      operation: 'DROP COLUMN',
      table: 'orders',
    };
    const noFkMeta: TableMetadata = { name: 'orders', rowCount: 100_000, sizeBytes: 1e8, foreignKeyCount: 0 };
    const manyFkMeta: TableMetadata = { name: 'orders', rowCount: 100_000, sizeBytes: 1e8, foreignKeyCount: 7 };

    const noFkReport = calculateRiskScore(migration, noFkMeta);
    const manyFkReport = calculateRiskScore(migration, manyFkMeta);

    const noFkCascade = noFkReport.factors.find(f => f.name === 'Cascade Risk')!;
    const manyFkCascade = manyFkReport.factors.find(f => f.name === 'Cascade Risk')!;
    expect(manyFkCascade.score).toBeGreaterThan(noFkCascade.score);
    expect(manyFkCascade.score).toBeGreaterThanOrEqual(50);
  });

  // Risk factor: data loss — DROP COLUMN detected
  it('detects data loss risk for DROP COLUMN', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE users DROP COLUMN email;',
      operation: 'DROP COLUMN',
      table: 'users',
    };
    const metadata: TableMetadata = { name: 'users', rowCount: 50_000, sizeBytes: 5e7 };
    const report = calculateRiskScore(migration, metadata);
    const dataLossFactor = report.factors.find(f => f.name === 'Data Loss Risk')!;
    expect(dataLossFactor.score).toBeGreaterThanOrEqual(70);
    expect(dataLossFactor.explanation).toContain('DROP COLUMN');
  });

  // Edge case: empty table
  it('scores operations on empty table with zero rows as low risk', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE empty_table ADD COLUMN new_col text;',
      operation: 'ADD COLUMN',
      table: 'empty_table',
      details: { isNullable: true },
    };
    const metadata: TableMetadata = { name: 'empty_table', rowCount: 0, sizeBytes: 0, foreignKeyCount: 0 };
    const report = calculateRiskScore(migration, metadata);
    expect(report.riskLevel).toBe('low');
    expect(report.overallScore).toBeLessThanOrEqual(25);
  });

  // Edge case: ADD COLUMN NOT NULL without DEFAULT
  it('scores ADD COLUMN NOT NULL without DEFAULT with elevated lock risk', () => {
    const migration: ParsedMigration = {
      sql: 'ALTER TABLE users ADD COLUMN status int NOT NULL;',
      operation: 'ADD COLUMN',
      table: 'users',
      details: { isNullable: false, hasDefault: false },
    };
    const metadata: TableMetadata = { name: 'users', rowCount: 500_000, sizeBytes: 5e8 };
    const report = calculateRiskScore(migration, metadata);
    const lockFactor = report.factors.find(f => f.name === 'Lock Risk')!;
    expect(lockFactor.score).toBeGreaterThanOrEqual(50);
  });

  // Edge case: concurrent index creation scores low lock risk
  it('scores CREATE INDEX CONCURRENTLY with low lock risk', () => {
    const migration: ParsedMigration = {
      sql: 'CREATE INDEX CONCURRENTLY idx_email ON users (email);',
      operation: 'CREATE INDEX',
      table: 'users',
      details: { isConcurrent: true },
    };
    const metadata: TableMetadata = { name: 'users', rowCount: 1_000_000, sizeBytes: 1e9 };
    const report = calculateRiskScore(migration, metadata);
    const lockFactor = report.factors.find(f => f.name === 'Lock Risk')!;
    expect(lockFactor.score).toBeLessThanOrEqual(20);
  });

  // Structure: always returns exactly 4 risk factors with correct names
  it('always returns exactly 4 risk factors with expected names', () => {
    const migration: ParsedMigration = {
      sql: 'DROP TABLE sessions;',
      operation: 'DROP TABLE',
      table: 'sessions',
    };
    const metadata: TableMetadata = { name: 'sessions', rowCount: 100, sizeBytes: 1e4 };
    const report = calculateRiskScore(migration, metadata);
    expect(report.factors).toHaveLength(4);
    const names = report.factors.map(f => f.name);
    expect(names).toContain('Table Size Impact');
    expect(names).toContain('Lock Risk');
    expect(names).toContain('Cascade Risk');
    expect(names).toContain('Data Loss Risk');
  });
});
