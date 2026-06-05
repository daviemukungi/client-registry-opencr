/**
 * Step 5 & 6: Fellegi-Sunter Probabilistic Record Linkage
 *
 * Implements the Fellegi-Sunter model (1969):
 *   For each comparison field f:
 *     agreement    weight = log2(m_f / u_f)
 *     disagreement weight = log2((1 - m_f) / (1 - u_f))
 *     unknown      weight = 0   (null_handling = "moderate")
 *
 *   Total score = Σ weights across all fields
 *
 * Classification:
 *   score ≥ autoMatchThreshold       → Match
 *   score ≥ potentialMatchThreshold  → Possible Match (clerical review)
 *   score <  potentialMatchThreshold → Non-Match
 *
 * Field definitions are loaded from the project's decisionRules.json so
 * the pipeline stays in sync with the live registry configuration.
 */

import { fieldAgrees, scoreNamePair } from './similarity.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const LOG2 = Math.log(2);
function log2(x) { return Math.log(x) / LOG2; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Agreement weight for one field.
 * @param {boolean|null} agrees
 * @param {number} m  - P(agree | true match)
 * @param {number} u  - P(agree | non-match)
 */
function weight(agrees, m, u) {
  if (agrees === null) return 0; // unknown → neutral
  const mC = clamp(m, 1e-9, 1 - 1e-9);
  const uC = clamp(u, 1e-9, 1 - 1e-9);
  return agrees
    ? log2(mC / uC)
    : log2((1 - mC) / (1 - uC));
}

// ── Field value extractor ─────────────────────────────────────────────────────

/**
 * Extract the comparison string for a field from a standardized record.
 * Uses normalized name fields; falls back to raw demographics.
 */
function fieldValue(record, fieldDef) {
  const fp = fieldDef.fhirpath || '';

  // Use Unicode code-point encoded strings for name fields (SCI-equivalent step).
  // encodedFamily/encodedGiven are numeric strings for Khmer, plain text for Latin.
  if (fp.includes('given'))    return record.encodedGiven  || record.normGiven  || record.rawGiven;
  if (fp.includes('family'))   return record.encodedFamily || record.normFamily || record.rawFamily;
  if (fp.includes('birthDate'))return record.birthDate;
  if (fp.includes('phone'))    return record.phone;
  if (fp.includes('gender'))   return record.gender;
  if (fp.includes('nationalid')) return record.nationalId;
  if (fp.includes('artnumber')) return record.artNumber;
  if (fp.includes('address'))  return record.city;      // city-level for address

  // espath fallback
  const ep = fieldDef.espath || '';
  if (ep === 'given')    return record.encodedGiven  || record.normGiven;
  if (ep === 'family')   return record.encodedFamily || record.normFamily;
  if (ep === 'birthDate') return record.birthDate;
  if (ep === 'phone')    return record.phone;
  if (ep === 'gender')   return record.gender;
  if (ep === 'city')     return record.city;

  return '';
}

// ── Core scoring ──────────────────────────────────────────────────────────────

/**
 * Detect when the two records use different scripts for the same name field.
 * Khmer ↔ Latin pairs cannot be scored reliably by character-level metrics;
 * the caller should note this and rely on non-name fields (DOB, phone, ID).
 */
export function detectScriptMismatch(recA, recB) {
  const aKhmer = recA.isKhmerFamily || recA.isKhmerGiven;
  const bKhmer = recB.isKhmerFamily || recB.isKhmerGiven;
  return aKhmer !== bKhmer; // one Khmer, one Latin
}

/**
 * Score a candidate pair under the Fellegi-Sunter model.
 *
 * @param {object} recA         - Standardized, normalized record A
 * @param {object} recB         - Standardized, normalized record B
 * @param {object} ruleFields   - `rules[0].fields` from decisionRules.json
 * @param {number} autoThreshold
 * @param {number} potentialThreshold
 * @returns {object}            - Scored pair with classification
 */
export function scorePair(recA, recB, ruleFields, autoThreshold, potentialThreshold) {
  const scriptMismatch = detectScriptMismatch(recA, recB);
  const fieldScores = {};
  // Mirror the server's esMatching.js: probabilistic mode starts at base_score=100.0
  // so thresholds of 100 (potential) and 110 (auto) are meaningful.
  let totalScore = 100.0;

  for (const [fieldName, fieldDef] of Object.entries(ruleFields)) {
    const valA = fieldValue(recA, fieldDef);
    const valB = fieldValue(recB, fieldDef);

    // Suppress name-field scoring for cross-script pairs: character-level
    // metrics (JW, Levenshtein) are meaningless between Khmer and Latin.
    // The score falls back to neutral (0) and the pair is flagged for
    // manual review or phonetic transliteration matching.
    const isNameField = ['given', 'family'].includes(fieldName);
    const agrees = (scriptMismatch && isNameField)
      ? null
      : fieldAgrees(fieldDef.algorithm, valA, valB, Number(fieldDef.threshold ?? 0));

    const w = weight(agrees, fieldDef.mValue, fieldDef.uValue);
    totalScore += w;

    fieldScores[fieldName] = {
      valueA: valA || null,
      valueB: valB || null,
      agrees,
      scriptMismatch: isNameField ? scriptMismatch : undefined,
      weight: Number(w.toFixed(4)),
    };
  }

  // Deterministic similarity scores on the Unicode-encoded strings
  // (the actual values used for Fellegi-Sunter agreement decisions)
  const nameScores = {
    given: {
      encodedA: recA.encodedGiven  || recA.normGiven,
      encodedB: recB.encodedGiven  || recB.normGiven,
      ...scoreNamePair(
        recA.encodedGiven || recA.normGiven || recA.rawGiven,
        recB.encodedGiven || recB.normGiven || recB.rawGiven
      ),
    },
    family: {
      encodedA: recA.encodedFamily || recA.normFamily,
      encodedB: recB.encodedFamily || recB.normFamily,
      ...scoreNamePair(
        recA.encodedFamily || recA.normFamily || recA.rawFamily,
        recB.encodedFamily || recB.normFamily || recB.rawFamily
      ),
    },
  };

  const score = Number(totalScore.toFixed(4));
  let classification;
  if (score >= autoThreshold)       classification = 'Match';
  else if (score >= potentialThreshold) classification = 'Possible Match';
  else                              classification = 'Non-Match';

  return {
    idA: recA.id || recA.openmrsId,
    idB: recB.id || recB.openmrsId,
    sourceA: recA.sourceId,
    sourceB: recB.sourceId,
    normNameA: `${recA.normFamily} ${recA.normGiven}`.trim() || `${recA.rawFamily} ${recA.rawGiven}`.trim(),
    normNameB: `${recB.normFamily} ${recB.normGiven}`.trim() || `${recB.rawFamily} ${recB.rawGiven}`.trim(),
    scriptMismatch,
    nameScores,
    fieldScores,
    fellegiSunterScore: score,
    classification,
  };
}

/**
 * Load Fellegi-Sunter parameters from a decisionRules.json path.
 * Returns { fields, autoMatchThreshold, potentialMatchThreshold }.
 */
export function loadRules(rulesPath) {
  // Dynamic import handled by caller; accept the parsed object directly.
  // This function validates and extracts what the pipeline needs.
  const rule = rulesPath?.rules?.[0];
  if (!rule?.fields) {
    throw new Error('decisionRules.json: expected rules[0].fields');
  }
  return {
    fields: rule.fields,
    autoMatchThreshold: Number(rule.autoMatchThreshold ?? 110),
    potentialMatchThreshold: Number(rule.potentialMatchThreshold ?? 100),
    filters: rule.filters || {},
  };
}

/**
 * Optional gender pre-filter: if the registry has a gender filter defined,
 * skip pairs where both genders are known but differ.
 */
export function passesGenderFilter(recA, recB, filters) {
  if (!filters?.gender) return true;
  if (!recA.gender || !recB.gender) return true;
  return recA.gender === recB.gender;
}
