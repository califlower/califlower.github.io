// Set signalingUrl after deploying the bundled Cloudflare Worker.
// Everything except direct six-digit WebRTC transfer works while this is blank.
window.RESUME_STUDIO_CONFIG = {
  signalingUrl: "",

  // Future TURN support: point this at an endpoint returning
  // { iceServers: RTCIceServer[] }. The transfer client needs no other changes.
  turnCredentialsUrl: "",
};
