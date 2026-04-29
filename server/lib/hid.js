'use strict';

/**
 * Health Identifier (HID) generator.
 *
 * Storage / exchange format : flat 10-digit numeric string  e.g. "4382917650"
 * Display format             : H-XXX-XXX-XXXX              e.g. "H-438-291-7650"
 *
 * Structure
 *   - 9-digit random body  (non-sequential)
 *   - 1 Damm check digit   (computed from the body)
 *
 * The prefix "H" and hyphens are presentation-only and are never stored or exchanged.
 */

// Standard Damm algorithm totally anti-symmetric quasigroup table (10×10).
// Property: table[i][i] === 0 for every i, which means the check digit equals
// the interim result after processing all body digits.
const DAMM_TABLE = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/**
 * Run digits through the Damm table and return the interim value.
 * - To compute a check digit: pass the 9 body digits; the return value is the check digit.
 * - To validate a full HID:   pass all 10 digits; a return value of 0 means valid.
 *
 * @param {string} digits - string of decimal digit characters
 * @returns {number} interim value (0–9)
 */
function runDamm(digits) {
  let interim = 0;
  for (const ch of digits) {
    interim = DAMM_TABLE[interim][parseInt(ch, 10)];
  }
  return interim;
}

/**
 * Generate a new HID.
 *
 * @returns {string} flat 10-digit numeric string (storage / exchange format)
 */
function generate() {
  let body = '';
  for (let i = 0; i < 9; i++) {
    body += Math.floor(Math.random() * 10).toString();
  }
  const checkDigit = runDamm(body);
  return body + checkDigit;
}

/**
 * Validate a HID string.
 * Accepts the flat 10-digit form ("1459467630") or the prefixed FHIR form ("H1459467630").
 *
 * @param {string} hid - 10-digit numeric string, optionally prefixed with "H"
 * @returns {boolean}
 */
function validate(hid) {
  if (typeof hid !== 'string') return false;
  const digits = hid.startsWith('H') ? hid.slice(1) : hid;
  if (!/^\d{10}$/.test(digits)) return false;
  return runDamm(digits) === 0;
}

/**
 * Format a HID for display as H-XXX-XXX-XXXX.
 * Accepts the flat 10-digit form ("1459467630") or the prefixed FHIR form ("H1459467630").
 *
 * @param {string} hid - 10-digit numeric string, optionally prefixed with "H"
 * @returns {string} display form, e.g. "H-438-291-7650"
 */
function display(hid) {
  const digits = hid.startsWith('H') ? hid.slice(1) : hid;
  return `H-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

module.exports = { generate, validate, display };
