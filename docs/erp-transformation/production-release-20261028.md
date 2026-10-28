# Production release — 28 October 2026

The user approved the recommended coordinated production release and instructed deployment through GitHub pushes, without Railway CLI login. The release is complete. No Railway or Vercel deployment CLI was used.

## Release sequence

1. Created a full custom-format PostgreSQL backup using `pg_dump`. Verified the whole archive using `pg_restore --file=NUL`; no restore was run against the production database.
2. Pushed temporary maintenance commit `4282ab1c0f8bc04c7e06cb8aa34180031daee386` to `main`. It was based on the previous production source/schema and contained only a maintenance request gate, so any existing deployment migration hook could not prematurely apply the new migrations. Six focused middleware request cases passed before this push.
3. Confirmed the actual Railway endpoint returned `X-Olten-Release: erp-20261028-maintenance`, HTTP 200 at health and HTTP 503 for application requests. Four successive probes confirmed the maintenance state. The first bounded monitor expired before the deployment reached the edge; a subsequent direct probe and monitor confirmed it. No database migration was attempted before confirmation.
4. Took and verified a second full backup while requests were paused. Rechecked all eight existing migration checksums and allocation ownership; there were zero mismatches and no unfinished migrations. Captured sorted-row counts/SHA256 digests for the original columns of 64 existing tables. This included financial, payroll, inventory and sales data; unrelated document-expiry cron tables and Admin online status were excluded.
5. Ran `npx prisma migrate deploy` against the existing configured production database. Exactly these four migrations succeeded:
   - `20261026000000_allocation_ownership`
   - `20261026010000_cash_flow_classification`
   - `20261026020000_posting_role_mapping`
   - `20261027000000_company_navigation`
6. Confirmed `npx prisma migrate status` reports **Database schema is up to date**, with all 12 migrations applied.
7. Compared the same original columns in all 64 protected tables while maintenance was still active. Every row count and digest matched. The new allocation ownership fields matched their existing payment/document parents; the new cash-flow/menu metadata tables started empty. No amounts, payroll entries, prices, inventory quantities, source orders or financial history were recalculated, deleted or repaired.
8. Merged the already-tested application into the release branch and removed the temporary maintenance gate. Before push, `git diff 75cea08 HEAD --exit-code` confirmed the release tree was identical to the tested implementation. Pushed merge commit **`2ebdc8a98babfa54abab66358915ba4156b653a1`** to `main`.
9. GitHub commit statuses reported success for both **Vercel** and **lucky-spontaneity - olten** (the existing Railway service). The live backend returned normal HTTP 200 health without the maintenance header on four successive probes. The application was reopened only by the matching code release after migration/data verification.

## Backup evidence

The paused-state archive is retained locally in the ignored folder:

`D:\olten\backend\.tmp\production-release-20261028\production-before-release-1793159366814.dump`

- Bytes: **479,908**
- SHA256: **1b5aa402174a1417c534a681916d5dd5087ef495461333a438d3b12241b7f8b0**
- PostgreSQL server and backup tools: **18.6**
- Full archive read/decompression: **passed**

The archive contains private production data and is deliberately excluded from Git and customer-facing assets. An earlier independently validated pre-maintenance backup is retained in the same ignored folder. No production credentials or raw record contents were printed or committed.

## Live verification

These previously missing routes now return **401** to an intentionally invalid bearer token, demonstrating deployed routing and active authentication instead of the former 404:

- `/phase3/books/reports/financial-overview`
- `/phase3/books/reports/profit-loss`
- `/phase3/books/cash-flow/entries`
- `/phase3/books/inventory-reconciliation`
- `/companies/navigation`

CORS preflight from `https://olten.vercel.app` returned **204** and the correct allowed origin.

The live frontend returned **200**, with entry asset `/assets/index-DWh2FLtD.js`. The deployed assets contain **Edit company menu**, **Save company menu** and **Close report**, confirming the new menu/editor and report popup code is published.

Separately, the real Books service code executed all four reported queries for each of the **four existing companies**: **16 report transactions passed**. Each transaction explicitly set PostgreSQL `READ ONLY` and checked `transaction_read_only = on`. The queries used existing company/admin metadata and performed no writes. No production authentication token was forged, password changed or live financial fixture created.

Authenticated HTTP 200/browser report views were not rechecked in production: no usable signed-in automation browser session was available, and the user's native Chrome window was minimized. This does not replace the prior isolated end-to-end checks. Refreshing the app and signing in again may be necessary after the backend restart.

## Commands and retained evidence

- `git push origin HEAD:main` — maintenance and final application releases, both successful.
- `node .tmp/production-release-20261028/backup.cjs` — twice; both full backups validated.
- `node .tmp/production-release-20261028/snapshot.cjs before` / `after` — zero allocation mismatches; **64/64 original data digests unchanged**.
- `npx prisma migrate deploy` — four migrations successfully applied.
- `npx prisma migrate status` — all 12 migrations applied; schema up to date.
- `node .tmp/production-release-20261028/verify-reports.cjs` — 16 read-only report transactions passed.
- Direct HTTP health, route/authentication, CORS and frontend-asset checks — passed as described above.

The application code was unchanged from the implementation already verified with **1,350 backend tests, 75 frontend tests, type checks and builds**. Existing frontend lint issues remain as recorded in the [workspace verification](responsive-workspaces-verification.md). The temporary maintenance middleware was tested and removed from the final tree.

Only this release record and a status banner in the earlier verification document were added after the application deployment. The original workspace's unrelated deletions/untracked files were preserved.
