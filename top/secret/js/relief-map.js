(function () {
  const { clamp } = window.TopSecretUtils;

  const WATER_LEVEL = 0.33;

  const TERRAIN_STOPS = [
    { h: 0.0, color: [12, 30, 38] },
    { h: 0.18, color: [20, 46, 56] },
    { h: 0.33, color: [43, 70, 62] },
    { h: 0.45, color: [66, 88, 70] },
    { h: 0.62, color: [92, 106, 82] },
    { h: 0.78, color: [118, 116, 90] },
    { h: 0.9, color: [144, 132, 106] },
    { h: 1.0, color: [170, 159, 136] }
  ];

  const LIGHT_DIRECTION = normalize([0.72, -0.46, 0.52]);

  function normalize(vector) {
    const len = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / len, vector[1] / len, vector[2] / len];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothStep(t) {
    return t * t * (3 - 2 * t);
  }

  function toInt32(value) {
    return value | 0;
  }

  function hash2D(x, y, seed) {
    let h = toInt32(x * 374761393) ^ toInt32(y * 668265263) ^ toInt32(seed * 1446648777);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  function createValueNoise2D(seed) {
    const baseSeed = toInt32(seed || 1);

    return function valueNoise2D(x, y) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      const tx = x - x0;
      const ty = y - y0;
      const sx = smoothStep(tx);
      const sy = smoothStep(ty);

      const v00 = hash2D(x0, y0, baseSeed) * 2 - 1;
      const v10 = hash2D(x1, y0, baseSeed) * 2 - 1;
      const v01 = hash2D(x0, y1, baseSeed) * 2 - 1;
      const v11 = hash2D(x1, y1, baseSeed) * 2 - 1;

      const ix0 = lerp(v00, v10, sx);
      const ix1 = lerp(v01, v11, sx);
      return lerp(ix0, ix1, sy);
    };
  }

  function fbm(noiseFn, x, y, octaves, lacunarity, persistence) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let totalAmplitude = 0;

    for (let i = 0; i < octaves; i++) {
      const sample = noiseFn(x * frequency, y * frequency) * 0.5 + 0.5;
      value += sample * amplitude;
      totalAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / totalAmplitude;
  }

  function ridged(noiseFn, x, y, octaves, lacunarity, persistence) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let totalAmplitude = 0;

    for (let i = 0; i < octaves; i++) {
      const sample = 1 - Math.abs(noiseFn(x * frequency, y * frequency));
      value += sample * amplitude;
      totalAmplitude += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / totalAmplitude;
  }

  class ReliefMapRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.width = 0;
      this.height = 0;
      this.seed = Math.floor(Math.random() * 1e9);

      this.sampleStep = 1;
      this.mapWidth = 0;
      this.mapHeight = 0;
      this.heightMap = new Float32Array(0);

      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenContext = this.offscreenCanvas.getContext("2d");
    }

    resize(width, height) {
      const nextWidth = Math.max(120, Math.floor(width));
      const nextHeight = Math.max(120, Math.floor(height));
      if (nextWidth === this.width && nextHeight === this.height) return false;

      this.width = nextWidth;
      this.height = nextHeight;
      this.sampleStep = this.width * this.height > 680000 ? 2 : 1;
      this.mapWidth = Math.max(180, Math.floor(this.width / this.sampleStep));
      this.mapHeight = Math.max(120, Math.floor(this.height / this.sampleStep));

      this.offscreenCanvas.width = this.mapWidth;
      this.offscreenCanvas.height = this.mapHeight;

      this.buildTerrain();
      return true;
    }

    regenerate(seed) {
      this.seed = typeof seed === "number" ? seed : Math.floor(Math.random() * 1e9);
      this.buildTerrain();
    }

    drawBase(targetContext) {
      if (!this.offscreenCanvas.width || !this.offscreenCanvas.height) return;

      targetContext.imageSmoothingEnabled = true;
      targetContext.drawImage(this.offscreenCanvas, 0, 0, this.width, this.height);
      targetContext.imageSmoothingEnabled = false;
    }

    heightAtCanvasPoint(x, y) {
      if (!this.heightMap.length) return 0;

      const mapX = clamp(Math.floor((x / this.width) * this.mapWidth), 0, this.mapWidth - 1);
      const mapY = clamp(Math.floor((y / this.height) * this.mapHeight), 0, this.mapHeight - 1);
      return this.heightMap[mapY * this.mapWidth + mapX];
    }

    isLandAtCanvasPoint(x, y) {
      return this.heightAtCanvasPoint(x, y) > WATER_LEVEL;
    }

    buildTerrain() {
      if (!this.mapWidth || !this.mapHeight) return;

      const heightMap = this.composeHeightMap();
      this.heightMap = this.smoothHeightMap(heightMap);
      this.paintTerrain();
    }

    composeHeightMap() {
      const map = new Float32Array(this.mapWidth * this.mapHeight);

      const baseNoise = createValueNoise2D(this.seed + 11);
      const warpXNoise = createValueNoise2D(this.seed + 131);
      const warpYNoise = createValueNoise2D(this.seed + 719);
      const ridgeNoise = createValueNoise2D(this.seed + 2029);
      const microNoise = createValueNoise2D(this.seed + 4013);

      for (let y = 0; y < this.mapHeight; y++) {
        const ny = y / this.mapHeight - 0.5;

        for (let x = 0; x < this.mapWidth; x++) {
          const nx = x / this.mapWidth - 0.5;

          const warpX = warpXNoise(nx * 1.7, ny * 1.7) * 0.22;
          const warpY = warpYNoise((nx + 2.4) * 1.7, (ny - 1.9) * 1.7) * 0.22;

          const macro = fbm(baseNoise, nx + warpX, ny + warpY, 5, 2.05, 0.54);
          const ridges = ridged(ridgeNoise, (nx - warpY * 0.45) * 2.6, (ny + warpX * 0.45) * 2.6, 4, 2.2, 0.55);
          const micro = fbm(microNoise, nx * 8.2, ny * 8.2, 2, 2.8, 0.45);

          let height = macro * 0.68 + ridges * 0.27 + micro * 0.05;
          const edgeFalloff = clamp((Math.hypot(nx * 1.08, ny * 0.94) - 0.6) * 0.35, 0, 0.22);
          height -= edgeFalloff;

          map[y * this.mapWidth + x] = clamp(height, 0, 1);
        }
      }

      return map;
    }

    smoothHeightMap(sourceMap) {
      const smoothed = new Float32Array(sourceMap.length);

      for (let y = 0; y < this.mapHeight; y++) {
        for (let x = 0; x < this.mapWidth; x++) {
          const center = sourceMap[y * this.mapWidth + x] * 0.5;
          const left = sourceMap[y * this.mapWidth + Math.max(0, x - 1)] * 0.125;
          const right = sourceMap[y * this.mapWidth + Math.min(this.mapWidth - 1, x + 1)] * 0.125;
          const up = sourceMap[Math.max(0, y - 1) * this.mapWidth + x] * 0.125;
          const down = sourceMap[Math.min(this.mapHeight - 1, y + 1) * this.mapWidth + x] * 0.125;
          smoothed[y * this.mapWidth + x] = center + left + right + up + down;
        }
      }

      return smoothed;
    }

    paintTerrain() {
      const imageData = this.offscreenContext.createImageData(this.mapWidth, this.mapHeight);
      const data = imageData.data;
      const contourStep = 0.055;

      for (let y = 0; y < this.mapHeight; y++) {
        for (let x = 0; x < this.mapWidth; x++) {
          const index = y * this.mapWidth + x;
          const h = this.heightMap[index];
          const shade = this.computeHillshade(x, y);
          const contour = Math.abs((h / contourStep) % 1 - 0.5);
          const base = this.colorForHeight(h);

          const reliefBoost = 0.72 + shade * 0.55;
          let r = base[0] * reliefBoost;
          let g = base[1] * reliefBoost;
          let b = base[2] * reliefBoost;

          if (contour < 0.035) {
            r *= 0.86;
            g *= 0.86;
            b *= 0.86;
          }

          if (h > 0.74) {
            r *= 1.06;
            g *= 1.03;
            b *= 1.02;
          }

          if (h <= WATER_LEVEL) {
            r *= 0.88;
            g *= 0.95;
            b *= 1.05;
          }

          const px = index * 4;
          data[px] = clamp(Math.round(r), 0, 255);
          data[px + 1] = clamp(Math.round(g), 0, 255);
          data[px + 2] = clamp(Math.round(b), 0, 255);
          data[px + 3] = 255;
        }
      }

      this.offscreenContext.putImageData(imageData, 0, 0);
    }

    computeHillshade(x, y) {
      const left = this.heightMap[y * this.mapWidth + Math.max(0, x - 1)];
      const right = this.heightMap[y * this.mapWidth + Math.min(this.mapWidth - 1, x + 1)];
      const up = this.heightMap[Math.max(0, y - 1) * this.mapWidth + x];
      const down = this.heightMap[Math.min(this.mapHeight - 1, y + 1) * this.mapWidth + x];

      const dx = right - left;
      const dy = down - up;

      const normal = normalize([-dx * 1.6, -dy * 1.6, 1]);
      const shade =
        normal[0] * LIGHT_DIRECTION[0] +
        normal[1] * LIGHT_DIRECTION[1] +
        normal[2] * LIGHT_DIRECTION[2];

      return clamp(shade, 0.25, 1);
    }

    colorForHeight(height) {
      for (let i = 1; i < TERRAIN_STOPS.length; i++) {
        if (height <= TERRAIN_STOPS[i].h) {
          const low = TERRAIN_STOPS[i - 1];
          const high = TERRAIN_STOPS[i];
          const t = (height - low.h) / (high.h - low.h);

          return [
            lerp(low.color[0], high.color[0], t),
            lerp(low.color[1], high.color[1], t),
            lerp(low.color[2], high.color[2], t)
          ];
        }
      }

      const top = TERRAIN_STOPS[TERRAIN_STOPS.length - 1].color;
      return [top[0], top[1], top[2]];
    }
  }

  window.ReliefMapRenderer = ReliefMapRenderer;
})();
