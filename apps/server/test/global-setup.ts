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

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();

  const pool = new Pool({ connectionString: url });
  const db = drizzle({ client: pool });
  console.log();
  await migrate(db, { migrationsFolder: `${process.cwd()}/apps/server/src/database/migrations` });

  project.provide('databaseUrl', url);
}

export async function tearDown() {
  await container?.stop();
}
