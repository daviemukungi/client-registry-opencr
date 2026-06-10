/**
 * Step 3b: Unicode Code-Point Encoding (Khmer equivalent of SCI ASCII coding)
 *
 * The Statistical Center of Iran converts Persian characters to their ASCII
 * code numbers before probabilistic matching:
 *
 *   Persian:  کرمی  →  ASCII codes:  211 199 230 237 210
 *
 * Khmer cannot be represented in ASCII, so we apply the equivalent using
 * Unicode code points:
 *
 *   Khmer:  ចាន់  →  Unicode codes:  6021 6070 6035 6091
 *
 * This numeric string is then passed to Jaro-Winkler / Levenshtein instead
 * of the raw character string, making Khmer text:
 *   1. Portable into ASCII-only tools (SPLINK, R RecordLinkage, SAS)
 *   2. Comparable using standard string distance on the digit sequences
 *   3. Formally equivalent to the SCI methodology
 *
 * Latin-script names (transliterations) are left as-is since they are
 * already ASCII-compatible.
 */

const KHMER_RE = /[ក-៿]/;

/** True if the string contains at least one Khmer character */
function isKhmer(str) {
  return KHMER_RE.test(str);
}

/**
 * Convert a normalized Khmer string to a space-separated Unicode code-point
 * number string.
 *
 * Each Unicode scalar value (not UTF-16 code unit) is converted individually
 * so that supplementary-plane characters are handled correctly.
 *
 * Example:
 *   "ចាន់"  →  "6021 6070 6035 6091"
 *   "ស្រីណាត" → "6047 6098 6042 6072 6030 6070 6031"
 */
export function toCodepointString(str) {
  if (!str) return '';
  return [...str]                         // spread splits on Unicode scalar values
    .map((ch) => ch.codePointAt(0))
    .join(' ');
}

/**
 * Encode a normalized name field for similarity comparison.
 *
 * - Khmer text  → Unicode code-point string  (SCI-equivalent step)
 * - Latin text  → returned as-is             (already ASCII-safe)
 * - Empty/null  → empty string
 */
export function encodeField(normStr) {
  if (!normStr) return '';
  return isKhmer(normStr) ? toCodepointString(normStr) : normStr;
}

/**
 * Encode both name fields of a standardized record.
 * Populates record.encodedFamily and record.encodedGiven.
 * Mutates in place and returns the record.
 */
export function encodeRecord(record) {
  record.encodedFamily = encodeField(record.normFamily || record.rawFamily);
  record.encodedGiven  = encodeField(record.normGiven  || record.rawGiven);
  return record;
}

/**
 * Encode all records in an array.
 */
export function encodeAll(records) {
  records.forEach(encodeRecord);
  return records;
}
