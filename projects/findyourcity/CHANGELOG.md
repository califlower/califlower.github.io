# Changelog

## 2026-07-25 — Personal-site redesign

- Rebuilt the project as a natural extension of `calingilan.com`: white page, system typography, restrained green accent, and the same simple content width and link treatment.
- Replaced the dashboard shell with a small project-page narrative, a playful city-choice entry point, and a calm ranked list.
- Made the pairwise guessing game the primary interaction and reduced each choice to six understandable clues.
- Limited the default model to the six visible preferences. All 38 advanced details now begin neutral instead of silently affecting results.
- Moved presets, advanced controls, result tools, and the map behind progressive disclosure.
- Reduced the initial result set from twelve cards to eight editorial-style rows.
- Removed the service-worker registration so the project remains isolated under `/projects/findyourcity/`.

## 2026-07-24 — Published airport capability tiers

- Replaced hardcoded major and global airport sets with a checked-in FAA/BTS capability snapshot.
- Defined practical airports from FAA commercial-service status, major hubs from FAA large/medium classes, and global gateways from BTS nonstop international passenger rankings.
- Added uniform metro-collapse logic for small nonhub airports near a stronger passenger hub.
- Corrected Hoboken from Teterboro to EWR, Seattle from Boeing Field to SEA, Portland's major hub to PDX, and San Diego's major hub to SAN.
- Added airport class, gateway rank, and international passenger context to place details.

## 2026-07-19 — Urban context, momentum, and family renewal

- Replaced the old density preference with a saturated urban-intensity model so very dense places are not penalized for exceeding an arbitrary ceiling.
- Added separate urban-fabric, metro-scale, centrality, context-label, and city-pulse fields to reduce dense-suburb false positives.
- Added observed commute mode and duration fields plus a clearly labeled traffic-friction proxy.
- Replaced the misleading crime-pressure label with a social-stress proxy that does not include density.
- Added non-overlapping 2015–2019 to 2020–2024 ACS change measures.
- Added a range-based Change trajectory preference and map mode.
- Added Young-family renewal as a transparent composite rather than claiming municipal birth-rate precision.
- Added the Growing, not greenfield preset, trend-aware pairwise choices, comparison rows, and result sorting.
- Removed the user-specific preset and its city-ordering test.
- Added neutrality checks that reject hidden locality-specific calibration in ranking configuration.
