# Resume Studio for calingilan.com

This archive is laid out to extract at the root of `califlower/califlower.github.io`.

```text
projects/resume-studio/                 Static PWA
projects/cloudflare/resume-studio-signaling/  Six-digit WebRTC signaling Worker
```

## Important: no `.nojekyll`

Do not add a root `.nojekyll` file. Your existing blog uses Jekyll layouts, and disabling Jekyll would break it.
Resume Studio has been adapted so the only leading-underscore Python file is reconstructed inside Pyodide at runtime; the deployed file is named `package.py`.

## Add the static app

From the root of `califlower/califlower.github.io`:

```bash
unzip calingilan-resume-studio-drop-in.zip

git add projects/resume-studio projects/cloudflare/resume-studio-signaling
git commit -m "Add Resume Studio PWA"
git push
```

The app will be available at:

```text
https://calingilan.com/projects/resume-studio/
```

The app already uses relative asset paths, the site's sage/terracotta palette, a link back to Calin Gilan, the correct PWA scope, and Jekyll-safe Python assets.

## Enable six-digit nearby transfer

```bash
cd projects/cloudflare/resume-studio-signaling
npm install
npx wrangler login
npm run deploy
```

Copy the resulting `https://...workers.dev` URL into:

```text
projects/resume-studio/config.js
```

Example:

```js
window.RESUME_STUDIO_CONFIG = {
  signalingUrl: "https://resume-studio-signaling.YOUR-SUBDOMAIN.workers.dev",
  turnCredentialsUrl: "",
};
```

Commit and push that one-file change. The Worker is already restricted to `https://calingilan.com` plus local development origins.

Cloudflare STUN is enabled. TURN is intentionally absent; `turnCredentialsUrl` is reserved for adding it later.

## Import your actual project

Open the deployed app, grant persistent storage, then import `resume-studio-current.resume-studio`.
Your real resume content is not included in the public site directory.
