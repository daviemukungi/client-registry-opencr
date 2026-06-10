const { populateScores, getThresholdsFromESMatches, getTopScoreSummary } = require('../lib/matchScoreUtils');

describe('matchScoreUtils', () => {
  const rule = {
    autoMatchThreshold: 3,
    potentialMatchThreshold: 1
  };

  const ESMatches = [{
    rule,
    autoMatchResults: [{ _id: 'auto-id', _score: 3 }],
    potentialMatchResults: [{ _id: 'pot-id', _score: 2 }],
    conflictsMatchResults: [{ _id: 'conf-id', _score: 3.5 }]
  }];

  const FHIRAutoMatched = {
    entry: [{
      resource: {
        id: 'auto-id',
        identifier: [{ system: 'http://clientregistry.org/openmrs', value: 'patient1' }]
      }
    }]
  };

  const FHIRPotentialMatches = {
    entry: [{
      resource: {
        id: 'pot-id',
        identifier: [{ system: 'http://clientregistry.org/openmrs', value: 'patient2' }]
      }
    }]
  };

  const FHIRConflictsMatches = {
    entry: [{
      resource: {
        id: 'conf-id',
        identifier: [{ system: 'http://clientregistry.org/openmrs', value: 'patient3' }]
      }
    }]
  };

  test('populateScores adds scores, scoreDetails, and thresholds', () => {
    const patient = { scores: {} };
    populateScores(patient, ESMatches, FHIRPotentialMatches, FHIRAutoMatched, FHIRConflictsMatches);

    expect(patient.scores).toEqual({
      patient1: 3,
      patient2: 2,
      patient3: 3.5
    });
    expect(patient.scoreDetails.patient1).toEqual({
      score: 3,
      matchType: 'auto',
      threshold: 3
    });
    expect(patient.scoreDetails.patient2).toEqual({
      score: 2,
      matchType: 'potential',
      threshold: 1
    });
    expect(patient.scoreDetails.patient3).toEqual({
      score: 3.5,
      matchType: 'conflict',
      threshold: 3
    });
    expect(patient.thresholds).toEqual({
      autoMatchThreshold: 3,
      potentialMatchThreshold: 1
    });
  });

  test('getThresholdsFromESMatches extracts thresholds from rules', () => {
    expect(getThresholdsFromESMatches(ESMatches)).toEqual({
      autoMatchThreshold: 3,
      potentialMatchThreshold: 1
    });
  });

  test('getTopScoreSummary returns top score for reason code', () => {
    expect(getTopScoreSummary(ESMatches, 'potentialMatches')).toEqual({
      score: 2,
      threshold: 1,
      matchType: 'potential'
    });
    expect(getTopScoreSummary(ESMatches, 'autoMatches')).toEqual({
      score: 3,
      threshold: 3,
      matchType: 'auto'
    });
    expect(getTopScoreSummary(ESMatches, 'conflictMatches')).toEqual({
      score: 3.5,
      threshold: 3,
      matchType: 'conflict'
    });
  });
});
