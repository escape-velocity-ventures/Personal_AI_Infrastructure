#!/usr/bin/env bun
/**
 * Backfill tenant_id on existing pai-memory data.
 *
 * Prerequisite: 001-multi-tenancy.sql migration must have been applied.
 *
 * Usage:
 *   PG_URL=postgresql://... bun run src/migrations/backfill-tenants.ts
 *   PG_URL=postgresql://... bun run src/migrations/backfill-tenants.ts --dry-run
 */

import { Pool } from 'pg';

const PG_URL = process.env.PG_URL ?? process.env.PGURL ?? '';
const DRY_RUN = Bun.argv.includes('--dry-run');

if (!PG_URL) {
  console.error('❌ PG_URL not set');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: PG_URL });

  console.log(`🔄 PAI Memory — Tenant Backfill${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  // Verify migration has been applied
  const tableCheck = await pool.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants')
  `);
  if (!tableCheck.rows[0].exists) {
    console.error('❌ tenants table does not exist. Run 001-multi-tenancy.sql first.');
    await pool.end();
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Step 1: Create users ──
    console.log('👤 Creating users...');

    const userResult = await client.query(`
      INSERT INTO users (handle, email)
      VALUES ('benjamin', 'benjamin@escape-velocity-ventures.org')
      ON CONFLICT (handle) DO UPDATE SET updated_at = NOW()
      RETURNING id, handle
    `);
    const benjaminId = userResult.rows[0].id;
    console.log(`   benjamin: ${benjaminId}`);

    // ── Step 2: Create tenants ──
    console.log('🏢 Creating tenants...');

    const personalResult = await client.query(`
      INSERT INTO tenants (slug, type, name)
      VALUES ('benjamin-personal', 'personal', 'Benjamin (Personal)')
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING id, slug
    `);
    const personalTenantId = personalResult.rows[0].id;
    console.log(`   benjamin-personal: ${personalTenantId}`);

    const orgResult = await client.query(`
      INSERT INTO tenants (slug, type, name, settings)
      VALUES (
        'escape-velocity', 'organization', 'Escape Velocity Ventures',
        '{"domain": "escape-velocity-ventures.org"}'::jsonb
      )
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING id, slug
    `);
    const orgTenantId = orgResult.rows[0].id;
    console.log(`   escape-velocity: ${orgTenantId}`);

    // ── Step 3: Set default tenant ──
    await client.query(`
      UPDATE users SET default_tenant_id = $1 WHERE id = $2
    `, [personalTenantId, benjaminId]);

    // ── Step 4: Create memberships ──
    console.log('🔗 Creating memberships...');

    await client.query(`
      INSERT INTO tenant_members (tenant_id, user_id, role)
      VALUES ($1, $2, 'owner'), ($3, $2, 'owner')
      ON CONFLICT (tenant_id, user_id) DO NOTHING
    `, [personalTenantId, benjaminId, orgTenantId]);
    console.log('   benjamin → owner of both tenants');

    // ── Step 5: Count existing data ──
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM memory_chunks WHERE tenant_id IS NULL) as chunks,
        (SELECT COUNT(*) FROM command_log WHERE tenant_id IS NULL) as commands,
        (SELECT COUNT(*) FROM entities WHERE tenant_id IS NULL) as entities
    `);
    const { chunks, commands, entities } = counts.rows[0];
    console.log(`\n📊 Rows to backfill:`);
    console.log(`   memory_chunks: ${chunks}`);
    console.log(`   command_log:   ${commands}`);
    console.log(`   entities:      ${entities}`);

    // ── Step 6: Backfill tenant_id ──
    if (!DRY_RUN) {
      console.log('\n📝 Backfilling tenant_id...');

      const chunkResult = await client.query(`
        UPDATE memory_chunks
        SET tenant_id = $1, author_id = $2, scope = 'org'
        WHERE tenant_id IS NULL
      `, [orgTenantId, benjaminId]);
      console.log(`   memory_chunks: ${chunkResult.rowCount} rows updated`);

      const cmdResult = await client.query(`
        UPDATE command_log
        SET tenant_id = $1, author_id = $2
        WHERE tenant_id IS NULL
      `, [orgTenantId, benjaminId]);
      console.log(`   command_log:   ${cmdResult.rowCount} rows updated`);

      const entityResult = await client.query(`
        UPDATE entities
        SET tenant_id = $1
        WHERE tenant_id IS NULL
      `, [orgTenantId]);
      console.log(`   entities:      ${entityResult.rowCount} rows updated`);

      await client.query('COMMIT');
      console.log('\n✅ Backfill complete.');
    } else {
      await client.query('ROLLBACK');
      console.log('\n⏭️  Dry run — no changes made.');
    }

    // ── Summary ──
    const verify = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM memory_chunks WHERE tenant_id IS NOT NULL) as chunks_with_tenant,
        (SELECT COUNT(*) FROM memory_chunks WHERE tenant_id IS NULL) as chunks_without_tenant,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM tenants) as tenants,
        (SELECT COUNT(*) FROM tenant_members) as memberships
    `);
    const v = verify.rows[0];
    console.log(`\n📊 Final state:`);
    console.log(`   users:           ${v.users}`);
    console.log(`   tenants:         ${v.tenants}`);
    console.log(`   memberships:     ${v.memberships}`);
    console.log(`   chunks w/tenant: ${v.chunks_with_tenant}`);
    console.log(`   chunks w/o:      ${v.chunks_without_tenant}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
