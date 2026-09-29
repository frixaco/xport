import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../db/schema.ts";

export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL! }), { schema });
