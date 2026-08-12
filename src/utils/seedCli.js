/**
 * seed.cli.js
 *
 * One-time / weekly CLI script to push a JSON trend file into MongoDB.
 *
 * Usage:
 *   node seed.cli.js --file ./data/trends-2025-W22.json --week 2025-W22
 *   node seed.cli.js --file ./data/trends-2025-W22.json          # week auto-detected
 *
 * Environment variables required (can use .env):
 *   MONGODB_URI   - MongoDB connection string
 */

import "dotenv/config";
import { readFileSync } from "fs";
import path from "path";
import mongoose from "mongoose";
import { seedTrendData } from "./seeders/trendIntel.seeder.js";

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
};

const filePath = getArg("--file");
const week = getArg("--week"); // optional

if (!filePath) {
  console.error("Usage: node seed.cli.js --file <path-to-json> [--week YYYY-WNN]");
  process.exit(1);
}

// ── Connect ───────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI environment variable is required.");
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("[seed.cli] Connected to MongoDB.");

  const rawJson = JSON.parse(
    readFileSync(path.resolve(filePath), "utf-8"),
  );

  console.log(`[seed.cli] Seeding data${week ? ` for week ${week}` : " (auto-detecting week)"}…`);

  const { upserted, errors } = await seedTrendData(rawJson, week || undefined);

  if (upserted.length) {
    console.log(`[seed.cli] ✅ Upserted industries: ${upserted.join(", ")}`);
  }
  if (errors.length) {
    console.error(`[seed.cli] ⚠️  Errors:\n${errors.join("\n")}`);
  }

  await mongoose.disconnect();
  console.log("[seed.cli] Done.");
}

run().catch((err) => {
  console.error("[seed.cli] Fatal:", err);
  process.exit(1);
});