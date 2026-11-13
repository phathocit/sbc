import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../../packages/database/dist/schema/index.js';

type Database = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | undefined;
let database: Database | undefined;

function getDatabase(): Database {
  if (!database) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL must be set before using the database');
    }

    client = postgres(connectionString, { max: 10 });
    database = drizzle({ client, schema });
  }

  return database;
}

export function getPostgresClient(): postgres.Sql {
  getDatabase();
  return client!;
}

export const db = new Proxy({} as Database, {
  get(_target, property) {
    const value = getDatabase()[property as keyof Database];
    return typeof value === 'function'
      ? value.bind(getDatabase())
      : value;
  },
});
