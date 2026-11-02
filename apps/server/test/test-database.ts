import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const migrationsFolder = fileURLToPath(new URL('../src/database/migrations', import.meta.url));

export type TestDatabase = {
  url: string;
  /** Drops the database; close every pool connected to it first. */
  drop: () => Promise<void>;
};

/**
 * Creates an empty, migrated database inside the shared test container. Test files run in
 * parallel against one container, so a file that truncates tables or counts rows needs a database
 * of its own; `postgres-chat-store.integration.spec.ts` is the one file that uses the shared one.
 */
export async function createTestDatabase(containerUrl: string): Promise<TestDatabase> {
  const name = `test_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: containerUrl });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(containerUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }

  return {
    url: url.toString(),
    drop: async () => {
      const dropper = new Pool({ connectionString: containerUrl });
      try {
        await dropper.query(`DROP DATABASE ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    },
  };
}
