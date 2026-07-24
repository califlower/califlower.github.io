# Resume Studio signaling Worker

This Cloudflare Worker maps temporary six-digit codes to WebRTC offer/answer messages. It never receives the resume archive.

```bash
npm install
npx wrangler login
npm run deploy
```

After deployment, copy the Worker URL into `projects/resume-studio/config.js` as `signalingUrl`.

`wrangler.toml` already allows:

- `https://calingilan.com`
- `http://localhost:4173`
- `http://127.0.0.1:4173`

The browser client uses Cloudflare STUN only:

- `stun:stun.cloudflare.com:3478`
- `stun:stun.cloudflare.com:53`

TURN can be added later by exposing a credential endpoint that returns `{ "iceServers": [...] }` and setting `turnCredentialsUrl` in the static app.
