const generalMixin = require('./mixins/generalMixin');

const MATCH_BUCKETS = [
  { key: 'autoMatchResults', matchType: 'auto', thresholdKey: 'autoMatchThreshold' },
  { key: 'potentialMatchResults', matchType: 'potential', thresholdKey: 'potentialMatchThreshold' },
  { key: 'conflictsMatchResults', matchType: 'conflict', thresholdKey: 'autoMatchThreshold' }
];

function getThresholdsFromESMatches(ESMatches) {
  const thresholds = {};
  for (const esmatch of ESMatches) {
    if (!esmatch.rule) {
      continue;
    }
    if (esmatch.rule.autoMatchThreshold !== undefined) {
      thresholds.autoMatchThreshold = esmatch.rule.autoMatchThreshold;
    }
    if (esmatch.rule.potentialMatchThreshold !== undefined) {
      thresholds.potentialMatchThreshold = esmatch.rule.potentialMatchThreshold;
    }
  }
  return thresholds;
}

function findFhirResource(matchId, FHIRAutoMatched, FHIRPotentialMatches, FHIRConflictsMatches) {
  let patResource = FHIRAutoMatched.entry.find((entry) => entry.resource.id === matchId);
  if (patResource) {
    return patResource;
  }
  patResource = FHIRPotentialMatches.entry.find((entry) => entry.resource.id === matchId);
  if (patResource) {
    return patResource;
  }
  return FHIRConflictsMatches.entry.find((entry) => entry.resource.id === matchId);
}

function populateScores(patient, ESMatches, FHIRPotentialMatches, FHIRAutoMatched, FHIRConflictsMatches) {
  patient.scores = patient.scores || {};
  patient.scoreDetails = patient.scoreDetails || {};
  patient.thresholds = getThresholdsFromESMatches(ESMatches);

  for (const esmatch of ESMatches) {
    const rule = esmatch.rule || {};
    for (const bucket of MATCH_BUCKETS) {
      const results = esmatch[bucket.key] || [];
      const threshold = rule[bucket.thresholdKey];
      for (const match of results) {
        const patResource = findFhirResource(match['_id'], FHIRAutoMatched, FHIRPotentialMatches, FHIRConflictsMatches);
        if (!patResource) {
          continue;
        }
        const validSystem = generalMixin.getClientIdentifier(patResource.resource);
        if (!validSystem || !validSystem.value) {
          continue;
        }
        const score = parseFloat(match['_score']);
        patient.scores[validSystem.value] = score;
        patient.scoreDetails[validSystem.value] = {
          score,
          matchType: bucket.matchType,
          threshold
        };
      }
    }
  }
}

function getTopScoreSummary(ESMatches, reasonCode) {
  const bucketMap = {
    potentialMatches: 'potentialMatchResults',
    conflictMatches: 'conflictsMatchResults',
    autoMatches: 'autoMatchResults'
  };
  const matchTypeMap = {
    potentialMatches: 'potential',
    conflictMatches: 'conflict',
    autoMatches: 'auto'
  };
  const thresholdKeyMap = {
    potentialMatches: 'potentialMatchThreshold',
    conflictMatches: 'autoMatchThreshold',
    autoMatches: 'autoMatchThreshold'
  };

  const bucketKey = bucketMap[reasonCode];
  const matchType = matchTypeMap[reasonCode];
  const thresholdKey = thresholdKeyMap[reasonCode];
  if (!bucketKey) {
    return {};
  }

  let topScore;
  let threshold;
  for (const esmatch of ESMatches) {
    const rule = esmatch.rule || {};
    if (threshold === undefined && rule[thresholdKey] !== undefined) {
      threshold = rule[thresholdKey];
    }
    for (const match of esmatch[bucketKey] || []) {
      const score = parseFloat(match['_score']);
      if (topScore === undefined || score > topScore) {
        topScore = score;
      }
    }
  }

  if (topScore === undefined) {
    return {};
  }

  return {
    score: topScore,
    threshold,
    matchType
  };
}

module.exports = {
  populateScores,
  getThresholdsFromESMatches,
  getTopScoreSummary
};
