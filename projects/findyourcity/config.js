(() => {
  'use strict';

  const WEIGHTS = [0, 2, 5, 9];
  const PRIORITY_LABELS = ['Ignore', 'Nice', 'Important', 'Critical'];

  const ESSENTIAL_METRIC_IDS = [
    'home_max',
    'global_airport_max',
    'urbanity_min',
    'jan_min',
    'dew_max',
    'population_min'
  ];

  const GROUPS = [
    'Basics',
    'Cost & economy',
    'Urban form',
    'Momentum & families',
    'Getting around',
    'Weather',
    'Water & environment',
    'Risk proxies',
    'Demographics'
  ];

  const METRICS = [
    {
      id: 'population_min', field: 'population', group: 'Basics',
      label: 'Minimum population', kind: 'min', min: 10_000, max: 1_000_000,
      step: 10_000, value: 30_000, level: 1, hard: true, format: 'compact',
      hint: ['small town', 'large city']
    },
    {
      id: 'population_max', field: 'population', group: 'Basics',
      label: 'Maximum population', kind: 'max', min: 25_000, max: 9_000_000,
      step: 25_000, value: 3_000_000, level: 0, hard: false, format: 'compact',
      hint: ['smaller', 'megacity']
    },

    {
      id: 'home_max', field: 'median_home_value', group: 'Cost & economy',
      label: 'Median home value', kind: 'max', min: 100_000, max: 1_800_000,
      step: 25_000, value: 700_000, level: 3, hard: false, format: 'money',
      hint: ['more affordable', 'more expensive']
    },
    {
      id: 'rent_max', field: 'median_rent', group: 'Cost & economy',
      label: 'Median rent', kind: 'max', min: 600, max: 4_500,
      step: 50, value: 2_400, level: 1, hard: false, format: 'money',
      hint: ['lower', 'higher']
    },
    {
      id: 'income_min', field: 'median_income', group: 'Cost & economy',
      label: 'Median household income', kind: 'min', min: 30_000, max: 180_000,
      step: 2_500, value: 65_000, level: 1, hard: false, format: 'money',
      hint: ['lower', 'higher']
    },
    {
      id: 'unemployment_max', field: 'unemployment_pct', group: 'Cost & economy',
      label: 'Unemployment', kind: 'max', min: 1, max: 18,
      step: 0.5, value: 7, level: 1, hard: false, format: 'percent',
      hint: ['lower', 'higher']
    },
    {
      id: 'housing_strain_max', field: 'housing_instability_proxy', group: 'Cost & economy',
      label: 'Housing instability proxy', kind: 'max', min: 10, max: 95,
      step: 1, value: 70, level: 1, hard: false, format: 'score',
      hint: ['less pressure', 'more pressure']
    },

    {
      id: 'urbanity_min', field: 'urbanity_score', group: 'Urban form',
      label: 'Urban intensity', kind: 'min', min: 0, max: 100,
      step: 1, value: 42, level: 2, hard: false, format: 'score',
      hint: ['small-town feel', 'major-city feel']
    },
    {
      id: 'urban_form_min', field: 'urban_form_score', group: 'Urban form',
      label: 'Urban fabric', kind: 'min', min: 0, max: 100,
      step: 1, value: 42, level: 1, hard: false, format: 'score',
      hint: ['car-oriented', 'fine-grained urban']
    },
    {
      id: 'density_min', field: 'density', group: 'Urban form',
      label: 'Municipal density', kind: 'min', min: 100, max: 60_000,
      step: 250, value: 1_000, level: 0, hard: false, format: 'density',
      hint: ['spread out', 'dense']
    },
    {
      id: 'metro_scale_min', field: 'metro_scale_score', group: 'Urban form',
      label: 'Surrounding metro scale', kind: 'min', min: 0, max: 100,
      step: 1, value: 38, level: 1, hard: false, format: 'score',
      hint: ['isolated', 'large region']
    },
    {
      id: 'prewar_min', field: 'prewar_housing_pct', group: 'Urban form',
      label: 'Pre-1940 housing share', kind: 'min', min: 0, max: 80,
      step: 1, value: 15, level: 1, hard: false, format: 'percent',
      hint: ['newer fabric', 'older fabric']
    },
    {
      id: 'young_adult_min', field: 'young_adult_25_39_pct', group: 'Urban form',
      label: 'Age 25–39 share', kind: 'min', min: 8, max: 50,
      step: 1, value: 18, level: 1, hard: false, format: 'percent',
      hint: ['lower', 'younger adult concentration']
    },

    {
      id: 'city_pulse_min', field: 'city_pulse_score', group: 'Urban form',
      label: 'City pulse proxy', kind: 'min', min: 0, max: 100,
      step: 1, value: 50, level: 1, hard: false, format: 'score',
      hint: ['quieter', 'more social energy']
    },

    {
      id: 'momentum_range', field: 'momentum_score', group: 'Momentum & families',
      label: 'Change trajectory', kind: 'range', min: 0, max: 100,
      step: 1, low: 25, high: 90, level: 0, hard: false, format: 'momentum',
      hint: ['contracting / settled', 'rapidly changing']
    },
    {
      id: 'family_renewal_min', field: 'family_renewal_score', group: 'Momentum & families',
      label: 'Young-family renewal', kind: 'min', min: 0, max: 100,
      step: 1, value: 42, level: 0, hard: false, format: 'renewal',
      hint: ['aging population', 'more children and young families']
    },

    {
      id: 'walk_min', field: 'walkability_proxy', group: 'Getting around',
      label: 'Walkability proxy', kind: 'min', min: 0, max: 100,
      step: 1, value: 42, level: 2, hard: false, format: 'score',
      hint: ['car-oriented', 'walkable']
    },
    {
      id: 'carfree_min', field: 'carfree_household_pct', group: 'Getting around',
      label: 'Car-free households', kind: 'min', min: 0, max: 70,
      step: 1, value: 8, level: 1, hard: false, format: 'percent',
      hint: ['car-dependent', 'car-optional']
    },
    {
      id: 'transit_min', field: 'transit_pct', group: 'Getting around',
      label: 'Transit commute share', kind: 'min', min: 0, max: 45,
      step: 1, value: 5, level: 0, hard: false, format: 'percent',
      hint: ['little transit', 'transit-heavy']
    },
    {
      id: 'drive_alone_max', field: 'drive_alone_pct', group: 'Getting around',
      label: 'Drive-alone share', kind: 'max', min: 5, max: 95,
      step: 1, value: 68, level: 0, hard: false, format: 'percent',
      hint: ['less car-dependent', 'more car-dependent']
    },
    {
      id: 'commute_max', field: 'avg_commute_minutes', group: 'Getting around',
      label: 'Average commute', kind: 'max', min: 10, max: 65,
      step: 1, value: 35, level: 1, hard: false, format: 'minutes',
      hint: ['shorter', 'longer']
    },
    {
      id: 'long_commute_max', field: 'long_commute_45_pct', group: 'Getting around',
      label: 'Commutes over 45 minutes', kind: 'max', min: 0, max: 60,
      step: 1, value: 25, level: 0, hard: false, format: 'percent',
      hint: ['fewer', 'more']
    },
    {
      id: 'traffic_max', field: 'traffic_friction_proxy', group: 'Getting around',
      label: 'Traffic friction proxy', kind: 'max', min: 5, max: 95,
      step: 1, value: 68, level: 0, hard: false, format: 'score',
      hint: ['easier driving', 'more friction']
    },
    {
      id: 'airport_max', field: 'airport_minutes', group: 'Getting around',
      label: 'Scheduled-service airport', kind: 'max', min: 10, max: 240,
      step: 5, value: 45, level: 1, hard: false, format: 'minutes',
      hint: ['nearby', 'farther away']
    },
    {
      id: 'major_airport_max', field: 'major_airport_minutes', group: 'Getting around',
      label: 'Major airport', kind: 'max', min: 15, max: 300,
      step: 5, value: 90, level: 2, hard: false, format: 'minutes',
      hint: ['nearby', 'farther away']
    },
    {
      id: 'global_airport_max', field: 'global_airport_minutes', group: 'Getting around',
      label: 'Global gateway airport', kind: 'max', min: 15, max: 420,
      step: 5, value: 120, level: 3, hard: false, format: 'minutes',
      hint: ['nearby', 'farther away']
    },

    {
      id: 'jan_min', field: 'jan_high_f', group: 'Weather',
      label: 'January average high', kind: 'min', min: 5, max: 75,
      step: 1, value: 36, level: 2, hard: false, format: 'temp',
      hint: ['colder', 'milder']
    },
    {
      id: 'jul_max', field: 'jul_high_f', group: 'Weather',
      label: 'July average high', kind: 'max', min: 65, max: 110,
      step: 1, value: 93, level: 2, hard: false, format: 'temp',
      hint: ['cooler', 'hotter']
    },
    {
      id: 'dew_max', field: 'summer_dewpoint_f', group: 'Weather',
      label: 'Summer dew point', kind: 'max', min: 38, max: 76,
      step: 1, value: 66, level: 3, hard: false, format: 'temp',
      hint: ['dry', 'oppressive']
    },
    {
      id: 'snow_max', field: 'annual_snow_in', group: 'Weather',
      label: 'Annual snowfall', kind: 'max', min: 0, max: 140,
      step: 2, value: 45, level: 1, hard: false, format: 'inches',
      hint: ['little', 'snowy']
    },
    {
      id: 'comfort_min', field: 'comfort_days', group: 'Weather',
      label: 'Comfortable-day estimate', kind: 'min', min: 40, max: 250,
      step: 5, value: 125, level: 1, hard: false, format: 'days',
      hint: ['fewer', 'more']
    },

    {
      id: 'ocean_max', field: 'ocean_miles', group: 'Water & environment',
      label: 'Distance to ocean', kind: 'max', min: 0, max: 1_000,
      step: 10, value: 180, level: 1, hard: false, format: 'miles',
      hint: ['coastal', 'inland']
    },
    {
      id: 'shore_max', field: 'major_shore_miles', group: 'Water & environment',
      label: 'Distance to major shoreline', kind: 'max', min: 0, max: 500,
      step: 5, value: 60, level: 1, hard: false, format: 'miles',
      hint: ['near water', 'farther away']
    },
    {
      id: 'air_quality_max', field: 'air_quality_pressure_proxy', group: 'Water & environment',
      label: 'Air-quality pressure proxy', kind: 'max', min: 5, max: 95,
      step: 1, value: 65, level: 1, hard: false, format: 'score',
      hint: ['lower pressure', 'higher pressure']
    },

    {
      id: 'crime_max', field: 'social_stress_proxy', group: 'Risk proxies',
      label: 'Social stress proxy', kind: 'max', min: 5, max: 95,
      step: 1, value: 68, level: 2, hard: false, format: 'score',
      hint: ['lower', 'higher']
    },
    {
      id: 'climate_risk_max', field: 'climate_risk_proxy', group: 'Risk proxies',
      label: 'Climate risk proxy', kind: 'max', min: 5, max: 95,
      step: 1, value: 62, level: 2, hard: false, format: 'score',
      hint: ['lower', 'higher']
    },
    {
      id: 'flood_max', field: 'flood_risk_proxy', group: 'Risk proxies',
      label: 'Flood exposure proxy', kind: 'max', min: 0, max: 100,
      step: 1, value: 65, level: 1, hard: false, format: 'score',
      hint: ['lower', 'higher']
    },
    {
      id: 'wildfire_max', field: 'wildfire_risk_proxy', group: 'Risk proxies',
      label: 'Wildfire exposure proxy', kind: 'max', min: 0, max: 100,
      step: 1, value: 65, level: 1, hard: false, format: 'score',
      hint: ['lower', 'higher']
    },

    {
      id: 'age_range', field: 'median_age', group: 'Demographics',
      label: 'Median age', kind: 'range', min: 20, max: 65,
      step: 1, low: 29, high: 46, level: 1, hard: false, format: 'years',
      hint: ['younger', 'older']
    },
    {
      id: 'education_min', field: 'bachelors_plus_pct', group: 'Demographics',
      label: "Bachelor's degree or higher", kind: 'min', min: 5, max: 90,
      step: 1, value: 30, level: 1, hard: false, format: 'percent',
      hint: ['lower', 'higher']
    },
    {
      id: 'diversity_min', field: 'diversity_index', group: 'Demographics',
      label: 'Diversity index', kind: 'min', min: 0, max: 80,
      step: 1, value: 35, level: 1, hard: false, format: 'score',
      hint: ['less mixed', 'more mixed']
    },
    {
      id: 'asian_min', field: 'asian_pct', group: 'Demographics',
      label: 'Asian population share', kind: 'min', min: 0, max: 55,
      step: 1, value: 5, level: 0, hard: false, format: 'percent',
      hint: ['lower', 'higher']
    },
    {
      id: 'black_min', field: 'black_pct', group: 'Demographics',
      label: 'Black population share', kind: 'min', min: 0, max: 75,
      step: 1, value: 8, level: 0, hard: false, format: 'percent',
      hint: ['lower', 'higher']
    },
    {
      id: 'hispanic_min', field: 'hispanic_pct', group: 'Demographics',
      label: 'Hispanic population share', kind: 'min', min: 0, max: 80,
      step: 1, value: 10, level: 0, hard: false, format: 'percent',
      hint: ['lower', 'higher']
    }
  ];

  const PRESETS = {
    Balanced: {},
    'Coastal, but sane': {
      home_max: { value: 750_000, level: 3 },
      ocean_max: { value: 45, level: 3, hard: true },
      shore_max: { value: 20, level: 2 },
      flood_max: { value: 58, level: 2 },
      climate_risk_max: { value: 62, level: 2 },
      global_airport_max: { value: 150, level: 2 },
      urbanity_min: { value: 35, level: 2 }
    },
    'Mild + connected': {
      jan_min: { value: 45, level: 3, hard: true },
      jul_max: { value: 94, level: 2 },
      dew_max: { value: 67, level: 2 },
      global_airport_max: { value: 100, level: 3, hard: true },
      major_airport_max: { value: 65, level: 2 },
      home_max: { value: 900_000, level: 2 }
    },
    'Walkable under $600k': {
      home_max: { value: 600_000, level: 3, hard: true },
      walk_min: { value: 58, level: 3, hard: true },
      urban_form_min: { value: 52, level: 2 },
      population_min: { value: 50_000, level: 1 },
      global_airport_max: { value: 180, level: 2 },
      crime_max: { value: 72, level: 1 }
    },
    'Dry, not sweaty': {
      dew_max: { value: 58, level: 3, hard: true },
      jul_max: { value: 102, level: 1 },
      wildfire_max: { value: 68, level: 2 },
      air_quality_max: { value: 68, level: 2 },
      jan_min: { value: 34, level: 1 },
      home_max: { value: 750_000, level: 2 }
    },
    'Big-city energy': {
      urbanity_min: { value: 70, level: 3, hard: true },
      urban_form_min: { value: 62, level: 3 },
      metro_scale_min: { value: 58, level: 2 },
      city_pulse_min: { value: 75, level: 3 },
      momentum_range: { low: 28, high: 95, level: 1 },
      walk_min: { value: 58, level: 3 },
      carfree_min: { value: 12, level: 2 },
      global_airport_max: { value: 75, level: 3 },
      diversity_min: { value: 45, level: 2 },
      home_max: { value: 1_200_000, level: 1 }
    },
    'Growing, not greenfield': {
      momentum_range: { low: 58, high: 100, level: 3 },
      family_renewal_min: { value: 45, level: 2 },
      urbanity_min: { value: 48, level: 3 },
      urban_form_min: { value: 45, level: 2 },
      city_pulse_min: { value: 58, level: 2 },
      housing_strain_max: { value: 78, level: 1 },
      global_airport_max: { value: 150, level: 2 }
    },
    'Quiet near water': {
      population_min: { value: 10_000, level: 0, hard: false },
      population_max: { value: 150_000, level: 3, hard: true },
      shore_max: { value: 25, level: 3, hard: true },
      crime_max: { value: 55, level: 3 },
      urbanity_min: { value: 20, level: 0 },
      home_max: { value: 550_000, level: 2 }
    }
  };

  const GAME_METRIC_IDS = [
    'home_max',
    'global_airport_max',
    'urbanity_min',
    'urban_form_min',
    'city_pulse_min',
    'momentum_range',
    'family_renewal_min',
    'walk_min',
    'prewar_min',
    'education_min',
    'jan_min',
    'jul_max',
    'dew_max',
    'ocean_max',
    'crime_max',
    'climate_risk_max'
  ];

  const COMPARE_FIELDS = [
    { label: 'Preference fit', field: 'score', format: 'score', direction: 'high' },
    { label: 'Urban intensity', field: 'urbanity_score', format: 'score', direction: 'high' },
    { label: 'Urban fabric', field: 'urban_form_score', format: 'score', direction: 'high' },
    { label: 'City pulse', field: 'city_pulse_score', format: 'score', direction: 'high' },
    { label: 'Change trajectory', field: 'momentum_score', format: 'momentum', direction: 'high' },
    { label: 'Population change (5 yr)', field: 'population_growth_5yr_pct', format: 'signedPercent', direction: 'high' },
    { label: 'Housing change (5 yr)', field: 'housing_growth_5yr_pct', format: 'signedPercent', direction: 'high' },
    { label: 'Young-family renewal', field: 'family_renewal_score', format: 'renewal', direction: 'high' },
    { label: 'Households with children', field: 'households_with_children_pct', format: 'percent', direction: 'high' },
    { label: 'Under age 5', field: 'under5_pct', format: 'percent', direction: 'high' },
    { label: 'Age 65+', field: 'age65plus_pct', format: 'percent', direction: 'low' },
    { label: 'Population', field: 'population', format: 'compact', direction: 'high' },
    { label: 'Population within 30 mi', field: 'nearby_population_30mi', format: 'compact', direction: 'high' },
    { label: 'Median home value', field: 'median_home_value', format: 'money', direction: 'low' },
    { label: 'Median rent', field: 'median_rent', format: 'money', direction: 'low' },
    { label: 'Walkability proxy', field: 'walkability_proxy', format: 'score', direction: 'high' },
    { label: 'Car-free households', field: 'carfree_household_pct', format: 'percent', direction: 'high' },
    { label: 'Average commute', field: 'avg_commute_minutes', format: 'minutes', direction: 'low' },
    { label: 'Traffic friction proxy', field: 'traffic_friction_proxy', format: 'score', direction: 'low' },
    { label: 'Pre-1940 housing', field: 'prewar_housing_pct', format: 'percent', direction: 'high' },
    { label: "Bachelor's degree+", field: 'bachelors_plus_pct', format: 'percent', direction: 'high' },
    { label: 'Global airport', field: 'global_airport_minutes', format: 'minutes', direction: 'low' },
    { label: 'January high', field: 'jan_high_f', format: 'temp', direction: 'high' },
    { label: 'Summer dew point', field: 'summer_dewpoint_f', format: 'temp', direction: 'low' },
    { label: 'Social stress proxy', field: 'social_stress_proxy', format: 'score', direction: 'low' },
    { label: 'Climate risk proxy', field: 'climate_risk_proxy', format: 'score', direction: 'low' }
  ];

  window.PlacecraftConfig = {
    WEIGHTS,
    PRIORITY_LABELS,
    ESSENTIAL_METRIC_IDS,
    GROUPS,
    METRICS,
    PRESETS,
    GAME_METRIC_IDS,
    COMPARE_FIELDS
  };
})();
