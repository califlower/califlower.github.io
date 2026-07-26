# Find Your City

A static, client-side city explorer hosted at `/projects/findyourcity/`.

## Architecture

- `index.html`, `styles.css`: application shell and presentation
- `config.js`: visible metrics, controls, and generic presets
- `scoring.js`: identity-agnostic ranking and constraint logic
- `app.js`: rendering and interaction behavior
- `bootstrap.js`: parallel loading of static locality chunks
- `data/manifest.json`: dataset metadata and chunk inventory
- `data/airport_capabilities.json`: published FAA/BTS airport tier snapshot
- `data/localities-*.json`: generated locality records

The app has no backend. Searches, slider choices, comparisons, and preference-game answers remain in the browser. Dataset methods and limitations are documented in `DATA_NOTES.md`.

The project intentionally does not add itself to the main site navigation.


## Product structure

The page intentionally reveals complexity in layers:

1. The city-choice game or direct place search
2. Six essential preferences
3. A short ranked list
4. Optional result tools and comparison
5. Advanced controls and the map only when opened

A fresh search uses only the six visible preferences. Hidden advanced metrics start neutral.

## Local preview

Run a static server from the repository root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/projects/findyourcity/`.
