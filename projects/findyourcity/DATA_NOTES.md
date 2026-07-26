# Find Your City data notes

Find Your City is a national exploratory dataset for asking, “Which places survive my constraints, and what tradeoffs am I making?” It is not a safety, insurance, lending, legal, emergency-planning, or property-level due-diligence product.

## Coverage

The shipped build contains **4,197 U.S. Census places** in the 50 states and District of Columbia with a 2020–2024 ACS five-year population estimate of at least **10,000**. “Place” includes incorporated places and census-designated places. It does not represent every neighborhood, township, unincorporated community, or metro area.

The locality ID is the seven-character Census place GEOID. Census place boundaries often do not match how residents informally define a city or metro area.

## Observed source fields

### 2020–2024 American Community Survey five-year detailed tables

- B01003: total population
- B01002: median age
- B01001: age distribution, including under 5, under 18, age 25–39, and age 65+
- B19013: median household income
- B25077: median owner-occupied home value
- B25064: median gross rent
- B25003: occupied and owner-occupied housing units
- B25001: total housing units
- B11005: households with children under 18
- B25034: year housing was built, including the pre-1940 share
- B08201: household vehicle availability
- B08301: commute modes, drive-alone share, and work from home
- B08303: travel-time-to-work distribution
- B15003: educational attainment
- B23025: civilian labor force and unemployment
- B02001: selected race counts
- B03003: Hispanic or Latino population
- B17001: poverty universe and count

The same population, age, housing-unit, and household-with-children measures are also read from the **2015–2019 ACS five-year release**. Find Your City compares that non-overlapping period with 2020–2024 to describe five-year change. Boundary changes, estimate uncertainty, and unusual 2020-era migration can still distort individual places.

ACS values are estimates. Margins of error are not shipped in this compact build, so smaller places should not be treated as precisely ranked when values are close.

### 2024 Census Gazetteer place files

Used for place names, GEOIDs, internal representative coordinates, land area, and water area.

### OurAirports

Used for airport coordinates, names, and IATA codes. OurAirports does **not** decide whether an airport is practical, major, or globally connected.

### FAA commercial-service and hub classifications

The airport capability snapshot uses the FAA's **Preliminary CY2025 Enplanements at All Commercial Service Airports (by Rank)**, published July 8, 2026. FAA categories determine whether an airport has commercial service and whether it is a large, medium, small, or nonhub primary airport.

### BTS international gateway ranking

The global tier uses the Bureau of Transportation Statistics **Top 20 U.S. Gateways for Nonstop International Air Travel** table. The checked-in snapshot uses 2023 nonstop international passenger totals. This makes the tier reproducible and independent of airport branding.

## Airport tiers

Airport names are ignored. The word “International” does not qualify an airport.

1. **Practical airport:** nearest FAA commercial-service airport. A primary nonhub inside 45 estimated driving minutes of a large, medium, or small hub collapses to that hub; this prevents nearby executive/charter-oriented fields from masquerading as the useful passenger airport for a metro.
2. **Major hub:** nearest FAA large or medium hub. This is a published FAA class, not a product-maintained airport list.
3. **Global gateway:** nearest airport in the BTS top-20 ranking by nonstop international passengers.

The 2023 BTS gateway snapshot is:

`JFK LAX MIA EWR SFO ORD ATL IAH DFW IAD BOS FLL MCO SEA CLT DEN PHL LAS HNL DTW`

Examples after reclassification:

- Hoboken: **EWR** practical, major, and global.
- Seattle: **SEA**, rather than Boeing Field, is the practical airport.
- Portland, Oregon: **PDX** is practical and major; **SEA** is the nearest BTS global gateway.
- San Diego: **SAN** is practical and major; **LAX** is the nearest BTS global gateway.
- Richmond: **RIC** is practical and, under the current FAA snapshot, a medium hub; **IAD** is the nearest BTS global gateway.

Airport distances are great-circle distances. “Drive minutes” are transparent estimates based on distance, a road-distance multiplier, an assumed average speed, and an eight-minute access penalty. They are not routing-engine results and do not account for traffic, ferries, mountains, or border crossings.

## Modelled fields

### Weather

January high, July high, summer dew point, precipitation, snowfall, humid days, hot days, and comfortable days are broad regional estimates generated from latitude, longitude, state/region adjustments, and simple climatic curves. They are useful for moving a slider and finding broad candidates. They are not NOAA station normals.

A production data refresh should replace these with interpolated 1991–2020 NOAA climate normals and preserve the station/interpolation provenance for every locality.

### Urban form, context, and walkability

Municipal density remains available as a descriptive field, but it is no longer treated as an ideal range with an arbitrary upper ceiling. Very high density is allowed to saturate rather than becoming a penalty.

The app now separates three concepts:

- **Urban fabric:** a 0–100 blend of saturated municipal density, car-free households, transit/walking/cycling commute share, pre-1940 housing, and surrounding scale.
- **Metro scale:** a log-scaled estimate based on the population of shipped Census places whose representative points lie within 30 miles. It is not an official metropolitan population.
- **Urban intensity:** a blend of urban fabric, metro scale, and proximity to a selected regional core.

A non-maximum-suppression pass selects one strong regional core per nearby cluster. Each place is then described as a metro core, inner urban municipality, urban center, metro suburb, metro satellite, independent city, or small city/town. The classification is explanatory and is not an official Census or OMB designation.

The revised walkability proxy blends saturated density, car-free households, commute mode, and prewar housing. It is not Walk Score and does not measure sidewalks, destinations, topography, or neighborhood-level variation.

### City pulse proxy

The **city pulse proxy** is intended to reduce false positives where a municipality is technically dense or close to a major city but lacks the same concentration of younger adults, educated residents, older urban fabric, and demographic mixture. It blends national percentiles for the age 25–39 share, bachelor's-degree share, pre-1940 housing, the urban-form score, and the diversity index.

It is not a direct measure of nightlife, restaurants, arts, venues, foot traffic, or social compatibility. Those would require separate amenity and activity datasets. The proxy is exposed independently so users can ignore it rather than having a hidden cultural judgment embedded inside the main urban-intensity score.

### Change trajectory and young-family renewal

**Change trajectory** describes the *pace and direction of local change*, not whether change is automatically good. It combines observed five-year changes in population, housing units, adults age 25–39, and households with children. Housing construction receives meaningful weight so a place can register as changing even when its municipal population is temporarily flat. The resulting labels are: Contracting, Settled, Evolving, Fast-changing, and Surging.

The control is a preferred range rather than a simple minimum. Someone can prefer a settled place, a rapidly changing place, or a broad middle. This prevents the product from treating Austin-style expansion as universally superior to Cambridge-style stability.

**Young-family renewal** is deliberately not labeled a birth rate. Uniform, current municipal birth counts are not available for every Census place in this build. Instead, the score blends the under-5 share, under-18 share, households with children, five-year change in young children and family households, and an inverse adjustment for the age-65+ share. The labels are Aging, Low renewal, Mixed, Strong renewal, and Very strong renewal.

This helps distinguish a place with many college students from one where children and younger families are actually replenishing the population. It remains a screening composite, not a fertility rate or a forecast of school enrollment.

### Commute and traffic fields

Observed ACS fields include estimated average commute time, shares commuting 45+ and 60+ minutes, drive-alone share, transit share, and car-free households. Average commute time is reconstructed from published commute-time bins using bin midpoints.

The **traffic friction proxy** combines national percentiles for commute time, long-commute share, and drive-alone share, with a modest surrounding-metro adjustment. It is not probe-speed congestion data and should not be read as a roadway travel-time index.

### Social stress proxy

The previous build called a socioeconomic model “crime pressure” and included density, which incorrectly penalized urban places. The revised field is explicitly named **social stress proxy** and blends national percentiles for poverty, unemployment, and rent burden. Density is not included.

It remains **not crime data** and should never be interpreted as a violent- or property-crime rate. The legacy exported field name is retained as an alias for compatibility with older saved links. A production crime field should ingest agency-level FBI UCR/NIBRS data, publish reporting coverage, and explain how police jurisdictions were mapped to places.

### Housing-instability proxy

A percentile blend of rent-to-income burden, poverty, home-value-to-income ratio, and unemployment. It is not a direct homelessness count.

A production homelessness field should remain explicitly regional because HUD Point-in-Time counts are generally published for Continuums of Care rather than clean municipal boundaries.

### Environmental and hazard proxies

- Flood: shoreline proximity, ocean proximity, and local water-area share
- Hurricane: ocean proximity with a southeastern coastal adjustment
- Wildfire: western-region indicator, dryness, and summer heat
- Heat: estimated frequency of 90°F days
- Climate: weighted blend of flood, wildfire, heat, hurricane, and humidity
- Air-quality pressure: wildfire, heat, and the traffic-friction proxy

These are screening proxies, not FEMA, EPA, First Street, insurer, or parcel-level risk scores.

### Water distance

Approximate nearest-point distance to low-resolution coastline geometry bundled with Basemap. “Major shoreline” includes large inland coastlines represented by that geometry, but it is not a complete lake-and-river network. Small lakes, reservoirs, and river access are not reliably captured.

## Scoring

A soft preference converts each metric to a utility from 0 to 1. Importance levels map to weights of 0, 2, 5, and 9. The displayed score is the weighted mean utility multiplied by 100.

A dealbreaker removes a place when it violates the selected threshold. “Near misses” include places that fail exactly one dealbreaker and apply an additional penalty based on the size of that miss.

The pairwise game compares the two places across selected dimensions. A choice raises inferred importance for dimensions where the winner better matches the current preference curve and gently relaxes thresholds that the selected place violates. It is intentionally legible rather than statistically sophisticated.

## Rebuilding

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/download_sources.py
python scripts/build_data.py
python tests/test_dataset.py
```

To keep source snapshots elsewhere:

```bash
FIND_YOUR_CITY_RAW_DIR=/path/to/raw python scripts/build_data.py
```

The generated browser bundle is `data/localities.js`; JSON, gzipped JSON, and CSV versions are also emitted.
