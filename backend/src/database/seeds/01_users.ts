// auth.service.ts uses NestJS decorators (@Injectable); reflect-metadata must be
// loaded before importing it under ts-node (the knex CLI), or the import throws.
import 'reflect-metadata';
import type { Knex } from 'knex';
import { USERS, CUSTOMER_ID_MAP } from '../../auth/auth.service';

export async function seed(knex: Knex): Promise<void> {
  // Wipe and re-seed so the seed is idempotent.
  await knex('users').del();

  const rows = USERS.map((record) => ({
    username: record.user.username,
    password_hash: record.passwordHash,
    company_name: record.user.companyName,
    account_names: record.user.accountNames,
    platforms: record.user.platforms,
    is_admin: record.user.isAdmin,
    // Faithful replication of the current runtime lookup:
    // CUSTOMER_ID_MAP[companyName] || []. Most companyName values don't match a
    // map key today, so most users intentionally get [] (empty DOI), exactly as
    // the in-memory login currently produces.
    customer_ids: CUSTOMER_ID_MAP[record.user.companyName] || [],
  }));

  await knex('users').insert(rows);
}
