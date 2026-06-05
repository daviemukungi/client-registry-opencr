/**
 * Step 3: Khmer Unicode Normalization
 *
 * Wraps the sillsdev/khmer-normalizer library to produce canonical
 * Khmer Unicode representations for comparison.
 *
 * The normalizer resolves:
 *   - Character ordering differences (coeng + base consonant positioning)
 *   - Visually equivalent character sequences that differ in code-point order
 *   - Unicode composition inconsistencies (NFC/NFD)
 *
 * For Latin-script names (transliterated Khmer) a plain NFC normalization
 * and lower-case fold is applied instead.
 */

import { khnormal } from 'khmer-normalizer';
import { encodeRecord } from './encode.js';

// Khmer Unicode block: U+1780–U+17FF (consonants, vowels, diacritics, digits)
const KHMER_CHAR_RE = /[ក-៿]/;

function containsKhmer(str) {
  return KHMER_CHAR_RE.test(str);
}

/**
 * Normalize a single name field.
 *
 * - Khmer text  → khnormal() then NFC
 * - Latin text  → NFC + lowercase + trim
 * - Mixed       → split tokens, normalize each token by script, rejoin
 */
export function normalizeField(raw) {
  if (!raw) return '';
  const s = raw.trim();
  if (!s) return '';

  // All-Khmer fast path
  if (/^[ក-៿\s]+$/.test(s)) {
    return khnormal(s, 'km').normalize('NFC').trim();
  }

  // All-Latin fast path
  if (!/[ក-៿]/.test(s)) {
    return s.normalize('NFC').toLowerCase().trim();
  }

  // Mixed: normalize each whitespace-delimited token individually
  return s
    .split(/\s+/)
    .map((tok) => {
      if (/^[ក-៿]+$/.test(tok)) return khnormal(tok, 'km').normalize('NFC');
      return tok.normalize('NFC').toLowerCase();
    })
    .join(' ')
    .trim();
}

/**
 * Apply normalization to the normFamily and normGiven fields of a
 * standardized record (mutates in place, returns the record).
 */
export function normalizeRecord(record) {
  record.normFamily = normalizeField(record.rawFamily);
  record.normGiven  = normalizeField(record.rawGiven);
  // Step 3b: encode normalized Khmer text to Unicode code-point number strings
  // (equivalent to SCI's ASCII coding for Persian)
  encodeRecord(record);
  return record;
}

/**
 * Normalize an array of standardized records in place.
 */
export function normalizeAll(records) {
  records.forEach(normalizeRecord);
  return records;
}
