# 🔬 MigraScope

**Database Migration Risk Analyzer** — Preview the real cost of schema changes before deploying.

MigraScope statically analyzes your SQL migration files against production table metadata to predict lock types, estimated downtime, data loss risk, and actionable suggestions.

## 🚀 Quick Start

```bash
npm install
npx tsx src/index.ts analyze migration.sql
npx tsx src/index.ts analyze migration.sql --meta tables.json
npx tsx src/index.ts serve 3000
```

### API Usage

```bash
curl -X POST http://localhost:3000/api/v1/analyze \
  -H 'Content-Type: application/json' \
  -d '{"sql": "ALTER TABLE users DROP COLUMN email;", "tableMeta": [{"name":"users","rowCount":5000000,"sizeBytes":2e9}]}'
```

### CI/CD Integration

Exit codes: `0` = safe, `1` = high risk, `2` = critical risk.

```yaml
- run: npx migrascope analyze db/migrate/*.sql --meta prod-meta.json
```

## 📊 Why Pay for MigraScope?

| Pain Point | Without MigraScope | With MigraScope |
|---|---|---|
| Lock duration | Unknown until prod | Estimated before merge |
| Data loss risk | Discovered in incident | Flagged in PR review |
| Index strategy | Hope for the best | Actionable suggestions |
| Downtime | Minutes to hours | Predicted in seconds |

## 💰 Pricing

| Feature | Free | Pro $29/mo | Enterprise $199/mo |
|---|:---:|:---:|:---:|
| SQL risk analysis | ✅ | ✅ | ✅ |
| CLI with exit codes | ✅ | ✅ | ✅ |
| Migrations per day | 5 | Unlimited | Unlimited |
| REST API access | — | ✅ | ✅ |
| CI/CD GitHub Action | — | ✅ | ✅ |
| PR comment bot | — | ✅ | ✅ |
| Custom risk rules | — | — | ✅ |
| MySQL / SQL Server | — | — | ✅ |
| SSO / SAML | — | — | ✅ |
| Slack/Teams alerts | — | ✅ | ✅ |
| SLA & priority support | — | — | ✅ |

## License

BSL 1.1 — Free for teams ≤5. Commercial license required for larger teams.
