import type { Knex } from 'knex';

// Cosmetic short brand name shown in the dashboard header. NOT a filter key —
// tenant isolation still keys entirely off company_name (see cache.service.ts
// filterCompany/filterAndDate). Nullable: when unset, the frontend falls back to
// company_name.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.text('display_name').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('display_name');
  });
}
