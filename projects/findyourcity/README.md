# Find Your City

A static, client-side city explorer hosted at `/projects/findyourcity/`.

## Architecture

- `index.html`, `styles.css`: application shell and presentation
- `config.js`: visible metrics, controls, and generic presets
- `scoring.js`: identity-agnostic ranking and constraint logic
- `app.js`: rendering and interaction behavior
- `bootstrap.js`: parallel loading of static locality chunks
- `data/manifest.json`: dataset metadata and chunk inventory
- `data/localities-*.json`: generated locality records

The app has no backend. Searches, slider choices, comparisons, and preference-game answers remain in the browser. Dataset methods and limitations are documented in `DATA_NOTES.md`.

The project intentionally does not add itself to the main site navigation.
