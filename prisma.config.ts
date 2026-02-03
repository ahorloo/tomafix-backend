import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Prisma CLI may be run from `apps/api` or from the repo root.
// Load whichever .env exists so DATABASE_URL is available for Prisma.
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "apps/api/.env"),
];
const envPath = envCandidates.find((p) => fs.existsSync(p));
if (envPath) loadEnv({ path: envPath });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Prisma 7: keep the connection URL here (NOT in schema.prisma)
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});