#!/usr/bin/env node
/**
 * Khmer Probabilistic Record Linkage Pipeline
 * ============================================
 *
 * Usage:
 *   node pipeline.js [options]
 *
 * Options:
 *   --left=<path>         Left (or only) FHIR Patient JSON file
 *   --right=<path>        Right FHIR Patient JSON file (omit for self-linkage)
 *   --rules=<path>        decisionRules.json (default: ../../server/config/decisionRules.json)
 *   --out=<path>          Output file (default: stdout)
 *   --format=json|csv     Output format (default: json)
 *   --selfLink            Force self-linkage (deduplication) within --left
 *   --pairs               Evaluate known true-match pairs (odd↔even IDs in khmer variation files)
 *   --genderBlock=0       Disable gender blocking (default: enabled)
 *   --maxPairs=<n>        Max candidate pairs to evaluate (default: 100000)
 *   --sample=<n>          Random sample N records from left file before linking
 *   --seed=<n>            RNG seed for --sample (default: 42)
 *   --verbose             Print progress to stderr
 *
 * Pipeline steps:
 *   1. Standardize  – extract FHIR fields into flat records
 *   2. Purify       – normalize whitespace, remove noise
 *   3. Normalize    – Khmer Unicode normalization (khnormal) / Latin NFC+lowercase
 *   4. Blocking     – generate candidate pairs
 *   5. Score        – Jaro-Winkler, Levenshtein, Damerau-Levenshtein per field
 *   6. Fellegi-Sunter – compute log-odds match weight from m/u values
 *   7. Classify     – Match / Possible Match / Non-Match
 *   8. Output       – JSON array or CSV
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { standardizeAll } from './standardize.js';
import { normalizeAll } from './normalize.js';
import { generateCandidates } from './blocking.js';
import { scorePair, loadRules, passesGenderFilter } from './fellegi-sunter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    left: null,
    right: null,
    rules: resolve(__dirname, '../../server/config/decisionRules.json'),
    out: null,
    format: 'json',
    selfLink: false,
    pairs: false,
    genderBlock: true,
    maxPairs: 100_000,
    sample: null,
    seed: 42,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--left='))       args.left        = resolve(__dirname, arg.slice(7));
    else if (arg.startsWith('--right=')) args.right       = resolve(__dirname, arg.slice(8));
    else if (arg.startsWith('--rules=')) args.rules       = resolve(__dirname, arg.slice(8));
    else if (arg.startsWith('--out='))   args.out         = resolve(__dirname, arg.slice(6));
    else if (arg.startsWith('--format='))args.format      = arg.slice(9);
    else if (arg === '--selfLink')        args.selfLink    = true;
    else if (arg === '--pairs')           args.pairs       = true;
    else if (arg === '--genderBlock=0')  args.genderBlock = false;
    else if (arg.startsWith('--maxPairs=')) args.maxPairs = Number(arg.slice(11));
    else if (arg.startsWith('--sample='))  args.sample    = Number(arg.slice(9));
    else if (arg.startsWith('--seed='))    args.seed      = Number(arg.slice(7));
    else if (arg === '--verbose')         args.verbose     = true;
  }

  return args;
}

// ── RNG for reproducible sampling ────────────────────────────────────────────

function makeLcg(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}

function sampleN(arr, n, rng) {
  if (n >= arr.length) return arr;
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// ── JSON reading ──────────────────────────────────────────────────────────────

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read JSON from ${path}: ${e.message}`);
  }
}

// ── Known true-pair extractor for variation files ────────────────────────────
// The khmer variation files pair records with consecutive IDs:
//   KHVAR2001 (Khmer) ↔ KHVAR2002 (Latin transliteration), etc.

function extractKnownPairs(records) {
  // Group by numeric suffix divided by 2 → shared base
  const byBase = new Map();
  for (const rec of records) {
    const id = rec.openmrsId || rec.id;
    const num = parseInt(id.replace(/\D/g, ''), 10);
    if (!Number.isFinite(num)) continue;
    const base = Math.ceil(num / 2);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(rec);
  }
  const pairs = [];
  for (const group of byBase.values()) {
    if (group.length === 2) pairs.push([group[0], group[1]]);
  }
  return pairs;
}

// ── Output formatters ─────────────────────────────────────────────────────────

function toCSVRow(result) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const ns = result.nameScores;
  return [
    result.idA,
    result.idB,
    result.sourceA,
    result.sourceB,
    result.normNameA,
    result.normNameB,
    ns?.given?.jaroWinkler?.toFixed(4) ?? '',
    ns?.given?.levenshtein ?? '',
    ns?.given?.damerauLevenshtein ?? '',
    ns?.family?.jaroWinkler?.toFixed(4) ?? '',
    ns?.family?.levenshtein ?? '',
    result.fellegiSunterScore,
    result.classification,
  ].map(esc).join(',');
}

const CSV_HEADER = [
  'id_a','id_b','source_a','source_b',
  'norm_name_a','norm_name_b',
  'given_jaro_winkler','given_levenshtein','given_damerau',
  'family_jaro_winkler','family_levenshtein',
  'fellegi_sunter_score','classification',
].join(',');

// ── Main ──────────────────────────────────────────────────────────────────────

function log(msg, verbose) {
  if (verbose) process.stderr.write(msg + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Default left file
  if (!args.left) {
    args.left = resolve(__dirname, '../cambodia_patients_variations_khmer.json');
  }

  log(`[1/7] Loading data…`, args.verbose);

  const leftRaw = readJson(args.left);
  let leftRecords = standardizeAll(
    Array.isArray(leftRaw) ? leftRaw : [leftRaw],
    'A'
  );

  let rightRecords = [];
  if (!args.selfLink && args.right) {
    const rightRaw = readJson(args.right);
    rightRecords = standardizeAll(
      Array.isArray(rightRaw) ? rightRaw : [rightRaw],
      'B'
    );
  }

  // Optional random sample
  if (args.sample) {
    const rng = makeLcg(args.seed);
    leftRecords = sampleN(leftRecords, args.sample, rng);
    log(`  Sampled ${leftRecords.length} records from left file.`, args.verbose);
  }

  log(`[2/7] Standardized ${leftRecords.length} left / ${rightRecords.length} right records.`, args.verbose);

  // ── Step 3: Khmer Unicode normalization ─────────────────────────────────────
  log(`[3/7] Applying Khmer Unicode normalization…`, args.verbose);
  normalizeAll(leftRecords);
  if (rightRecords.length) normalizeAll(rightRecords);

  // ── Load Fellegi-Sunter rule parameters ─────────────────────────────────────
  log(`[4/7] Loading decision rules from ${args.rules}…`, args.verbose);
  const rulesJson = readJson(args.rules);
  const { fields, autoMatchThreshold, potentialMatchThreshold, filters } = loadRules(rulesJson);

  log(`  autoMatchThreshold=${autoMatchThreshold}, potentialMatchThreshold=${potentialMatchThreshold}`, args.verbose);

  // ── Step 4: Candidate generation ────────────────────────────────────────────
  log(`[5/7] Generating candidate pairs…`, args.verbose);

  let candidatePairs;

  if (args.pairs) {
    // Evaluate known true-match pairs from variation file structure
    const allRecs = [...leftRecords, ...rightRecords];
    candidatePairs = extractKnownPairs(allRecs.length ? allRecs : leftRecords);
    log(`  Using ${candidatePairs.length} known true-match pairs.`, args.verbose);
  } else {
    const isSelf = args.selfLink || !args.right;
    const gen = generateCandidates(leftRecords, rightRecords, {
      selfLink: isSelf,
      genderBlock: args.genderBlock,
      maxPairs: args.maxPairs,
    });

    candidatePairs = [];
    for (const pair of gen) candidatePairs.push(pair);
    log(`  Generated ${candidatePairs.length} candidate pairs.`, args.verbose);
  }

  // ── Steps 5 & 6: Score + Fellegi-Sunter ─────────────────────────────────────
  log(`[6/7] Scoring pairs…`, args.verbose);

  const results = [];
  for (const [recA, recB] of candidatePairs) {
    if (!passesGenderFilter(recA, recB, filters)) continue;
    const scored = scorePair(recA, recB, fields, autoMatchThreshold, potentialMatchThreshold);
    results.push(scored);
  }

  // ── Step 7: Output ───────────────────────────────────────────────────────────
  log(`[7/7] Emitting ${results.length} results…`, args.verbose);

  // Summary stats to stderr
  const counts = { Match: 0, 'Possible Match': 0, 'Non-Match': 0 };
  for (const r of results) counts[r.classification] = (counts[r.classification] || 0) + 1;
  log(
    `  Classification summary: Match=${counts['Match']}  Possible=${counts['Possible Match']}  Non-Match=${counts['Non-Match']}`,
    args.verbose
  );

  let output;
  if (args.format === 'csv') {
    output = [CSV_HEADER, ...results.map(toCSVRow)].join('\n');
  } else {
    // Compact JSON with a summary header
    output = JSON.stringify(
      {
        meta: {
          leftFile: args.left,
          rightFile: args.right || '(self-link)',
          rulesFile: args.rules,
          totalCandidatePairs: candidatePairs.length,
          scoredPairs: results.length,
          summary: counts,
          autoMatchThreshold,
          potentialMatchThreshold,
        },
        results,
      },
      null,
      2
    );
  }

  if (args.out) {
    writeFileSync(args.out, output, 'utf8');
    log(`  Written to ${args.out}`, args.verbose);
  } else {
    process.stdout.write(output + '\n');
  }
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
