(function () {
  function rand(min, max, rng = Math.random) {
    return rng() * (max - min) + min;
  }

  function pick(list, rng = Math.random) {
    return list[(rng() * list.length) | 0];
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatMoney(value) {
    const abs = Math.abs(value);
    const sign = value < 0 ? "-$" : "$";

    function short(num, divisor, suffix) {
      const scaled = num / divisor;
      const precision = scaled >= 10 ? 0 : 1;
      return sign + scaled.toFixed(precision).replace(/\.0$/, "") + " " + suffix;
    }

    if (abs >= 1e9) return short(abs, 1e9, "bil");
    if (abs >= 1e6) return short(abs, 1e6, "mil");
    if (abs >= 1e3) return short(abs, 1e3, "k");
    return sign + Math.round(abs).toLocaleString();
  }

  function createSeededRng(seedInput) {
    const seedString = String(seedInput);
    let h = 1779033703 ^ seedString.length;
    for (let i = 0; i < seedString.length; i++) {
      h = Math.imul(h ^ seedString.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }

    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;

    return function seeded() {
      h += 0x6d2b79f5;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.TopSecretUtils = {
    rand,
    pick,
    clamp,
    formatMoney,
    createSeededRng
  };
})();
