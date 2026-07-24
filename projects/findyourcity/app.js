(() => {
  'use strict';

  // Application dependencies and immutable data

  const DATA = window.PLACE_DATA;
  const CONFIG = window.PlacecraftConfig;
  const SCORING = window.PlacecraftScoring;

  if (!DATA?.places || !CONFIG || !SCORING) {
    document.body.innerHTML = '<p style="padding:2rem">Placecraft could not load its application data.</p>';
    return;
  }

  const {
    WEIGHTS,
    PRIORITY_LABELS,
    ESSENTIAL_METRIC_IDS,
    GROUPS,
    METRICS,
    PRESETS,
    GAME_METRIC_IDS,
    COMPARE_FIELDS
  } = CONFIG;

  const {
    clone,
    createInitialControls,
    normalize,
    utility,
    evaluate,
    sortRows
  } = SCORING;

  const places = DATA.places;
  const placesById = new Map(places.map((place) => [place.id, place]));
  const metricsById = new Map(METRICS.map((metric) => [metric.id, metric]));
  const essentialMetricIds = new Set(ESSENTIAL_METRIC_IDS);
  const initialControls = createInitialControls(METRICS);

  const MAP_MODES = {
    score: {
      low: 'weaker fit',
      high: 'stronger fit',
      value: (row) => row.evaluation.score
    },
    cost: {
      low: 'higher cost',
      high: 'lower cost',
      value: (row) => 100 * (1 - normalize(row.place.median_home_value, 100_000, 1_500_000))
    },
    weather: {
      low: 'more humid',
      high: 'drier summer',
      value: (row) => 100 * (1 - normalize(row.place.summer_dewpoint_f, 38, 76))
    },
    momentum: {
      low: 'more settled',
      high: 'faster change',
      value: (row) => row.place.momentum_score
    },
    risk: {
      low: 'higher proxy',
      high: 'lower proxy',
      value: (row) => 100 * (1 - normalize(row.place.climate_risk_proxy, 0, 100))
    }
  };

  const FRIENDLY_REASON_LABELS = {
    population_min: 'city size',
    population_max: 'city size',
    home_max: 'your housing budget',
    rent_max: 'rent',
    income_min: 'local incomes',
    unemployment_max: 'employment',
    housing_strain_max: 'housing stability',
    urbanity_min: 'urban intensity',
    urban_form_min: 'urban fabric',
    density_min: 'density',
    metro_scale_min: 'metro scale',
    prewar_min: 'older urban fabric',
    young_adult_min: 'younger adult concentration',
    city_pulse_min: 'city pulse',
    momentum_range: 'your preferred pace of change',
    family_renewal_min: 'young-family renewal',
    walk_min: 'walkability',
    carfree_min: 'car-optional living',
    transit_min: 'transit access',
    drive_alone_max: 'lower car dependence',
    commute_max: 'shorter commutes',
    long_commute_max: 'fewer long commutes',
    traffic_max: 'lower traffic friction',
    airport_max: 'local airport access',
    major_airport_max: 'major airport access',
    global_airport_max: 'global access',
    jan_min: 'milder winters',
    jul_max: 'summer heat tolerance',
    dew_max: 'lower summer humidity',
    snow_max: 'snowfall',
    comfort_min: 'comfortable weather',
    ocean_max: 'ocean access',
    shore_max: 'water access',
    air_quality_max: 'air-quality pressure',
    crime_max: 'lower social stress',
    climate_risk_max: 'climate risk',
    flood_max: 'flood exposure',
    wildfire_max: 'wildfire exposure',
    age_range: 'age profile',
    education_min: 'education profile',
    diversity_min: 'diversity'
  };

  const state = {
    controls: clone(initialControls),
    preset: 'Balanced',
    mapMode: 'score',
    sort: 'score',
    visibleCount: 12,
    showNearMisses: false,
    advancedOpen: false,
    openGroups: new Set(),
    pinned: new Set(),
    ranked: [],
    strictCount: 0,
    evaluations: new Map(),
    recalcQueued: false,
    game: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const elements = {
    sidebar: $('.sidebar'),
    essentialControls: $('#essentialControls'),
    advancedControls: $('#advancedControls'),
    advancedPanel: $('#advancedPanel'),
    advancedToggle: $('#advancedToggle'),
    advancedSummary: $('#advancedSummary'),
    results: $('#results'),
    mapPoints: $('#mapPoints'),
    mapTooltip: $('#mapTooltip'),
    toast: $('#toast')
  };

  // Formatting and shared helpers

  function escapeHTML(value) {
    return String(value ?? '').replace(
      /[&<>'"]/g,
      (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      })[character]
    );
  }

  function format(value, style) {
    if (value == null || Number.isNaN(Number(value))) {
      return '—';
    }

    const numericValue = Number(value);

    switch (style) {
      case 'money':
        return `$${Math.round(numericValue).toLocaleString()}`;
      case 'compact':
        return Intl.NumberFormat('en', {
          notation: 'compact',
          maximumFractionDigits: 1
        }).format(numericValue);
      case 'percent':
        return `${numericValue.toFixed(numericValue < 10 ? 1 : 0)}%`;
      case 'signedPercent':
        return `${numericValue > 0 ? '+' : ''}${numericValue.toFixed(1)}%`;
      case 'temp':
        return `${Math.round(numericValue)}°F`;
      case 'minutes':
        return `${Math.round(numericValue)} min`;
      case 'miles':
        return `${Math.round(numericValue)} mi`;
      case 'inches':
        return `${Math.round(numericValue)} in`;
      case 'days':
        return `${Math.round(numericValue)} days`;
      case 'density':
        return `${Math.round(numericValue).toLocaleString()}/mi²`;
      case 'years':
        return `${Math.round(numericValue)} yrs`;
      case 'score':
        return `${Math.round(numericValue)}/100`;
      case 'momentum': {
        const label = numericValue < 25
          ? 'Contracting'
          : numericValue < 42
            ? 'Settled'
            : numericValue < 62
              ? 'Evolving'
              : numericValue < 80
                ? 'Fast-changing'
                : 'Surging';
        return `${label} · ${Math.round(numericValue)}`;
      }
      case 'renewal': {
        const label = numericValue < 25
          ? 'Aging'
          : numericValue < 42
            ? 'Low renewal'
            : numericValue < 60
              ? 'Mixed'
              : numericValue < 78
                ? 'Strong'
                : 'Very strong';
        return `${label} · ${Math.round(numericValue)}`;
      }
      default:
        return Number.isInteger(numericValue)
          ? numericValue.toLocaleString()
          : numericValue.toFixed(1);
    }
  }

  function formatControl(metric, control) {
    if (metric.kind === 'range') {
      return `${format(control.low, metric.format)}–${format(control.high, metric.format)}`;
    }

    const prefix = metric.kind === 'max' ? '≤ ' : '≥ ';
    return `${prefix}${format(control.value, metric.format)}`;
  }

  function countActivePreferences(metricIds = METRICS.map((metric) => metric.id)) {
    return metricIds.filter((id) => {
      const control = state.controls[id];
      return control.level > 0 || control.hard;
    }).length;
  }

  function countDealbreakers() {
    return METRICS.filter((metric) => state.controls[metric.id].hard).length;
  }

  function evaluatePlace(place) {
    return evaluate(place, METRICS, state.controls, WEIGHTS);
  }

  // Ranking lifecycle

  function recalculate() {
    state.evaluations.clear();

    const strictMatches = [];
    const nearMisses = [];

    for (const place of places) {
      const evaluation = evaluatePlace(place);
      state.evaluations.set(place.id, evaluation);

      if (!evaluation.failures.length) {
        strictMatches.push({
          place,
          evaluation,
          displayScore: evaluation.score,
          near: false
        });
        continue;
      }

      if (evaluation.failures.length === 1) {
        const [failure] = evaluation.failures;
        const penalty = 18 + failure.severity * 32;
        nearMisses.push({
          place,
          evaluation,
          displayScore: evaluation.score - penalty,
          near: true
        });
      }
    }

    state.strictCount = strictMatches.length;
    const resultPool = state.showNearMisses
      ? [...strictMatches, ...nearMisses]
      : strictMatches;

    state.ranked = sortRows(resultPool, state.sort);
    state.visibleCount = Math.max(12, Math.min(state.visibleCount, state.ranked.length));

    renderSummary();
    renderResults();
    renderMap();
    updateURL();

    $('#mapStatus').textContent = `Ranked ${places.length.toLocaleString()} places on this device`;
    state.recalcQueued = false;
  }

  function queueRecalculation() {
    if (state.recalcQueued) {
      return;
    }

    state.recalcQueued = true;
    $('#mapStatus').textContent = 'Recalculating locally…';
    requestAnimationFrame(recalculate);
  }

  function renderSummary() {
    const activeCount = countActivePreferences();
    const dealbreakerCount = countDealbreakers();
    const matchLabel = state.strictCount === 1 ? 'place' : 'places';

    $('#matchCount').textContent = `${state.strictCount.toLocaleString()} ${matchLabel}`;
    $('#activePreferenceCount').textContent = `${activeCount} weighted · ${dealbreakerCount} must`;
    $('#nearMissButton').textContent = state.showNearMisses
      ? 'Hide near misses'
      : 'Show near misses';
    $('#resultsTitle').textContent = state.showNearMisses
      ? 'Best fits and closest compromises'
      : 'Best fits';
    $('#resultsMeta').textContent = [
      `${activeCount} active preferences`,
      `${state.strictCount.toLocaleString()} exact matches`
    ].join(' · ');
    $('#showMoreButton').hidden = state.visibleCount >= state.ranked.length;

    renderAdvancedSummary();
  }

  // Preference controls and progressive disclosure

  function renderPresets() {
    $('#presetStrip').innerHTML = Object.keys(PRESETS)
      .map((name) => `
        <button
          class="preset-pill ${state.preset === name ? 'active' : ''}"
          data-preset="${escapeHTML(name)}"
        >${escapeHTML(name)}</button>
      `)
      .join('');
  }

  function renderMetricControl(metric, { essential = false } = {}) {
    const control = state.controls[metric.id];
    const inputId = `metric-${metric.id}`;
    const labelTargetId = metric.kind === 'range' ? `${inputId}-low` : inputId;

    const sliders = metric.kind === 'range'
      ? `
        <div class="range-pair">
          <input
            id="${inputId}-low"
            type="range"
            data-control-role="low"
            min="${metric.min}"
            max="${metric.max}"
            step="${metric.step}"
            value="${control.low}"
            aria-label="${escapeHTML(metric.label)} lower bound"
          >
          <input
            id="${inputId}-high"
            type="range"
            data-control-role="high"
            min="${metric.min}"
            max="${metric.max}"
            step="${metric.step}"
            value="${control.high}"
            aria-label="${escapeHTML(metric.label)} upper bound"
          >
        </div>
      `
      : `
        <input
          id="${inputId}"
          type="range"
          data-control-role="value"
          min="${metric.min}"
          max="${metric.max}"
          step="${metric.step}"
          value="${control.value}"
          aria-label="${escapeHTML(metric.label)}"
        >
      `;

    const priorityOptions = PRIORITY_LABELS
      .map((label, level) => `
        <option value="${level}" ${control.level === level ? 'selected' : ''}>${label}</option>
      `)
      .join('');

    return `
      <article
        class="metric-control ${essential ? 'metric-control--essential' : ''}"
        data-metric="${metric.id}"
      >
        <div class="metric-header">
          <label for="${labelTargetId}">${escapeHTML(metric.label)}</label>
          <output class="metric-value">${escapeHTML(formatControl(metric, control))}</output>
        </div>
        <div class="slider-row">${sliders}</div>
        <div class="metric-footer">
          <span class="metric-hint">
            <span>${escapeHTML(metric.hint[0])}</span>
            <span>${escapeHTML(metric.hint[1])}</span>
          </span>
          <div class="metric-actions">
            <select
              class="priority-select"
              data-control-role="level"
              data-level="${control.level}"
              aria-label="${escapeHTML(metric.label)} priority"
            >${priorityOptions}</select>
            <button
              class="must-toggle ${control.hard ? 'active' : ''}"
              type="button"
              data-control-action="must"
              aria-pressed="${control.hard}"
              title="${control.hard
                ? 'Required: excludes places that miss this threshold'
                : 'Make this a required threshold'}"
            >Must</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderEssentialControls() {
    elements.essentialControls.innerHTML = ESSENTIAL_METRIC_IDS
      .map((id) => renderMetricControl(metricsById.get(id), { essential: true }))
      .join('');
  }

  function renderAdvancedControls() {
    elements.advancedControls.innerHTML = GROUPS
      .map((group) => {
        const metrics = METRICS.filter(
          (metric) => metric.group === group && !essentialMetricIds.has(metric.id)
        );

        if (!metrics.length) {
          return '';
        }

        const activeCount = countActivePreferences(metrics.map((metric) => metric.id));
        const openAttribute = state.openGroups.has(group) ? 'open' : '';

        return `
          <details class="control-group" data-group="${escapeHTML(group)}" ${openAttribute}>
            <summary>
              <span class="group-title">
                <strong>${escapeHTML(group)}</strong>
                <small>${activeCount} active ${activeCount === 1 ? 'preference' : 'preferences'}</small>
              </span>
              <span class="group-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div class="group-body">
              ${metrics.map((metric) => renderMetricControl(metric)).join('')}
            </div>
          </details>
        `;
      })
      .join('');

    updateCollapseButton();
  }

  function renderAllControls() {
    renderEssentialControls();
    renderAdvancedControls();
    renderAdvancedSummary();
  }

  function renderAdvancedSummary() {
    const advancedIds = METRICS
      .filter((metric) => !essentialMetricIds.has(metric.id))
      .map((metric) => metric.id);
    const activeAdvancedCount = countActivePreferences(advancedIds);

    elements.advancedSummary.textContent = [
      `${advancedIds.length} more controls`,
      `${activeAdvancedCount} active in this setup`
    ].join(' · ');
  }

  function setAdvancedOpen(open) {
    state.advancedOpen = open;
    elements.advancedPanel.hidden = !open;
    elements.advancedToggle.setAttribute('aria-expanded', String(open));

    if (open) {
      renderAdvancedControls();
    }
  }

  function updateCollapseButton() {
    const allOpen = GROUPS.every((group) => {
      const hasAdvancedMetrics = METRICS.some(
        (metric) => metric.group === group && !essentialMetricIds.has(metric.id)
      );
      return !hasAdvancedMetrics || state.openGroups.has(group);
    });

    $('#collapseButton').textContent = allOpen ? 'Collapse groups' : 'Expand groups';
  }

  function markCustomSetup() {
    if (state.preset === 'Custom') {
      return;
    }

    state.preset = 'Custom';
    renderPresets();
  }

  function applyPreset(name) {
    state.controls = clone(initialControls);

    for (const [id, values] of Object.entries(PRESETS[name] || {})) {
      Object.assign(state.controls[id], values);
    }

    state.preset = name;
    state.visibleCount = 12;
    renderPresets();
    renderAllControls();
    queueRecalculation();
  }

  // Map and ranked results

  function project(place) {
    let { lat, lon, state: stateAbbreviation } = place;

    if (stateAbbreviation === 'AK') {
      if (lon > 0) {
        lon -= 360;
      }

      return {
        x: 35 + ((lon + 170) / 42) * 150,
        y: 350 + ((72 - lat) / 21) * 80
      };
    }

    if (stateAbbreviation === 'HI') {
      return {
        x: 205 + ((lon + 161) / 7) * 95,
        y: 380 + ((23 - lat) / 5) * 48
      };
    }

    return {
      x: 75 + ((lon + 125) / 59) * 835,
      y: 30 + ((50 - lat) / 26) * 345
    };
  }

  function mapValue(row) {
    return MAP_MODES[state.mapMode].value(row);
  }

  function renderMap() {
    const mode = MAP_MODES[state.mapMode];
    $('#mapLegendLow').textContent = mode.low;
    $('#mapLegendHigh').textContent = mode.high;

    const rowsByMapValue = [...state.ranked].sort((a, b) => mapValue(a) - mapValue(b));
    const rowsToRender = rowsByMapValue.slice(Math.max(0, rowsByMapValue.length - 2_200));
    const topResultIds = new Set(state.ranked.slice(0, 24).map((row) => row.place.id));

    elements.mapPoints.innerHTML = rowsToRender
      .map((row) => {
        const point = project(row.place);
        const value = Math.max(0, Math.min(100, mapValue(row)));
        const hue = 220 - value * 0.72;
        const radius = 1.7 + Math.min(
          4.1,
          Math.max(0, Math.log10(row.place.population / 10_000)) * 1.35
        );
        const topResultClass = topResultIds.has(row.place.id) ? 'is-top-result' : '';

        return `
          <circle
            class="map-point ${topResultClass}"
            data-id="${row.place.id}"
            cx="${point.x.toFixed(1)}"
            cy="${point.y.toFixed(1)}"
            r="${radius.toFixed(1)}"
            fill="hsl(${hue} 76% ${48 + value * 0.12}%)"
            opacity="${row.near ? 0.46 : 0.84}"
          ></circle>
        `;
      })
      .join('');
  }

  function qualityTags(place, evaluation) {
    const tags = [];

    if (place.median_home_value < 300_000) {
      tags.push(['good', 'affordable homes']);
    } else if (place.median_home_value > 900_000) {
      tags.push(['caveat', 'high housing cost']);
    }

    if (place.urbanity_score > 76) {
      tags.push(['good', place.urban_context_label.toLowerCase()]);
    } else if (place.urban_context_label === 'Metro suburb') {
      tags.push(['caveat', 'suburban urban form']);
    }

    if (place.city_pulse_score > 84) {
      tags.push(['good', 'high city pulse']);
    }

    if (place.momentum_score > 78) {
      tags.push(['good', 'rapidly changing']);
    } else if (place.momentum_score < 24) {
      tags.push(['caveat', 'contracting']);
    }

    if (place.family_renewal_score > 70) {
      tags.push(['good', 'strong family renewal']);
    } else if (place.family_renewal_score < 28) {
      tags.push(['caveat', 'aging population']);
    }

    if (place.carfree_household_pct > 22) {
      tags.push(['good', 'car-optional']);
    }

    if (place.prewar_housing_pct > 42) {
      tags.push(['good', 'older housing fabric']);
    }

    if (place.global_airport_minutes < 65) {
      tags.push(['good', 'global airport access']);
    } else if (place.global_airport_minutes > 210) {
      tags.push(['caveat', 'long airport trip']);
    }

    if (place.avg_commute_minutes < 24) {
      tags.push(['good', 'shorter commutes']);
    } else if (place.long_commute_45_pct > 30) {
      tags.push(['caveat', 'many long commutes']);
    }

    if (place.ocean_miles < 25) {
      tags.push(['good', 'near the ocean']);
    } else if (place.major_shore_miles < 15) {
      tags.push(['good', 'near major water']);
    }

    if (place.summer_dewpoint_f < 58) {
      tags.push(['good', 'dry summer']);
    } else if (place.summer_dewpoint_f > 69) {
      tags.push(['caveat', 'humid summer']);
    }

    if (place.social_stress_proxy < 35) {
      tags.push(['good', 'lower social stress']);
    } else if (place.social_stress_proxy > 78) {
      tags.push(['caveat', 'higher social stress']);
    }

    if (evaluation.failures.length) {
      tags.unshift([
        'caveat',
        `misses ${evaluation.failures[0].metric.label.toLowerCase()}`
      ]);
    }

    return tags.slice(0, 3);
  }

  function summarizeFit(row) {
    const strongContributions = [...row.evaluation.contributions]
      .filter((contribution) => contribution.utility >= 0.72 && contribution.weight >= 5)
      .sort((a, b) => b.points - a.points)
      .map((contribution) => FRIENDLY_REASON_LABELS[contribution.metric.id])
      .filter(Boolean);

    const uniqueReasons = [...new Set(strongContributions)].slice(0, 3);

    if (!uniqueReasons.length) {
      return row.near
        ? 'A close compromise with one threshold just out of range.'
        : 'A broadly balanced match without one dominant advantage.';
    }

    const reasonText = uniqueReasons.length === 1
      ? uniqueReasons[0]
      : `${uniqueReasons.slice(0, -1).join(', ')} and ${uniqueReasons.at(-1)}`;

    return `${row.near ? 'Close compromise; still strong on' : 'Strong on'} ${reasonText}.`;
  }

  function resultCard(row, index) {
    const { place, evaluation } = row;
    const pinned = state.pinned.has(place.id);
    const score = Math.max(0, Math.round(row.displayScore));
    const tags = qualityTags(place, evaluation)
      .slice(0, 2)
      .map(([className, text]) => `
        <span class="quality-tag ${className}">${escapeHTML(text)}</span>
      `)
      .join('');

    return `
      <article class="result-card" data-id="${place.id}">
        <div class="card-main" data-action="detail">
          <div class="card-head">
            <div class="rank-name">
              <span class="rank-number">${index + 1}</span>
              <div>
                <h3>${escapeHTML(place.short_name)}</h3>
                <div class="subtitle">
                  ${escapeHTML(place.state_name)} ·
                  ${format(place.population, 'compact')} people${row.near ? ' · near miss' : ''}
                </div>
              </div>
            </div>
            <div class="score-ring" style="--score:${score}">
              <strong>${score}</strong>
            </div>
          </div>

          <p class="fit-summary">${escapeHTML(summarizeFit(row))}</p>

          <div class="card-metrics">
            <div class="card-metric">
              <span>Home value</span>
              <strong>${format(place.median_home_value, 'money')}</strong>
            </div>
            <div class="card-metric">
              <span>Global airport</span>
              <strong>
                ${escapeHTML(place.global_airport_code)} ·
                ${format(place.global_airport_minutes, 'minutes')}
              </strong>
            </div>
            <div class="card-metric">
              <span>Winter / humidity</span>
              <strong>${format(place.jan_high_f, 'temp')} · ${format(place.summer_dewpoint_f, 'temp')} dew</strong>
            </div>
            <div class="card-metric">
              <span>Urban feel</span>
              <strong>${format(place.urbanity_score, 'score')}</strong>
            </div>
          </div>

          <div class="quality-tags">${tags}</div>
        </div>
        <div class="card-footer">
          <button data-action="detail">View reasoning</button>
          <button data-action="pin" class="${pinned ? 'active' : ''}">
            ${pinned ? 'Added to compare' : 'Add to compare'}
          </button>
        </div>
      </article>
    `;
  }

  function renderResults() {
    const visibleRows = state.ranked.slice(0, state.visibleCount);

    if (!visibleRows.length) {
      elements.results.innerHTML = `
        <div class="empty-state">
          <h3>No exact matches</h3>
          <p>Relax one required threshold or show near misses to see the closest compromises.</p>
        </div>
      `;
      return;
    }

    elements.results.innerHTML = visibleRows
      .map((row, index) => resultCard(row, index))
      .join('');
  }

  function contributionRows(evaluation) {
    return [...evaluation.contributions]
      .sort((a, b) => b.weight - a.weight || b.utility - a.utility)
      .slice(0, 10);
  }

  function fact(label, value) {
    return `
      <div class="fact">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </div>
    `;
  }

  function airportRow(label, code, name, minutes) {
    return `
      <div class="airport-row">
        <div>
          <span class="eyebrow">${escapeHTML(label)}</span>
          <span class="airport-code">${escapeHTML(code || '—')}</span>
        </div>
        <div>
          ${escapeHTML(name || 'Unavailable')}
          <small>Estimated drive time</small>
        </div>
        <b>${format(minutes, 'minutes')}</b>
      </div>
    `;
  }

  // Place details and comparison

  function showDetail(id) {
    const place = placesById.get(id);
    if (!place) {
      return;
    }

    const evaluation = state.evaluations.get(id) || evaluatePlace(place);
    const rankedIndex = state.ranked.findIndex((row) => row.place.id === id);
    const score = Math.round(evaluation.score);

    const reasons = contributionRows(evaluation)
      .map((contribution) => `
        <div class="reason-row">
          <span>${escapeHTML(contribution.metric.label)}</span>
          <div class="reason-bar">
            <i style="width:${Math.round(contribution.utility * 100)}%"></i>
          </div>
          <em>${Math.round(contribution.utility * 100)}</em>
        </div>
      `)
      .join('');

    const failures = evaluation.failures.length
      ? `
        <div class="warning-card" style="margin-bottom:12px">
          <strong>Near miss</strong>
          <span>
            ${evaluation.failures
              .map((failure) => `
                ${failure.metric.label}: ${format(failure.value, failure.metric.format)}
                vs ${formatControl(failure.metric, state.controls[failure.metric.id])}
              `)
              .join(' · ')}
          </span>
        </div>
      `
      : '';

    $('#detailContent').innerHTML = `
      <div class="detail-hero">
        <div>
          <span class="eyebrow">${rankedIndex >= 0 ? `Ranked #${rankedIndex + 1}` : 'Place profile'}</span>
          <h2>${escapeHTML(place.display_name)}</h2>
          <p>
            ${format(place.population, 'compact')} residents ·
            ${escapeHTML(place.urban_context_label)} ·
            ${format(place.density, 'density')}
          </p>
        </div>
        <div class="big-score">
          <strong>${score}</strong>
          <span>preference fit</span>
        </div>
      </div>

      ${failures}

      <div class="detail-grid">
        <section class="detail-section">
          <h3>Why it lands here</h3>
          ${reasons || '<p>No weighted preferences are active.</p>'}
        </section>

        <section class="detail-section">
          <h3>Urban context</h3>
          <div class="fact-grid">
            ${fact('Urban intensity', format(place.urbanity_score, 'score'))}
            ${fact('Urban fabric', format(place.urban_form_score, 'score'))}
            ${fact('City pulse', format(place.city_pulse_score, 'score'))}
            ${fact('Walkability', format(place.walkability_proxy, 'score'))}
            ${fact('Municipal density', format(place.density, 'density'))}
            ${fact('Population within 30 mi', format(place.nearby_population_30mi, 'compact'))}
            ${fact('Metro core', `${place.metro_core_name}, ${place.metro_core_state} · ${format(place.metro_core_miles, 'miles')}`)}
            ${fact('Pre-1940 housing', format(place.prewar_housing_pct, 'percent'))}
            ${fact('Age 25–39', format(place.young_adult_25_39_pct, 'percent'))}
          </div>
        </section>

        <section class="detail-section">
          <h3>Movement and traffic</h3>
          <div class="fact-grid">
            ${fact('Average commute', format(place.avg_commute_minutes, 'minutes'))}
            ${fact('45+ minute commutes', format(place.long_commute_45_pct, 'percent'))}
            ${fact('60+ minute commutes', format(place.very_long_commute_60_pct, 'percent'))}
            ${fact('Traffic friction proxy', format(place.traffic_friction_proxy, 'score'))}
            ${fact('Car-free households', format(place.carfree_household_pct, 'percent'))}
            ${fact('Drive alone', format(place.drive_alone_pct, 'percent'))}
            ${fact('Transit share', format(place.transit_pct, 'percent'))}
            ${fact('Walk / bike share', format(place.walk_bike_pct, 'percent'))}
          </div>
        </section>

        <section class="detail-section">
          <h3>Momentum and families</h3>
          <div class="fact-grid">
            ${fact('Change trajectory', format(place.momentum_score, 'momentum'))}
            ${fact('Population change', `${format(place.population_growth_5yr_pct, 'signedPercent')} · 5 yr`)}
            ${fact('Housing-unit change', `${format(place.housing_growth_5yr_pct, 'signedPercent')} · 5 yr`)}
            ${fact('Age 25–39 change', `${format(place.young_adult_growth_5yr_pct, 'signedPercent')} · 5 yr`)}
            ${fact('Young-family renewal', format(place.family_renewal_score, 'renewal'))}
            ${fact('Households with children', format(place.households_with_children_pct, 'percent'))}
            ${fact('Under age 5', format(place.under5_pct, 'percent'))}
            ${fact('Under age 18', format(place.under18_pct, 'percent'))}
            ${fact('Age 65+', format(place.age65plus_pct, 'percent'))}
            ${fact('Child / senior ratio', format(place.child_senior_ratio))}
            ${fact('Young-child change', `${format(place.under5_growth_5yr_pct, 'signedPercent')} · 5 yr`)}
            ${fact('Trend coverage', format(place.trend_coverage_pct, 'percent'))}
          </div>
        </section>

        <section class="detail-section">
          <h3>Cost and people</h3>
          <div class="fact-grid">
            ${fact('Home value', format(place.median_home_value, 'money'))}
            ${fact('Median rent', format(place.median_rent, 'money'))}
            ${fact('Household income', format(place.median_income, 'money'))}
            ${fact("Bachelor's degree+", format(place.bachelors_plus_pct, 'percent'))}
            ${fact('Owner share', format(place.owner_pct, 'percent'))}
            ${fact('Poverty', format(place.poverty_pct, 'percent'))}
            ${fact('Unemployment', format(place.unemployment_pct, 'percent'))}
            ${fact('Diversity', format(place.diversity_index, 'score'))}
          </div>
        </section>

        <section class="detail-section">
          <h3>Airport access</h3>
          <div class="airport-stack">
            ${airportRow('Local', place.airport_code, place.airport_name, place.airport_minutes)}
            ${airportRow('Major', place.major_airport_code, place.major_airport_name, place.major_airport_minutes)}
            ${airportRow('Global', place.global_airport_code, place.global_airport_name, place.global_airport_minutes)}
          </div>
        </section>

        <section class="detail-section">
          <h3>Weather, water, and screening proxies</h3>
          <div class="fact-grid">
            ${fact('January high', format(place.jan_high_f, 'temp'))}
            ${fact('July high', format(place.jul_high_f, 'temp'))}
            ${fact('Summer dew point', format(place.summer_dewpoint_f, 'temp'))}
            ${fact('Snow estimate', format(place.annual_snow_in, 'inches'))}
            ${fact('Ocean', format(place.ocean_miles, 'miles'))}
            ${fact('Major shoreline', format(place.major_shore_miles, 'miles'))}
            ${fact('Social stress proxy', format(place.social_stress_proxy, 'score'))}
            ${fact('Climate proxy', format(place.climate_risk_proxy, 'score'))}
            ${fact('Flood proxy', format(place.flood_risk_proxy, 'score'))}
          </div>
        </section>
      </div>

      <div class="detail-actions">
        <button class="primary-button" data-detail-pin="${place.id}">
          ${state.pinned.has(place.id) ? 'Remove from compare' : 'Add to compare'}
        </button>
        <button class="secondary-button" data-copy-place="${place.id}">Copy place summary</button>
      </div>
    `;

    const dialog = $('#detailDialog');
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function togglePin(id) {
    if (state.pinned.has(id)) {
      state.pinned.delete(id);
    } else {
      if (state.pinned.size >= 4) {
        toast('Compare up to four places at a time.');
        return;
      }
      state.pinned.add(id);
    }

    renderResults();
    renderCompareTray();
    updateURL();

    if ($('#detailDialog').open && placesById.has(id)) {
      showDetail(id);
    }
  }

  function renderCompareTray() {
    const tray = $('#compareTray');
    $('#compareCount').textContent = state.pinned.size;
    tray.hidden = !state.pinned.size;

    $('#compareChips').innerHTML = [...state.pinned]
      .map((id) => {
        const place = placesById.get(id);
        return `
          <span class="compare-chip">
            ${escapeHTML(place.display_name)}
            <button data-remove-pin="${id}" aria-label="Remove ${escapeHTML(place.display_name)}">×</button>
          </span>
        `;
      })
      .join('');
  }

  function compareValue(place, field) {
    if (field === 'score') {
      return (state.evaluations.get(place.id) || evaluatePlace(place)).score;
    }

    return place[field];
  }

  function showCompare() {
    const selectedPlaces = [...state.pinned]
      .map((id) => placesById.get(id))
      .filter(Boolean);

    if (selectedPlaces.length < 2) {
      toast('Add at least two places to compare.');
      return;
    }

    const rows = COMPARE_FIELDS
      .map((descriptor) => {
        const values = selectedPlaces.map((place) => Number(compareValue(place, descriptor.field)));
        const finiteValues = values.filter(Number.isFinite);
        const bestValue = descriptor.direction === 'high'
          ? Math.max(...finiteValues)
          : Math.min(...finiteValues);

        return `
          <tr>
            <td>${escapeHTML(descriptor.label)}</td>
            ${selectedPlaces
              .map((place, index) => `
                <td class="${values[index] === bestValue ? 'best-cell' : ''}">
                  ${escapeHTML(format(values[index], descriptor.format))}
                </td>
              `)
              .join('')}
          </tr>
        `;
      })
      .join('');

    $('#compareContent').innerHTML = `
      <span class="dialog-kicker">Side by side</span>
      <h2 class="compare-title">The tradeoffs, without the hand-waving</h2>
      <div class="compare-table-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th>Metric</th>
              ${selectedPlaces.map((place) => `<th>${escapeHTML(place.display_name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    $('#compareDialog').showModal();
  }

  // Pairwise preference game

  function candidateDistance(placeA, placeB) {
    const fields = [
      ['median_home_value', 100_000, 1_500_000],
      ['global_airport_minutes', 15, 420],
      ['urbanity_score', 0, 100],
      ['urban_form_score', 0, 100],
      ['city_pulse_score', 0, 100],
      ['momentum_score', 0, 100],
      ['family_renewal_score', 0, 100],
      ['walkability_proxy', 0, 100],
      ['prewar_housing_pct', 0, 80],
      ['bachelors_plus_pct', 5, 90],
      ['jan_high_f', 5, 75],
      ['summer_dewpoint_f', 38, 76],
      ['ocean_miles', 0, 800],
      ['social_stress_proxy', 0, 100],
      ['population', 10_000, 3_000_000]
    ];

    return fields.reduce((sum, [field, min, max]) => {
      const normalizedA = (Math.min(max, placeA[field]) - min) / (max - min);
      const normalizedB = (Math.min(max, placeB[field]) - min) / (max - min);
      return sum + Math.abs(normalizedA - normalizedB);
    }, 0);
  }

  function gameCandidates() {
    if (state.ranked.length) {
      return state.ranked.slice(0, Math.min(700, state.ranked.length));
    }

    return places.slice(0, 700).map((place) => {
      const evaluation = evaluatePlace(place);
      return { place, evaluation, displayScore: evaluation.score };
    });
  }

  function pickPair() {
    const candidates = gameCandidates();
    let bestPair = null;
    let bestValue = -1;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const rowA = candidates[Math.floor(Math.random() * candidates.length)];
      const rowB = candidates[Math.floor(Math.random() * candidates.length)];

      if (!rowA || !rowB || rowA.place.id === rowB.place.id || rowA.place.state === rowB.place.state) {
        continue;
      }

      const scoreDifference = Math.abs(rowA.evaluation.score - rowB.evaluation.score);
      const balance = Math.max(0, 1 - scoreDifference / 28);
      const pairValue = candidateDistance(rowA.place, rowB.place) * balance;

      if (pairValue > bestValue) {
        bestPair = [rowA.place, rowB.place];
        bestValue = pairValue;
      }
    }

    return bestPair || [candidates[0].place, candidates[1].place];
  }

  function startGame() {
    state.game = {
      round: 0,
      total: 8,
      pair: null,
      weights: Object.fromEntries(
        GAME_METRIC_IDS.map((id) => [id, WEIGHTS[state.controls[id].level]])
      ),
      choices: [],
      draftControls: clone(state.controls)
    };

    nextPair();

    const dialog = $('#gameDialog');
    if (!dialog.open) {
      dialog.showModal();
    }
  }

  function nextPair() {
    state.game.pair = pickPair();
    renderGame();
  }

  function pairMetric(label, value) {
    return `
      <div class="pair-metric">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </div>
    `;
  }

  function pairCard(place, key) {
    return `
      <article class="pair-card">
        <button class="choose" data-game-choice="${key}">
          <h3>${escapeHTML(place.short_name)}</h3>
          <span class="pair-state">${escapeHTML(place.state_name)}</span>
          <div class="pair-metrics">
            ${pairMetric('Home', format(place.median_home_value, 'money'))}
            ${pairMetric(
              'Global airport',
              `${place.global_airport_code} · ${format(place.global_airport_minutes, 'minutes')}`
            )}
            ${pairMetric('Urban feel', format(place.urbanity_score, 'score'))}
            ${pairMetric('City pulse', format(place.city_pulse_score, 'score'))}
            ${pairMetric('Change trajectory', format(place.momentum_score, 'momentum'))}
            ${pairMetric('Family renewal', format(place.family_renewal_score, 'renewal'))}
            ${pairMetric('Jan / Jul', `${format(place.jan_high_f, 'temp')} / ${format(place.jul_high_f, 'temp')}`)}
            ${pairMetric('Summer dew point', format(place.summer_dewpoint_f, 'temp'))}
            ${pairMetric('Car-free households', format(place.carfree_household_pct, 'percent'))}
            ${pairMetric('Average commute', format(place.avg_commute_minutes, 'minutes'))}
            ${pairMetric('Social stress', format(place.social_stress_proxy, 'score'))}
          </div>
        </button>
        <span class="pair-pick">Pick ${escapeHTML(place.short_name)}</span>
      </article>
    `;
  }

  function renderGame() {
    const game = state.game;

    if (game.round >= game.total) {
      renderGameResult();
      return;
    }

    const [placeA, placeB] = game.pair;

    $('#gameContent').innerHTML = `
      <div class="game-head">
        <span class="eyebrow">Choice ${game.round + 1} of ${game.total}</span>
        <h2>Where would you rather land?</h2>
        <p>Choose instinctively. Placecraft watches which tradeoffs you keep accepting.</p>
        <div class="game-progress">
          <i style="width:${(100 * game.round) / game.total}%"></i>
        </div>
      </div>
      <div class="pair-grid">
        ${pairCard(placeA, 'a')}
        <div class="pair-or">OR</div>
        ${pairCard(placeB, 'b')}
      </div>
      <div class="game-skip">
        <button class="secondary-button" data-game-choice="skip">Neither</button>
        <button class="secondary-button" data-game-choice="both">Both are plausible</button>
        <button class="text-button" data-game-finish>Finish early</button>
      </div>
    `;
  }

  function recordGameChoice(choice) {
    const game = state.game;
    if (!game) {
      return;
    }

    if (choice === 'a' || choice === 'b') {
      const winner = game.pair[choice === 'a' ? 0 : 1];
      const loser = game.pair[choice === 'a' ? 1 : 0];

      for (const id of GAME_METRIC_IDS) {
        const metric = metricsById.get(id);
        const control = game.draftControls[id];
        const utilityDifference =
          utility(winner, metric, control) - utility(loser, metric, control);

        game.weights[id] = Math.max(
          0,
          Math.min(9, game.weights[id] + utilityDifference * 2.4)
        );

        const winnerValue = winner[metric.field];
        if (!Number.isFinite(winnerValue)) {
          continue;
        }

        if (metric.kind === 'max' && winnerValue > control.value) {
          control.value = Math.min(
            metric.max,
            control.value + (winnerValue - control.value) * 0.12
          );
        }

        if (metric.kind === 'min' && winnerValue < control.value) {
          control.value = Math.max(
            metric.min,
            control.value - (control.value - winnerValue) * 0.12
          );
        }
      }

      game.choices.push(winner.id);
    }

    game.round += 1;

    if (game.round >= game.total) {
      renderGameResult();
    } else {
      nextPair();
    }
  }

  function nearestPriorityLevel(weight) {
    return WEIGHTS.reduce(
      (best, currentWeight, index) => {
        const difference = Math.abs(currentWeight - weight);
        return difference < best.difference
          ? { difference, index }
          : best;
      },
      { difference: Infinity, index: 0 }
    ).index;
  }

  function renderGameResult() {
    const sortedWeights = Object.entries(state.game.weights)
      .sort((a, b) => b[1] - a[1]);

    for (const [id, weight] of sortedWeights) {
      state.game.draftControls[id].level = nearestPriorityLevel(weight);
    }

    const chips = sortedWeights
      .slice(0, 6)
      .map(([id, weight]) => {
        const level = weight >= 7 ? 'critical' : weight >= 4 ? 'important' : 'nice';
        return `
          <span class="inference-chip">
            ${escapeHTML(metricsById.get(id).label)} · ${level}
          </span>
        `;
      })
      .join('');

    $('#gameContent').innerHTML = `
      <div class="game-head">
        <span class="eyebrow">Preference sketch</span>
        <h2>Your choices sharpened the model</h2>
        <p>
          This is inference, not mind reading. It raised the factors your winners repeatedly
          handled better and softened the ones you kept trading away.
        </p>
      </div>
      <div class="inference-list">${chips}</div>
      <div class="game-result-actions">
        <button class="primary-button" data-game-apply>Apply these priorities</button>
        <button class="secondary-button" data-game-restart>Play again</button>
      </div>
    `;
  }

  function applyGame() {
    state.controls = clone(state.game.draftControls);
    state.preset = 'Custom';
    renderPresets();
    renderAllControls();
    queueRecalculation();
    $('#gameDialog').close();
    toast('Pairwise choices applied.');
  }

  function placeSummary(place) {
    return [
      `${place.display_name}: ${format(place.population, 'compact')} residents`,
      `median home ${format(place.median_home_value, 'money')}`,
      `median rent ${format(place.median_rent, 'money')}`,
      `global airport ${place.global_airport_code} about ${format(place.global_airport_minutes, 'minutes')}`,
      `January/July highs ${format(place.jan_high_f, 'temp')}/${format(place.jul_high_f, 'temp')}`,
      `summer dew point ${format(place.summer_dewpoint_f, 'temp')}`,
      `urban intensity ${format(place.urbanity_score, 'score')}`,
      `urban fabric ${format(place.urban_form_score, 'score')}`,
      `city pulse ${format(place.city_pulse_score, 'score')}`,
      `change trajectory ${format(place.momentum_score, 'momentum')}`,
      `population change ${format(place.population_growth_5yr_pct, 'signedPercent')} over five years`,
      `housing change ${format(place.housing_growth_5yr_pct, 'signedPercent')} over five years`,
      `young-family renewal ${format(place.family_renewal_score, 'renewal')}`,
      `average commute ${format(place.avg_commute_minutes, 'minutes')}`,
      `car-free households ${format(place.carfree_household_pct, 'percent')}`
    ].join(', ') + '.';
  }

  // Downloads, sharing, and state persistence

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function csvEscape(value) {
    if (value == null) {
      return '';
    }

    const text = String(value);
    return /[",\n\r]/.test(text)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  }

  function downloadCsv() {
    const fields = Object.keys(places[0]);
    const rows = [
      fields.join(','),
      ...places.map((place) => fields.map((field) => csvEscape(place[field])).join(','))
    ];

    downloadText(
      'placecraft-localities.csv',
      rows.join('\n'),
      'text/csv;charset=utf-8'
    );
  }

  function fallbackCopy(text, successMessage) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
    toast(successMessage);
  }

  function copyText(text, successMessage = 'Copied.') {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => toast(successMessage))
        .catch(() => fallbackCopy(text, successMessage));
      return;
    }

    fallbackCopy(text, successMessage);
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    clearTimeout(elements.toast._timer);
    elements.toast._timer = setTimeout(() => elements.toast.classList.remove('show'), 2_200);
  }

  function serializeState() {
    return {
      controls: state.controls,
      pinned: [...state.pinned],
      mapMode: state.mapMode,
      sort: state.sort,
      nearMisses: state.showNearMisses
    };
  }

  function encodeState(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary)
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  function decodeState(encodedValue) {
    try {
      const padding = '='.repeat((4 - (encodedValue.length % 4)) % 4);
      const binary = atob(
        encodedValue.replaceAll('-', '+').replaceAll('_', '/') + padding
      );
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function updateURL() {
    try {
      const hash = encodeState(serializeState());
      history.replaceState(null, '', `${location.pathname}${location.search}#s=${hash}`);
    } catch {
      // Some browsers restrict history updates for local file URLs.
    }
  }

  function loadURLState() {
    const match = location.hash.match(/#s=([^&]+)/);
    if (!match) {
      return false;
    }

    const saved = decodeState(match[1]);
    if (!saved) {
      return false;
    }

    state.controls = clone(initialControls);
    state.pinned.clear();
    state.mapMode = 'score';
    state.sort = 'score';
    state.showNearMisses = false;

    const savedControls = saved.controls || saved.c;
    if (savedControls) {
      for (const metric of METRICS) {
        if (savedControls[metric.id]) {
          state.controls[metric.id] = {
            ...state.controls[metric.id],
            ...savedControls[metric.id]
          };
        }
      }
    }

    const savedPins = saved.pinned || saved.p;
    if (Array.isArray(savedPins)) {
      savedPins
        .slice(0, 4)
        .filter((id) => placesById.has(id))
        .forEach((id) => state.pinned.add(id));
    }

    const savedMapMode = saved.mapMode || saved.m;
    if (Object.hasOwn(MAP_MODES, savedMapMode)) {
      state.mapMode = savedMapMode;
    }

    const savedSort = saved.sort || saved.s;
    if (['score', 'home', 'airport', 'urban', 'walk', 'population'].includes(savedSort)) {
      state.sort = savedSort;
    }

    state.showNearMisses = Boolean(saved.nearMisses ?? saved.n);
    state.preset = 'Custom';
    return true;
  }

  function populateDataDialog() {
    $('#actualFields').innerHTML = DATA.meta.actual_fields
      .map((field) => `<li>${escapeHTML(field)}</li>`)
      .join('');
    $('#estimatedFields').innerHTML = DATA.meta.estimated_fields
      .map((field) => `<li>${escapeHTML(field)}</li>`)
      .join('');
  }

  function handleSearch(value) {
    const query = value.trim().toLowerCase();
    const suggestions = $('#searchSuggestions');

    if (query.length < 2) {
      suggestions.hidden = true;
      return;
    }

    const matches = places
      .filter((place) => place.display_name.toLowerCase().includes(query))
      .sort((placeA, placeB) => {
        const startsA = placeA.display_name.toLowerCase().startsWith(query) ? 0 : 1;
        const startsB = placeB.display_name.toLowerCase().startsWith(query) ? 0 : 1;
        return startsA - startsB || placeB.population - placeA.population;
      })
      .slice(0, 8);

    suggestions.innerHTML = matches
      .map((place) => `
        <button class="suggestion" data-search-id="${place.id}">
          <span>${escapeHTML(place.display_name)}</span>
          <small>${format(place.population, 'compact')}</small>
        </button>
      `)
      .join('');
    suggestions.hidden = !matches.length;
  }

  function updateMetricFromRange(input) {
    const wrapper = input.closest('[data-metric]');
    if (!wrapper) {
      return;
    }

    const metric = metricsById.get(wrapper.dataset.metric);
    const control = state.controls[metric.id];
    const role = input.dataset.controlRole;

    if (!['value', 'low', 'high'].includes(role)) {
      return;
    }

    control[role] = Number(input.value);

    if (metric.kind === 'range' && control.low > control.high) {
      if (role === 'low') {
        control.high = control.low;
        wrapper.querySelector('[data-control-role="high"]').value = control.high;
      } else {
        control.low = control.high;
        wrapper.querySelector('[data-control-role="low"]').value = control.low;
      }
    }

    wrapper.querySelector('.metric-value').textContent = formatControl(metric, control);
    markCustomSetup();
    queueRecalculation();
  }

  function updateMetricPriority(select) {
    const wrapper = select.closest('[data-metric]');
    if (!wrapper) {
      return;
    }

    const control = state.controls[wrapper.dataset.metric];
    control.level = Number(select.value);
    select.dataset.level = control.level;

    if (control.hard && control.level === 0) {
      control.level = 1;
      select.value = '1';
      select.dataset.level = '1';
    }

    markCustomSetup();
    renderAdvancedSummary();
    queueRecalculation();
  }

  function toggleMetricDealbreaker(button) {
    const wrapper = button.closest('[data-metric]');
    if (!wrapper) {
      return;
    }

    const control = state.controls[wrapper.dataset.metric];
    control.hard = !control.hard;

    if (control.hard && control.level === 0) {
      control.level = 1;
    }

    markCustomSetup();
    renderAllControls();
    queueRecalculation();
  }

  // Event wiring and application startup

  function installPreferenceEvents() {
    elements.sidebar.addEventListener('input', (event) => {
      if (event.target.matches('input[type="range"][data-control-role]')) {
        updateMetricFromRange(event.target);
      }
    });

    elements.sidebar.addEventListener('change', (event) => {
      if (event.target.matches('select[data-control-role="level"]')) {
        updateMetricPriority(event.target);
      }
    });

    elements.sidebar.addEventListener('click', (event) => {
      const mustButton = event.target.closest('[data-control-action="must"]');
      if (mustButton) {
        toggleMetricDealbreaker(mustButton);
      }
    });

    elements.advancedControls.addEventListener('toggle', (event) => {
      const details = event.target.closest('.control-group');
      if (!details) {
        return;
      }

      if (details.open) {
        state.openGroups.add(details.dataset.group);
      } else {
        state.openGroups.delete(details.dataset.group);
      }

      updateCollapseButton();
    }, true);
  }

  function installEvents() {
    installPreferenceEvents();

    $('#presetStrip').addEventListener('click', (event) => {
      const button = event.target.closest('[data-preset]');
      if (button) {
        applyPreset(button.dataset.preset);
      }
    });

    $('#resetButton').addEventListener('click', () => applyPreset('Balanced'));

    elements.advancedToggle.addEventListener('click', () => {
      setAdvancedOpen(!state.advancedOpen);
    });

    $('#collapseButton').addEventListener('click', () => {
      const advancedGroups = GROUPS.filter((group) => METRICS.some(
        (metric) => metric.group === group && !essentialMetricIds.has(metric.id)
      ));
      const allOpen = advancedGroups.every((group) => state.openGroups.has(group));

      state.openGroups.clear();
      if (!allOpen) {
        advancedGroups.forEach((group) => state.openGroups.add(group));
      }

      renderAdvancedControls();
    });

    $('#gameShortcutButton').addEventListener('click', startGame);
    $('#gameButton').addEventListener('click', startGame);

    $('#nearMissButton').addEventListener('click', () => {
      state.showNearMisses = !state.showNearMisses;
      state.visibleCount = 12;
      recalculate();
    });

    $('#sortSelect').addEventListener('change', (event) => {
      state.sort = event.target.value;
      state.ranked = sortRows(state.ranked, state.sort);
      renderResults();
      renderMap();
      updateURL();
    });

    $('#showMoreButton').addEventListener('click', () => {
      state.visibleCount += 12;
      renderSummary();
      renderResults();
    });

    elements.results.addEventListener('click', (event) => {
      const card = event.target.closest('[data-id]');
      if (!card) {
        return;
      }

      const action = event.target.closest('[data-action]')?.dataset.action || 'detail';
      if (action === 'pin') {
        togglePin(card.dataset.id);
      } else {
        showDetail(card.dataset.id);
      }
    });

    elements.mapPoints.addEventListener('click', (event) => {
      const point = event.target.closest('[data-id]');
      if (point) {
        showDetail(point.dataset.id);
      }
    });

    elements.mapPoints.addEventListener('pointermove', (event) => {
      const point = event.target.closest('[data-id]');
      if (!point) {
        elements.mapTooltip.hidden = true;
        return;
      }

      const place = placesById.get(point.dataset.id);
      const evaluation = state.evaluations.get(place.id);

      elements.mapTooltip.innerHTML = `
        <strong>
          ${escapeHTML(place.display_name)}
          <span class="tooltip-score">${Math.round(evaluation.score)}</span>
        </strong>
        <span>
          ${format(place.median_home_value, 'money')} home ·
          ${place.global_airport_code} ${format(place.global_airport_minutes, 'minutes')} ·
          ${format(place.summer_dewpoint_f, 'temp')} dew point
        </span>
      `;
      elements.mapTooltip.hidden = false;

      const mapRect = $('#mapWrap').getBoundingClientRect();
      elements.mapTooltip.style.left = `${Math.min(mapRect.width - 232, event.clientX - mapRect.left + 12)}px`;
      elements.mapTooltip.style.top = `${Math.max(8, event.clientY - mapRect.top - 60)}px`;
    });

    elements.mapPoints.addEventListener('pointerleave', () => {
      elements.mapTooltip.hidden = true;
    });

    $$('.view-tab').forEach((button) => {
      button.addEventListener('click', () => {
        $$('.view-tab').forEach((tab) => tab.classList.remove('active'));
        button.classList.add('active');
        state.mapMode = button.dataset.mapMode;
        renderMap();
        updateURL();
      });
    });

    $('#placeSearch').addEventListener('input', (event) => handleSearch(event.target.value));

    $('#searchSuggestions').addEventListener('click', (event) => {
      const button = event.target.closest('[data-search-id]');
      if (!button) {
        return;
      }

      $('#searchSuggestions').hidden = true;
      $('#placeSearch').value = '';
      showDetail(button.dataset.searchId);
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.search-box')) {
        $('#searchSuggestions').hidden = true;
      }
    });

    $('#gameContent').addEventListener('click', (event) => {
      const choice = event.target.closest('[data-game-choice]')?.dataset.gameChoice;
      if (choice) {
        recordGameChoice(choice);
      }
      if (event.target.closest('[data-game-finish]')) {
        renderGameResult();
      }
      if (event.target.closest('[data-game-apply]')) {
        applyGame();
      }
      if (event.target.closest('[data-game-restart]')) {
        startGame();
      }
    });

    $('#compareButton').addEventListener('click', showCompare);
    $('#openCompareButton').addEventListener('click', showCompare);

    $('#compareChips').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-pin]');
      if (button) {
        togglePin(button.dataset.removePin);
      }
    });

    $('#dataButton').addEventListener('click', () => $('#dataDialog').showModal());
    $('#downloadCsvButton').addEventListener('click', downloadCsv);
    $('#downloadJsonButton').addEventListener('click', () => {
      downloadText(
        'placecraft-localities.json',
        JSON.stringify(DATA),
        'application/json;charset=utf-8'
      );
    });
    $('#shareButton').addEventListener('click', () => copyText(location.href, 'Share link copied.'));

    document.addEventListener('click', (event) => {
      const closeButton = event.target.closest('[data-close]');
      if (closeButton) {
        document.getElementById(closeButton.dataset.close).close();
      }

      const pinButton = event.target.closest('[data-detail-pin]');
      if (pinButton) {
        togglePin(pinButton.dataset.detailPin);
      }

      const copyButton = event.target.closest('[data-copy-place]');
      if (copyButton) {
        copyText(
          placeSummary(placesById.get(copyButton.dataset.copyPlace)),
          'Place summary copied.'
        );
      }
    });

    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        const rect = dialog.getBoundingClientRect();
        const clickedBackdrop =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;

        if (clickedBackdrop) {
          dialog.close();
        }
      });
    });

    window.addEventListener('hashchange', () => {
      if (!loadURLState()) {
        return;
      }

      renderPresets();
      renderAllControls();
      renderCompareTray();
      $('#sortSelect').value = state.sort;
      $$('.view-tab').forEach((button) => {
        button.classList.toggle('active', button.dataset.mapMode === state.mapMode);
      });
      recalculate();
    });
  }

  function initialize() {
    loadURLState();
    renderPresets();
    renderAllControls();
    renderCompareTray();
    populateDataDialog();
    setAdvancedOpen(false);

    $('#sortSelect').value = state.sort;
    $$('.view-tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.mapMode === state.mapMode);
    });

    installEvents();
    recalculate();
  }

  initialize();
})();
