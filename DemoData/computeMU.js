#!/usr/bin/env node
'use strict';

/*
Usage:
  node DemoData/computeMU.js > /tmp/mu.json

Optional flags:
  --truthFile=/absolute/or/relative/path/to/truthPairs.json
  --nonMatchSample=2000
  --seed=42

Paste workflow:
  1) Run script and open /tmp/mu.json
  2) Copy `fields` values into server/config/decisionRules.json
  3) Re-tune potentialMatchThreshold/autoMatchThreshold from validation data
*/

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RULES = path.join(ROOT, 'server', 'config', 'decisionRules.json');
const DEFAULT_CAMBODIA = path.join(__dirname, 'cambodia_patients.json');
const DEFAULT_DUP = path.join(__dirname, 'patient_cam_dup.json');

function parseArgs(argv) {
  const args = {
    nonMatchSample: 2000,
    seed: 42,
  };
  argv.forEach((arg) => {
    if (arg.startsWith('--truthFile=')) {
      args.truthFile = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('_truthFile=')) {
      args.truthFile = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--nonMatchSample=')) {
      args.nonMatchSample = Number(arg.split('=').slice(1).join('='));
    } else if (arg.startsWith('--seed=')) {
      args.seed = Number(arg.split('=').slice(1).join('='));
    }
  });
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getIdentifierValue(patient, system) {
  const identifiers = Array.isArray(patient.identifier) ? patient.identifier : [];
  const hit = identifiers.find((id) => id.system === system);
  return hit ? String(hit.value || '') : '';
}

function getValueByFhirPath(patient, fhirpath) {
  if (fhirpath === "name.where(use='official').given") {
    const official = (patient.name || []).find((n) => n.use === 'official') || (patient.name || [])[0];
    return Array.isArray(official?.given) ? official.given.join(' ').trim() : '';
  }
  if (fhirpath === "name.where(use='official').family") {
    const official = (patient.name || []).find((n) => n.use === 'official') || (patient.name || [])[0];
    return official?.family ? String(official.family).trim() : '';
  }
  if (fhirpath === 'birthDate') {
    return patient.birthDate ? String(patient.birthDate).trim() : '';
  }
  if (fhirpath === "telecom.where(system='phone').value") {
    const telecom = Array.isArray(patient.telecom) ? patient.telecom : [];
    const phone = telecom.find((t) => t.system === 'phone');
    return phone?.value ? String(phone.value).trim() : '';
  }
  if (fhirpath === "identifier.where(system='http://clientregistry.org/nationalid').value") {
    return getIdentifierValue(patient, 'http://clientregistry.org/nationalid');
  }
  if (fhirpath === "identifier.where(system='http://clientregistry.org/artnumber').value") {
    return getIdentifierValue(patient, 'http://clientregistry.org/artnumber');
  }
  if (fhirpath === 'gender') {
    return patient.gender ? String(patient.gender).trim() : '';
  }
  return '';
}

function normalize(v) {
  return String(v || '').trim().toLowerCase();
}

function exactAgree(a, b) {
  return normalize(a) !== '' && normalize(a) === normalize(b);
}

function jaroSimilarity(s1, s2) {
  const a = normalize(s1);
  const b = normalize(s2);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const len1 = a.length;
  const len2 = b.length;
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const aMatches = new Array(len1).fill(false);
  const bMatches = new Array(len2).fill(false);

  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const transpositions = t / 2;
  return (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3;
}

function jaroWinklerSimilarity(a, b) {
  const s1 = normalize(a);
  const s2 = normalize(b);
  const j = jaroSimilarity(s1, s2);
  const maxPrefix = 4;
  let prefix = 0;
  for (let i = 0; i < Math.min(maxPrefix, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  const p = 0.1;
  return j + prefix * p * (1 - j);
}

function isAgreement(ruleField, leftValue, rightValue) {
  if (!leftValue || !rightValue) {
    return null;
  }
  if (ruleField.algorithm === 'exact') {
    return exactAgree(leftValue, rightValue);
  }
  if (ruleField.algorithm === 'jaro-winkler-similarity') {
    const threshold = Number(ruleField.threshold);
    return jaroWinklerSimilarity(leftValue, rightValue) >= threshold;
  }
  throw new Error('Unsupported algorithm for offline estimation: ' + ruleField.algorithm);
}

function createRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pickNonMatchPairs(patients, sampleSize, rng) {
  const pairs = [];
  const n = patients.length;
  if (n < 2) return pairs;
  while (pairs.length < sampleSize) {
    const i = Math.floor(rng() * n);
    let j = Math.floor(rng() * n);
    if (i === j) continue;
    const a = patients[i];
    const b = patients[j];
    const aId = getIdentifierValue(a, 'http://clientregistry.org/openmrs');
    const bId = getIdentifierValue(b, 'http://clientregistry.org/openmrs');
    if (aId && bId && aId === bId) continue;
    pairs.push([a, b]);
  }
  return pairs;
}

function loadAdditionalTruthPairs(truthFilePath, byOpenmrsId) {
  if (!truthFilePath) return [];
  const resolved = path.isAbsolute(truthFilePath) ? truthFilePath : path.join(ROOT, truthFilePath);
  const raw = readJson(resolved);
  if (!Array.isArray(raw)) {
    throw new TypeError('truthFile must be a JSON array.');
  }
  return raw
    .map((p) => {
      const left = byOpenmrsId[p.leftOpenmrsId];
      const right = byOpenmrsId[p.rightOpenmrsId];
      if (!left || !right) return null;
      return [left, right];
    })
    .filter(Boolean);
}

function buildDefaultTruthPairs(cambodiaPatients, dupRecord) {
  const bySystem1 = {};
  cambodiaPatients.forEach((p) => {
    const key = getIdentifierValue(p, 'http://system1.org');
    if (key) bySystem1[key] = p;
  });
  const dupSystem1 = getIdentifierValue(dupRecord, 'http://system1.org');
  const matched = bySystem1[dupSystem1];
  return matched ? [[dupRecord, matched]] : [];
}

function estimateFieldProbability(fieldDef, pairs, smoothing = 1e-6) {
  let agreeCount = 0;
  let usableCount = 0;
  pairs.forEach(([left, right]) => {
    const leftValue = getValueByFhirPath(left, fieldDef.fhirpath);
    const rightValue = getValueByFhirPath(right, fieldDef.fhirpath);
    const agree = isAgreement(fieldDef, leftValue, rightValue);
    if (agree === null) return;
    usableCount++;
    if (agree) agreeCount++;
  });
  const p = usableCount === 0 ? 0.5 : agreeCount / usableCount;
  return Math.max(smoothing, Math.min(1 - smoothing, p));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rulesJson = readJson(DEFAULT_RULES);
  const cambodiaPatients = readJson(DEFAULT_CAMBODIA);
  const dupRecord = readJson(DEFAULT_DUP);
  const rule = rulesJson.rules?.[0];

  if (!rule?.fields) {
    throw new Error('No rules[0].fields found in decisionRules.json');
  }

  const byOpenmrsId = {};
  cambodiaPatients.forEach((p) => {
    const id = getIdentifierValue(p, 'http://clientregistry.org/openmrs');
    if (id) byOpenmrsId[id] = p;
  });

  const rng = createRng(Number.isFinite(args.seed) ? args.seed : 42);
  const truePairs = [
    ...buildDefaultTruthPairs(cambodiaPatients, dupRecord),
    ...loadAdditionalTruthPairs(args.truthFile, byOpenmrsId),
  ];
  if (truePairs.length === 0) {
    throw new Error('No true-match pairs found. Provide --truthFile=<file>.');
  }

  const nonMatchPairs = pickNonMatchPairs(
    cambodiaPatients,
    Number.isFinite(args.nonMatchSample) ? args.nonMatchSample : 2000,
    rng
  );

  const outFields = {};
  Object.entries(rule.fields).forEach(([fieldName, fieldDef]) => {
    const mValue = estimateFieldProbability(fieldDef, truePairs);
    const uValue = estimateFieldProbability(fieldDef, nonMatchPairs);
    outFields[fieldName] = {
      algorithm: fieldDef.algorithm,
      threshold: fieldDef.threshold,
      mValue: Number(mValue.toFixed(6)),
      uValue: Number(uValue.toFixed(6)),
    };
  });

  const result = {
    info: {
      sourceRule: 'server/config/decisionRules.json',
      truePairsUsed: truePairs.length,
      nonMatchPairsUsed: nonMatchPairs.length,
      note: 'Paste each field mValue/uValue into decisionRules.json and re-tune thresholds from validation results.',
    },
    fields: outFields,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
