/**
 * Step 4: Deterministic String Similarity
 *
 * Computes multiple similarity/distance metrics between two normalized strings.
 * All functions accept already-normalized strings (output of normalize.js).
 *
 * Metrics:
 *   - Exact match (boolean → 1.0 / 0.0)
 *   - Jaro-Winkler similarity  [0, 1]
 *   - Levenshtein distance      [0, ∞)
 *   - Damerau-Levenshtein distance [0, ∞) — includes transpositions
 */

import jaroWinklerPkg from 'jaro-winkler';
import levenshtein from 'fast-levenshtein';
import DamerauLevenshtein from 'damerau-levenshtein';

// jaro-winkler exports as CJS default from an ESM context
const jaroWinkler =
  typeof jaroWinklerPkg === 'function'
    ? jaroWinklerPkg
    : jaroWinklerPkg.default ?? jaroWinklerPkg.jaroWinkler ?? jaroWinklerPkg;

/** True iff both strings are non-empty and identical */
export function exactMatch(a, b) {
  if (!a || !b) return false;
  return a === b;
}

/**
 * Jaro-Winkler similarity [0, 1].
 * Returns null if either string is empty (unknown agreement).
 */
export function jaroWinklerSim(a, b) {
  if (!a || !b) return null;
  return jaroWinkler(a, b);
}

/**
 * Levenshtein edit distance.
 * Returns null if either string is empty.
 */
export function levenshteinDist(a, b) {
  if (!a || !b) return null;
  return levenshtein.get(a, b);
}

/**
 * Damerau-Levenshtein distance (allows transpositions).
 * Returns null if either string is empty.
 */
export function damerauLevenshteinDist(a, b) {
  if (!a || !b) return null;
  // The package exposes { steps, relative, similarity } directly on the instance
  return new DamerauLevenshtein(a, b).steps;
}

/**
 * Compute all similarity metrics for a pair of name strings.
 * @returns {{ exact, jaroWinkler, levenshtein, damerauLevenshtein }}
 */
export function scoreNamePair(a, b) {
  return {
    exact: exactMatch(a, b),
    jaroWinkler: jaroWinklerSim(a, b),
    levenshtein: levenshteinDist(a, b),
    damerauLevenshtein: damerauLevenshteinDist(a, b),
  };
}

/**
 * Decide agreement for a field given a threshold configuration.
 *
 * Returns:
 *   true   — agree
 *   false  — disagree
 *   null   — unknown (one or both values absent)
 *
 * @param {string} algorithm  - 'exact' | 'jaro-winkler-similarity' | 'levenshtein'
 * @param {string} a
 * @param {string} b
 * @param {number} threshold
 */
export function fieldAgrees(algorithm, a, b, threshold) {
  if (!a || !b) return null;

  switch (algorithm) {
    case 'exact':
      return exactMatch(a, b);

    case 'jaro-winkler-similarity': {
      const jw = jaroWinklerSim(a, b);
      return jw !== null ? jw >= threshold : null;
    }

    case 'levenshtein': {
      const lev = levenshteinDist(a, b);
      return lev !== null ? lev <= threshold : null;
    }

    case 'damerau-levenshtein': {
      const dl = damerauLevenshteinDist(a, b);
      return dl !== null ? dl <= threshold : null;
    }

    default:
      return null;
  }
}
