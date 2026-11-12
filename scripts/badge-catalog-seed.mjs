#!/usr/bin/env node
/**
 * Generate the managed badge-catalog seed from verified public-profile evidence.
 *
 * The catalog identity is the structural modal target, never the award-scoped
 * /badges/<id> URL:
 *   /course_templates/<id> -> course_template:<id>  (skill)
 *   /games/<id>            -> game:<id>             (arcade)
 *
 * Usage:
 *   node scripts/badge-catalog-seed.mjs [--input <csv>] [--output <sql>]
 *
 * The script refuses to emit seed SQL unless the evidence is internally
 * consistent (no unknown signals, no duplicate signal/category conflicts, and
 * the expected 47 Skill + 17 Arcade definition counts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_INPUT = "data/raw_profiles-2026-11-09/badge-classification.csv";
const EXPECTED_SKILL = 47;
const EXPECTED_ARCADE = 17;

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeBadgeSignal(signal) {
  const value = String(signal ?? "").trim();
  const course = /^\/course_templates\/([1-9][0-9]*)$/.exec(value);
  if (course) return { badgeKey: `course_template:${course[1]}`, category: "skill" };
  const game = /^\/games\/([1-9][0-9]*)$/.exec(value);
  if (game) return { badgeKey: `game:${game[1]}`, category: "arcade" };
  return null;
}

function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, "");
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim() !== "")) records.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += character;
      }
      continue;
    }
    if (character === ",") finishField();
    else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === '"') {
      if (field.length > 0 || afterQuote) throw new Error("Unexpected quote in CSV field.");
      quoted = true;
    } else if (!afterQuote) {
      field += character;
    }
  }
  if (quoted) throw new Error("Unclosed quoted field.");
  if (field.length > 0 || row.length > 0 || afterQuote) finishRow();
  return records;
}

export function buildCatalogDefinitions(source) {
  const records = parseCsv(source);
  if (records.length < 2) throw new Error("Evidence CSV has no data rows.");
  const header = records[0].map((value) => value.trim().toLowerCase());
  const required = ["badge_title", "classification", "classification_signal"];
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`Evidence CSV is missing ${column}.`);
  }
  const index = Object.fromEntries(required.map((column) => [column, header.indexOf(column)]));
  const byKey = new Map();
  let awards = 0;
  for (const values of records.slice(1)) {
    awards += 1;
    const rawSignal = values[index.classification_signal];
    const rawClassification = values[index.classification];
    const normalized = normalizeBadgeSignal(rawSignal);
    if (!normalized) throw new Error(`Unsupported structural signal: ${rawSignal}`);
    const expected = normalized.category === "skill" ? "SKILL_BADGE" : "ARCADE_GAME_BADGE";
    if (rawClassification !== expected) {
      throw new Error(`Classification/signal conflict for ${rawSignal}: ${rawClassification}`);
    }
    const title = decodeEntities(values[index.badge_title] ?? "");
    if (title.length < 1 || title.length > 200) {
      throw new Error(`Invalid badge title for ${rawSignal}: ${title}`);
    }
    const existing = byKey.get(normalized.badgeKey);
    if (existing && existing.category !== normalized.category) {
      throw new Error(`Category conflict for ${normalized.badgeKey}.`);
    }
    if (existing && existing.displayName !== title) {
      throw new Error(`Title conflict for ${normalized.badgeKey}: ${existing.displayName} vs ${title}`);
    }
    byKey.set(normalized.badgeKey, {
      badgeKey: normalized.badgeKey,
      category: normalized.category,
      displayName: title,
    });
  }
  const definitions = [...byKey.values()].sort((left, right) => left.badgeKey.localeCompare(right.badgeKey));
  const skill = definitions.filter((row) => row.category === "skill").length;
  const arcade = definitions.filter((row) => row.category === "arcade").length;
  if (skill !== EXPECTED_SKILL || arcade !== EXPECTED_ARCADE) {
    throw new Error(
      `Evidence changed: expected ${EXPECTED_SKILL} Skill + ${EXPECTED_ARCADE} Arcade, found ${skill} + ${arcade}. ` +
        "Review the evidence before regenerating the catalog seed.",
    );
  }
  return { definitions, awards, skill, arcade };
}

export function renderSeedSql(definitions) {
  const escape = (value) => `'${String(value).replaceAll("'", "''")}'`;
  return definitions
    .map(
      (row) =>
        `  (${escape(row.badgeKey)}, ${escape(row.displayName)}, ${escape(row.category)}, 'evidence:2026-11-09')`,
    )
    .join(",\n");
}

const isMain = import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href
  || process.argv[1]?.endsWith("badge-catalog-seed.mjs");

if (isMain) {
  const input = resolve(arg("--input", DEFAULT_INPUT));
  const evidence = buildCatalogDefinitions(readFileSync(input, "utf8"));
  const sql = `-- Generated from ${arg("--input", DEFAULT_INPUT)}\n-- ${evidence.awards} award rows -> ${evidence.definitions.length} definitions (${evidence.skill} Skill + ${evidence.arcade} Arcade)\n${renderSeedSql(evidence.definitions)};\n`;
  const output = arg("--output", null);
  if (output) writeFileSync(resolve(output), sql, "utf8");
  else process.stdout.write(sql);
  process.stderr.write(
    `Verified evidence: ${evidence.awards} awards -> ${evidence.definitions.length} definitions (${evidence.skill} Skill + ${evidence.arcade} Arcade).\n`,
  );
}
