import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Next reads `.env.local`; the Prisma CLI does not. Loading it here keeps one
// DATABASE_URL working for both, rather than asking the reader to maintain the
// same value in two files.
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env["DATABASE_URL"] ?? "file:./prisma/dev.db",
  },
});
