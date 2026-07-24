# Resume Studio static PWA

Deploy this directory at `/projects/resume-studio/` on `calingilan.com`.

The app is:

- statically hosted
- installable as a PWA
- local-first with persistent browser storage
- backed by a local Git repository
- capable of full project backup/import
- capable of Web Share / AirDrop-style sharing
- prepared for six-digit WebRTC transfer through the bundled Cloudflare Worker

The app is safe under the site's existing Jekyll build. `package.py` is intentionally reconstructed as `resume_tool/__init__.py` inside Pyodide at runtime.
