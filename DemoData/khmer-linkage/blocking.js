/**
 * Candidate Generation with Blocking
 *
 * For a cross-file linkage of N × M records, comparing all pairs is O(N·M).
 * Blocking reduces the comparison space by only pairing records that share a
 * common "blocking key" — a cheap proxy likely to be equal for true matches.
 *
 * Strategies (selected automatically by dataset size):
 *
 *  1. FULL (N·M ≤ 10 000)      – compare every pair; used for small sets
 *  2. GENDER_BLOCK              – only compare same-gender records
 *  3. PHONETIC_BLOCK            – records sharing the first Khmer consonant or
 *                                 first Latin character of family name
 *  4. SORTED_NEIGHBOURHOOD      – sliding window over sorted normFamily;
 *                                 catches transpositions/typos without full cross
 *
 * All strategies support self-linkage (deduplication within one file) and
 * cross-linkage (linking two different files).
 */

// Khmer consonants for phonetic blocking: first code-point of family name
const KHMER_CONSONANTS = new Set('កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហឡអ'.split(''));

/**
 * Returns a blocking key for a record.
 * For Khmer: the first consonant of normFamily.
 * For Latin: the first two characters of normFamily (lowercased).
 */
function blockingKey(record) {
  const fam = record.normFamily || record.rawFamily || '';
  if (!fam) return '__EMPTY__';
  const first = fam[0];
  if (KHMER_CONSONANTS.has(first) || /[ក-៿]/.test(first)) {
    return first; // Khmer consonant block
  }
  // Latin: first 2 chars for tighter blocking
  return fam.slice(0, 2).toLowerCase();
}

/**
 * Group records by blocking key.
 * @param {Array} records
 * @returns {Map<string, Array>}
 */
function groupByKey(records) {
  const map = new Map();
  for (const rec of records) {
    const key = blockingKey(rec);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rec);
  }
  return map;
}

/**
 * Generate candidate pairs from two record sets using phonetic/prefix blocking.
 * Records from the same source are never paired against themselves (use
 * selfLink=true for deduplication within a single source).
 *
 * @param {Array}   leftRecords
 * @param {Array}   rightRecords
 * @param {object}  opts
 * @param {boolean} opts.selfLink    - true = deduplicate within leftRecords (ignore rightRecords)
 * @param {boolean} opts.genderBlock - skip cross-gender pairs when gender is known
 * @param {number}  opts.snwWindow   - sorted-neighbourhood window size (default 10)
 * @param {number}  opts.maxPairs    - hard cap on pairs generated (default 100 000)
 * @yields {[object, object]}        - candidate pair [recA, recB]
 */
export function* generateCandidates(leftRecords, rightRecords, opts = {}) {
  const {
    selfLink = false,
    genderBlock = true,
    snwWindow = 10,
    maxPairs = 100_000,
  } = opts;

  const totalLeft = leftRecords.length;
  const totalRight = selfLink ? leftRecords.length : rightRecords.length;
  const totalPossible = totalLeft * totalRight;
  let emitted = 0;

  function shouldSkipGender(a, b) {
    return genderBlock && a.gender && b.gender && a.gender !== b.gender;
  }

  // ── Strategy 1: FULL cross (tiny datasets) ──────────────────────────────────
  if (totalPossible <= 10_000) {
    const right = selfLink ? leftRecords : rightRecords;
    for (let i = 0; i < leftRecords.length; i++) {
      const startJ = selfLink ? i + 1 : 0;
      for (let j = startJ; j < right.length; j++) {
        if (emitted >= maxPairs) return;
        const a = leftRecords[i];
        const b = right[j];
        if (shouldSkipGender(a, b)) continue;
        yield [a, b];
        emitted++;
      }
    }
    return;
  }

  // ── Strategy 2 + 3: GENDER + PHONETIC blocking ─────────────────────────────
  const right = selfLink ? leftRecords : rightRecords;

  const leftByKey = groupByKey(leftRecords);
  const rightByKey = groupByKey(right);

  // Collect all keys present in both sides
  const sharedKeys = new Set([...leftByKey.keys()].filter((k) => rightByKey.has(k)));

  for (const key of sharedKeys) {
    const lGroup = leftByKey.get(key);
    const rGroup = rightByKey.get(key);

    for (let i = 0; i < lGroup.length; i++) {
      const startJ = selfLink ? i + 1 : 0;
      for (let j = startJ; j < rGroup.length; j++) {
        if (emitted >= maxPairs) return;
        const a = lGroup[i];
        const b = rGroup[j];
        if (selfLink && a.id === b.id) continue;
        if (shouldSkipGender(a, b)) continue;
        yield [a, b];
        emitted++;
      }
    }
  }

  // ── Strategy 4: SORTED NEIGHBOURHOOD fallback for cross-script pairs ────────
  // Pairs records whose normalized family names are adjacent when sorted.
  // This catches cases where the blocking key differs due to script mismatch.
  if (!selfLink && emitted < maxPairs) {
    const allSorted = [...leftRecords, ...rightRecords].sort((a, b) => {
      const ka = (a.normFamily || a.rawFamily || '').toLowerCase();
      const kb = (b.normFamily || b.rawFamily || '').toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    for (let i = 0; i < allSorted.length; i++) {
      for (let w = 1; w <= snwWindow && i + w < allSorted.length; w++) {
        if (emitted >= maxPairs) return;
        const a = allSorted[i];
        const b = allSorted[i + w];
        // Only emit cross-source pairs
        if (a.sourceId === b.sourceId) continue;
        if (shouldSkipGender(a, b)) continue;
        yield [a, b];
        emitted++;
      }
    }
  }
}

/**
 * Convenience: collect all candidate pairs into an array.
 */
export function collectCandidates(leftRecords, rightRecords, opts = {}) {
  return [...generateCandidates(leftRecords, rightRecords, opts)];
}
