(() => {
  'use strict';

  function clone(value) {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
  }

  function createInitialControls(metrics) {
    return Object.fromEntries(
      metrics.map((metric) => [
        metric.id,
        {
          value: metric.value,
          low: metric.low,
          high: metric.high,
          level: metric.level,
          hard: metric.hard
        }
      ])
    );
  }

  function normalize(value, min, max) {
    if (!Number.isFinite(Number(value))) {
      return 0.5;
    }

    return Math.max(0, Math.min(1, (Number(value) - min) / (max - min)));
  }

  function utility(place, metric, control) {
    const value = Number(place[metric.field]);

    if (!Number.isFinite(value)) {
      return 0.45;
    }

    if (metric.kind === 'max') {
      if (value <= control.value) {
        const position = Math.max(0, (value - metric.min) / Math.max(1, control.value - metric.min));
        return 0.68 + 0.32 * (1 - position);
      }

      return Math.max(
        0,
        0.68 * (1 - (value - control.value) / Math.max(1, metric.max - control.value))
      );
    }

    if (metric.kind === 'min') {
      if (value >= control.value) {
        const position = (value - control.value) / Math.max(1, metric.max - control.value);
        return 0.68 + 0.32 * Math.min(1, position);
      }

      return Math.max(
        0,
        0.68 * (value - metric.min) / Math.max(1, control.value - metric.min)
      );
    }

    if (value >= control.low && value <= control.high) {
      return 1;
    }

    if (value < control.low) {
      return Math.max(0, 1 - (control.low - value) / Math.max(1, control.low - metric.min));
    }

    return Math.max(0, 1 - (value - control.high) / Math.max(1, metric.max - control.high));
  }

  function hardFailure(place, metric, control) {
    if (!control.hard) {
      return null;
    }

    const value = Number(place[metric.field]);
    if (!Number.isFinite(value)) {
      return { metric, severity: 0.5, value: null };
    }

    let severity = null;

    if (metric.kind === 'max' && value > control.value) {
      severity = (value - control.value) / Math.max(1, metric.max - control.value);
    }

    if (metric.kind === 'min' && value < control.value) {
      severity = (control.value - value) / Math.max(1, control.value - metric.min);
    }

    if (metric.kind === 'range' && (value < control.low || value > control.high)) {
      severity = value < control.low
        ? (control.low - value) / Math.max(1, control.low - metric.min)
        : (value - control.high) / Math.max(1, metric.max - control.high);
    }

    if (severity === null) {
      return null;
    }

    return { metric, severity: Math.min(1, severity), value };
  }

  function evaluate(place, metrics, controls, weights) {
    let weightedUtility = 0;
    let totalWeight = 0;
    const contributions = [];
    const failures = [];

    for (const metric of metrics) {
      const control = controls[metric.id];
      const failure = hardFailure(place, metric, control);

      if (failure) {
        failures.push(failure);
      }

      const weight = weights[control.level] || 0;
      if (!weight) {
        continue;
      }

      const value = utility(place, metric, control);
      weightedUtility += value * weight;
      totalWeight += weight;
      contributions.push({
        metric,
        utility: value,
        weight,
        points: value * weight,
        value: place[metric.field]
      });
    }

    return {
      score: totalWeight ? (100 * weightedUtility) / totalWeight : 50,
      failures,
      contributions
    };
  }

  function sortRows(rows, sort) {
    const sorted = [...rows];

    const sorters = {
      home: (a, b) =>
        (a.place.median_home_value ?? Infinity) - (b.place.median_home_value ?? Infinity),
      airport: (a, b) =>
        (a.place.global_airport_minutes ?? Infinity) - (b.place.global_airport_minutes ?? Infinity),
      urban: (a, b) =>
        (b.place.urbanity_score ?? -1) - (a.place.urbanity_score ?? -1),
      walk: (a, b) =>
        (b.place.walkability_proxy ?? -1) - (a.place.walkability_proxy ?? -1),
      momentum: (a, b) =>
        (b.place.momentum_score ?? -1) - (a.place.momentum_score ?? -1),
      family: (a, b) =>
        (b.place.family_renewal_score ?? -1) - (a.place.family_renewal_score ?? -1),
      population: (a, b) => b.place.population - a.place.population,
      score: (a, b) => b.displayScore - a.displayScore || b.evaluation.score - a.evaluation.score
    };

    sorted.sort(sorters[sort] || sorters.score);
    return sorted;
  }

  window.PlacecraftScoring = {
    clone,
    createInitialControls,
    normalize,
    utility,
    hardFailure,
    evaluate,
    sortRows
  };
})();
