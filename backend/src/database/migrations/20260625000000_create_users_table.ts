import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.text('username').notNullable().unique();
    table.text('password_hash').notNullable();
    table.text('company_name').notNullable();
    table
      .specificType('account_names', 'text[]')
      .notNullable()
      .defaultTo(knex.raw("'{}'::text[]"));
    table
      .specificType('platforms', 'text[]')
      .notNullable()
      .defaultTo(knex.raw("'{}'::text[]"));
    table.boolean('is_admin').notNullable().defaultTo(false);
    table
      .specificType('customer_ids', 'text[]')
      .notNullable()
      .defaultTo(knex.raw("'{}'::text[]"));
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
