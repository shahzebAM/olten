// Creates an isolated PostgreSQL schema, tests the real migration + HTTP API,
// and drops only that randomly named test schema. No application rows are used.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for isolated PostgreSQL tests.');
  const schema = `phase7_test_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let created = false;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(readFileSync(join(__dirname, 'fixtures/phase7-baseline.sql'), 'utf8'));
    // A pre-existing O.S. verifies that the additive migration preserves history.
    await client.query(`INSERT INTO "Customer" (id, company, name) VALUES ('legacy-customer', 'Phase7', 'Legacy customer');
      INSERT INTO "Product" (company, name, sku, category, "purchasePrice", "sellingPrice", unit, "vatSetting")
        VALUES ('Phase7', 'Legacy product', 'LEGACY', 'Test', 1, 1, 'pcs', 'NONE');
      INSERT INTO "OrderSlip" (id, "osNumber", company, "customerId", status, subtotal, "vatAmount", "grandTotal", "createdBy", "updatedAt")
        VALUES ('legacy-os', 'LEGACY-OS', 'Phase7', 'legacy-customer', 'Generated', 50, 0, 50, 'tester', NOW());
      INSERT INTO "OrderSlipItem" (id, "orderSlipId", "productId", sku, "productName", "requestedQty", "unitPrice", "lineTotal")
        VALUES ('legacy-item', 'legacy-os', 1, 'LEGACY', 'Legacy product', 50, 1, 50);`);
    await client.query(readFileSync(join(__dirname, '../prisma/migrations/20260914000000_physical_stock_verification/migration.sql'), 'utf8'));
    const testUrl = new URL(process.env.DATABASE_URL);
    testUrl.searchParams.set('schema', schema);
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [require.resolve('jest/bin/jest'), '--config', 'test/jest-phase7.json', '--runInBand'], {
        cwd: join(__dirname, '..'), stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl.toString(), PHASE7_TEST_SCHEMA: schema },
      });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    process.exitCode = exitCode ?? 1;
  } finally {
    if (created && /^phase7_test_[a-f0-9]{32}$/.test(schema)) {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      console.log('Isolated Phase 7 test schema removed.');
    }
    await client.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
