import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import process from "node:process";
import * as schema from "./schema/index.js";

let clientInstance: postgres.Sql | null = null;
let dbInstance: PostgresJsDatabase<typeof schema> | null = null;

export function getPostgresClient(connectionString?: string): postgres.Sql {
  if (!clientInstance) {
    const url = connectionString || process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL must be set before initializing database client");
    }
    clientInstance = postgres(url, { max: 10 });
  }
  return clientInstance;
}

export function getDb(connectionString?: string): PostgresJsDatabase<typeof schema> {
  if (!dbInstance) {
    const client = getPostgresClient(connectionString);
    dbInstance = drizzle({ client, schema });
  }
  return dbInstance;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    const activeDb = getDb();
    const value = (activeDb as any)[prop];
    if (typeof value === "function") {
      return value.bind(activeDb);
    }
    return value;
  },
});

export const postgresClient = new Proxy({} as postgres.Sql, {
  get(_target, prop) {
    const client = getPostgresClient();
    const value = (client as any)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export { schema };
export * from "./schema/index.js";
