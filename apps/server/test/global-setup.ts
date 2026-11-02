import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const migrationsFolder = fileURLToPath(new URL('../src/database/migrations', import.meta.url));

let container: StartedPostgreSqlContainer | undefined;

async function startContainer(): Promise<StartedPostgreSqlContainer> {
  try {
    return await new PostgreSqlContainer('postgres:17-alpine').start();
  } catch (error) {
    if (error instanceof Error && error.message.includes('container runtime')) {
      throw new Error('Docker is not running. Server tests start a temporary Postgres container.', {
        cause: error,
      });
    }
    throw error;
  }
}

export async function setup(project: TestProject) {
  container = await startContainer();
  const url = container.getConnectionUri();

  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } catch (error) {
    // Vitest does not call teardown when setup throws.
    await container.stop();
    throw error;
  } finally {
    await pool.end();
  }

  project.provide('databaseUrl', url);
}

export async function teardown() {
  await container?.stop();
}
