const {
  BANKRUPTCY_THRESHOLD,
  COMMANDER_LINES,
  DEFENSE_ECONOMY,
  ENTITY_COUNT,
  ENTITY_NAME_BITS,
  ENTITY_STYLE,
  ENTITY_SUFFIXES,
  ENTITY_TYPE_WEIGHTS,
  RANDOM_EVENT_SWING,
  STARTING_TREASURY,
  THREAT_CALLOUTS,
  THREAT_CLEAR_REWARD,
  THREAT_FAILURE_DAMAGE_BASE,
  THREAT_TYPES,
  TREASURY_DRIFT_PER_SECOND,
  WEAPONS,
  WORLD_EVENT_LINES
} = window.TopSecretConfig;

const { clamp, formatMoney, pick, rand } = window.TopSecretUtils;
const { ReliefMapRenderer } = window;

const TARGET_MARKERS = ["diamond", "triangle", "square", "hex", "cross", "reticle", "chevron", "pentagon"];

const THREAT_PALETTES = {
  insurgent: {
    fill: "rgba(172, 34, 28, 0.18)",
    stroke: "rgba(255, 95, 88, 0.95)",
    outer: "rgba(255, 164, 132, 0.62)",
    marker: "#ffd2ca"
  },
  armor: {
    fill: "rgba(175, 96, 24, 0.17)",
    stroke: "rgba(255, 180, 88, 0.95)",
    outer: "rgba(245, 214, 138, 0.62)",
    marker: "#fff0c7"
  },
  air: {
    fill: "rgba(25, 94, 160, 0.16)",
    stroke: "rgba(123, 198, 255, 0.94)",
    outer: "rgba(176, 226, 255, 0.6)",
    marker: "#e8f7ff"
  },
  cyber: {
    fill: "rgba(23, 118, 92, 0.17)",
    stroke: "rgba(103, 238, 197, 0.94)",
    outer: "rgba(167, 255, 230, 0.58)",
    marker: "#dcfff5"
  }
};

class CommandCenterGame {
  constructor(root) {
    this.root = root;

    this.canvas = root.querySelector("#mapCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.threatList = root.querySelector("#threatList");
    this.eventFeed = root.querySelector("#eventFeed");
    this.droneBtn = root.querySelector("#droneBtn");
    this.missileDefenseBtn = root.querySelector("#missileDefenseBtn");
    this.weaponBar = root.querySelector("#weaponBar");

    this.treasuryText = root.querySelector("#treasuryText");
    this.stabilityText = root.querySelector("#stabilityText");
    this.selectionText = root.querySelector("#selectionText");
    this.weaponText = root.querySelector("#weaponText");
    this.instructionText = root.querySelector("#instructionText");

    this.state = this.createState();
    this.terrain = new ReliefMapRenderer(this.canvas);

    this.started = false;
    this.worldEventInterval = null;
    this.instructionInterval = null;

    this.updateFrame = this.updateFrame.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.handleMapTap = this.handleMapTap.bind(this);
  }

  createState() {
    return {
      running: false,
      treasury: STARTING_TREASURY,
      stability: 62,
      selectedWeaponId: WEAPONS[0].id,
      selectedThreatId: null,
      nextThreatId: 1,
      entities: [],
      links: [],
      threats: [],
      projectiles: [],
      effects: [],
      events: [],
      defenses: {
        drone: false,
        missileDefense: false
      },
      previousFrameAt: 0,
      nextUiRefreshAt: 0
    };
  }

  start() {
    if (this.started) return;
    this.started = true;

    this.attachListeners();
    this.handleResize();
    this.terrain.regenerate(Math.floor(Math.random() * 1e9));
    this.generateEntities();

    for (let i = 0; i < 5; i++) this.spawnThreat();

    this.createWeaponBar();
    this.updateDefenseButtons();
    this.renderEvents();
    this.renderThreatList();
    this.updateHud();

    this.state.running = true;
    this.updateInstruction();

    this.worldEventInterval = window.setInterval(() => this.randomWorldEvent(), 6200);
    this.instructionInterval = window.setInterval(() => this.updateInstruction(), 3400);

    requestAnimationFrame(this.updateFrame);
  }

  stop() {
    this.state.running = false;
    if (this.worldEventInterval) window.clearInterval(this.worldEventInterval);
    if (this.instructionInterval) window.clearInterval(this.instructionInterval);
    this.worldEventInterval = null;
    this.instructionInterval = null;
  }

  attachListeners() {
    this.canvas.addEventListener("click", this.handleMapTap);
    this.canvas.addEventListener(
      "touchstart",
      (event) => {
        event.preventDefault();
        this.handleMapTap(event);
      },
      { passive: false }
    );

    this.droneBtn.addEventListener("click", () => this.toggleDroneRetaliation());
    this.missileDefenseBtn.addEventListener("click", () => this.toggleMissileDefense());
    window.addEventListener("resize", this.handleResize);
  }

  handleResize() {
    if (!this.root.classList.contains("active")) return;

    const rect = this.canvas.getBoundingClientRect();
    const nextWidth = Math.max(280, Math.floor(rect.width));
    const nextHeight = Math.max(220, Math.floor(rect.height));

    const prevWidth = this.canvas.width || nextWidth;
    const prevHeight = this.canvas.height || nextHeight;

    if (prevWidth === nextWidth && prevHeight === nextHeight) return;

    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    this.terrain.resize(nextWidth, nextHeight);

    if (!this.state.entities.length) return;

    const scaleX = nextWidth / prevWidth;
    const scaleY = nextHeight / prevHeight;

    this.state.entities.forEach((entity) => {
      entity.x *= scaleX;
      entity.y *= scaleY;
    });

    this.state.links.forEach((link) => {
      link.ax *= scaleX;
      link.ay *= scaleY;
      link.bx *= scaleX;
      link.by *= scaleY;
    });

    this.state.threats.forEach((threat) => {
      threat.x *= scaleX;
      threat.y *= scaleY;
    });

    this.state.projectiles.forEach((projectile) => {
      projectile.sx *= scaleX;
      projectile.sy *= scaleY;
      projectile.cpx *= scaleX;
      projectile.cpy *= scaleY;
      projectile.tx *= scaleX;
      projectile.ty *= scaleY;

      if (typeof projectile.targetX === "number") projectile.targetX *= scaleX;
      if (typeof projectile.targetY === "number") projectile.targetY *= scaleY;

      if (Array.isArray(projectile.clusterLine)) {
        projectile.clusterLine.forEach((point) => {
          point.x *= scaleX;
          point.y *= scaleY;
        });
      }
    });

    this.state.effects.forEach((effect) => {
      effect.x *= scaleX;
      effect.y *= scaleY;
    });
  }

  generateEntities() {
    this.state.entities = [];
    const minDistance = 28;
    const attemptsCap = ENTITY_COUNT * 140;
    let attempts = 0;

    while (this.state.entities.length < ENTITY_COUNT && attempts < attemptsCap) {
      attempts += 1;
      const x = rand(70, this.canvas.width - 70);
      const y = rand(70, this.canvas.height - 70);

      if (!this.terrain.isLandAtCanvasPoint(x, y)) continue;

      const tooClose = this.state.entities.some((entity) => Math.hypot(entity.x - x, entity.y - y) < minDistance);
      if (tooClose) continue;

      const type = pick(ENTITY_TYPE_WEIGHTS);
      const style = ENTITY_STYLE[type] || ENTITY_STYLE.building;
      const suffixes = ENTITY_SUFFIXES[type] || ENTITY_SUFFIXES.building;

      this.state.entities.push({
        id: this.state.entities.length + 1,
        type,
        name: pick(ENTITY_NAME_BITS) + " " + pick(suffixes),
        x,
        y,
        size: style.size
      });
    }

    this.buildRoadLinks();
  }

  buildRoadLinks() {
    const anchors = this.state.entities.filter((entity) => entity.type === "city" || entity.type === "town");
    const links = [];
    const seen = new Set();

    anchors.forEach((anchor) => {
      const nearest = anchors
        .filter((candidate) => candidate.id !== anchor.id)
        .map((candidate) => ({
          target: candidate,
          distance: Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 2);

      nearest.forEach(({ target }) => {
        const key = anchor.id < target.id ? anchor.id + "-" + target.id : target.id + "-" + anchor.id;
        if (seen.has(key)) return;
        seen.add(key);

        links.push({
          ax: anchor.x,
          ay: anchor.y,
          bx: target.x,
          by: target.y
        });
      });
    });

    this.state.links = links;
  }

  spawnThreat() {
    const target = pick(this.state.entities);
    if (!target) return;

    const type = pick(THREAT_TYPES);
    const severity = rand(0.72, 1.55);
    const timer = rand(20, 36) / severity;
    const radius = rand(26, 44);

    const x = clamp(target.x + rand(-65, 65), 24, this.canvas.width - 24);
    const y = clamp(target.y + rand(-65, 65), 24, this.canvas.height - 24);

    const callout = pick(THREAT_CALLOUTS[type]);

    this.state.threats.push({
      id: this.state.nextThreatId++,
      type,
      x,
      y,
      radius,
      hp: 52 * severity,
      timer,
      severity,
      targetId: target.id,
      callout,
      marker: pick(TARGET_MARKERS)
    });

    this.pushEvent(type.toUpperCase() + " threat near " + target.name + ". " + callout + ".");
  }

  pushEvent(text) {
    this.state.events.unshift({ text, stamp: Date.now() });
    this.state.events = this.state.events.slice(0, 32);
    this.renderEvents();
  }

  renderEvents() {
    this.eventFeed.innerHTML = "";
    this.state.events.forEach((eventLine) => {
      const row = document.createElement("div");
      row.className = "event-line";
      row.textContent = eventLine.text;
      this.eventFeed.appendChild(row);
    });
  }

  renderThreatList() {
    this.threatList.innerHTML = "";

    const sorted = this.state.threats.slice().sort((a, b) => a.timer - b.timer);
    sorted.forEach((threat) => {
      const row = document.createElement("div");
      row.className = "threat-item" + (threat.id === this.state.selectedThreatId ? " active" : "");
      row.innerHTML =
        threat.type.toUpperCase() +
        " - " +
        threat.callout +
        "<br>Timer: " +
        threat.timer.toFixed(1) +
        "s | HP: " +
        Math.max(0, Math.round(threat.hp));

      row.addEventListener("click", () => this.handleThreatSelection(threat));
      this.threatList.appendChild(row);
    });
  }

  updateHud() {
    this.treasuryText.textContent = formatMoney(this.state.treasury);

    this.stabilityText.textContent = Math.max(0, Math.round(this.state.stability)) + "%";
    this.stabilityText.classList.remove("good", "bad");
    this.stabilityText.classList.add(this.state.stability > 50 ? "good" : "bad");

    const selectedThreat = this.state.threats.find((threat) => threat.id === this.state.selectedThreatId);
    this.selectionText.textContent = selectedThreat
      ? selectedThreat.type + " @ " + selectedThreat.timer.toFixed(1) + "s"
      : "None";

    const selectedWeapon = WEAPONS.find((weapon) => weapon.id === this.state.selectedWeaponId);
    this.weaponText.textContent = selectedWeapon ? selectedWeapon.name : "None";
  }

  createWeaponBar() {
    this.weaponBar.innerHTML = "";

    WEAPONS.forEach((weapon) => {
      const bestType = Object.keys(weapon.effects).sort((a, b) => weapon.effects[b] - weapon.effects[a])[0];

      const card = document.createElement("button");
      card.className = "weapon" + (weapon.id === this.state.selectedWeaponId ? " active" : "");
      card.type = "button";
      card.innerHTML =
        "<strong>" +
        weapon.name +
        "</strong><br>Taxpayer cost: " +
        formatMoney(weapon.cost) +
        "<br>Best vs " +
        bestType.toUpperCase() +
        "<br>" +
        weapon.note;

      card.addEventListener("click", () => {
        this.state.selectedWeaponId = weapon.id;
        this.createWeaponBar();
        this.updateHud();
      });

      this.weaponBar.appendChild(card);
    });
  }

  updateDefenseButtons() {
    this.droneBtn.textContent =
      "Drone Retaliation (" +
      (this.state.defenses.drone ? "online" : "activate " + formatMoney(DEFENSE_ECONOMY.droneActivation)) +
      ", upkeep " +
      formatMoney(DEFENSE_ECONOMY.droneUpkeep) +
      "/s)";

    this.missileDefenseBtn.textContent =
      "Missile Defense (" +
      (this.state.defenses.missileDefense ? "online" : "activate " + formatMoney(DEFENSE_ECONOMY.missileActivation)) +
      ", upkeep " +
      formatMoney(DEFENSE_ECONOMY.missileUpkeep) +
      "/s)";
  }

  handleMapTap(event) {
    if (!this.state.running) return;

    const rect = this.canvas.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    const x = (clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (clientY - rect.top) * (this.canvas.height / rect.height);

    const threat = this.findThreatAtPoint(x, y);
    if (!threat) return;
    this.handleThreatSelection(threat);
  }

  handleThreatSelection(threat) {
    if (!this.state.running) return;

    this.state.selectedThreatId = threat.id;
    this.updateHud();
    this.renderThreatList();
    this.deployWeapon(threat);
  }

  findThreatAtPoint(x, y) {
    let bestThreat = null;
    let bestDistance = Infinity;

    for (const threat of this.state.threats) {
      const distance = Math.hypot(threat.x - x, threat.y - y);
      if (distance < threat.radius + 16 && distance < bestDistance) {
        bestThreat = threat;
        bestDistance = distance;
      }
    }

    return bestThreat;
  }

  findStagingPoint(target) {
    const candidates = this.state.entities.filter(
      (entity) => entity.type === "city" || entity.type === "town" || entity.type === "base"
    );

    if (!candidates.length) {
      return { x: this.canvas.width * 0.5, y: this.canvas.height - 22 };
    }

    let closest = candidates[0];
    let bestDistance = Math.hypot(candidates[0].x - target.x, candidates[0].y - target.y);

    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i];
      const distance = Math.hypot(candidate.x - target.x, candidate.y - target.y);
      if (distance < bestDistance) {
        closest = candidate;
        bestDistance = distance;
      }
    }

    return {
      x: clamp(closest.x + rand(-8, 8), 10, this.canvas.width - 10),
      y: clamp(closest.y + rand(-8, 8), 10, this.canvas.height - 10)
    };
  }

  deployWeapon(target) {
    if (!this.state.running) return;

    const weapon = WEAPONS.find((item) => item.id === this.state.selectedWeaponId);
    if (!weapon || !target) return;

    if (this.state.treasury < weapon.cost) {
      this.pushEvent("Treasury says no. " + weapon.name + " request denied.");
      return;
    }

    this.state.treasury -= weapon.cost;

    let animation = "ballistic";
    let originX = this.canvas.width * 0.5;
    let originY = this.canvas.height + 12;
    let endX = target.x;
    let endY = target.y;
    let controlX = 0;
    let controlY = 0;
    let spriteSize = 5;
    let trailWidth = 2.4;
    let durationScale = 6.8;

    let dirX = 0;
    let dirY = 0;
    let dropProgress = 1;
    let clusterLine = null;
    let phaseAdvance = 0.52;
    let phaseFight = 0.32;

    let launchText = weapon.name + " launched at " + target.type + ". Cost billed to taxpayers.";

    if (weapon.id === "airplane") {
      animation = "airstrike";

      const launchFromLeft = Math.random() < 0.5;
      const rawDirX = launchFromLeft ? 1 : -1;
      const rawDirY = rand(-0.14, 0.14);
      const dirLength = Math.hypot(rawDirX, rawDirY) || 1;

      dirX = rawDirX / dirLength;
      dirY = rawDirY / dirLength;

      const before = launchFromLeft ? target.x + 120 : this.canvas.width - target.x + 120;
      const after = launchFromLeft ? this.canvas.width - target.x + 120 : target.x + 120;

      originX = target.x - dirX * before;
      originY = target.y - dirY * before;
      endX = target.x + dirX * after;
      endY = target.y + dirY * after;

      controlX = (originX + endX) * 0.5;
      controlY = (originY + endY) * 0.5;

      dropProgress = before / (before + after);
      clusterLine = [-2, -1, 0, 1, 2].map((offset) => ({
        x: clamp(target.x + dirX * offset * 18, 16, this.canvas.width - 16),
        y: clamp(target.y + dirY * offset * 18, 16, this.canvas.height - 16)
      }));

      spriteSize = 7;
      trailWidth = 2;
      durationScale = 5.2;
      launchText = "Airplane strike package crossing target corridor over " + target.type + ".";
    } else if (weapon.id === "ground-troops") {
      animation = "convoy";

      const staging = this.findStagingPoint(target);
      originX = staging.x;
      originY = staging.y;
      endX = target.x;
      endY = target.y;

      controlX = (originX + endX) * 0.5 + rand(-34, 34);
      controlY = (originY + endY) * 0.5 + rand(-22, 22);
      spriteSize = 5;
      trailWidth = 1.85;
      durationScale = 13.5;
      phaseAdvance = 0.5;
      phaseFight = 0.34;
      launchText = "Ground troop formation moving toward " + target.type + " contact zone.";
    } else {
      const distancePreview = Math.hypot(endX - originX, endY - originY);
      const arcFactor = weapon.id === "big-missiles" ? 1.45 : 1.1;

      controlX = (originX + endX) * 0.5 + rand(-24, 24);
      controlY = Math.min(originY, endY) - Math.max(20, distancePreview * 0.08) * arcFactor;
      spriteSize = weapon.id === "big-missiles" ? 7 : 5;
      trailWidth = weapon.id === "big-missiles" ? 3.4 : 2.4;
      durationScale = weapon.id === "big-missiles" ? 8.9 : 6.8;
    }

    const distance = Math.hypot(endX - originX, endY - originY);
    const minimumDuration = animation === "convoy" ? 1800 : animation === "airstrike" ? 1450 : 700;

    this.state.projectiles.push({
      weaponId: weapon.id,
      animation,
      targetId: target.id,
      targetX: target.x,
      targetY: target.y,
      sx: originX,
      sy: originY,
      cpx: controlX,
      cpy: controlY,
      tx: endX,
      ty: endY,
      start: performance.now(),
      duration: Math.max(minimumDuration, distance * (durationScale / weapon.speed)),
      spriteSize,
      trailWidth,
      wobbleSeed: Math.random() * Math.PI * 2,
      dirX,
      dirY,
      dropProgress,
      clusterLine,
      dropDone: false,
      phaseAdvance,
      phaseFight,
      phaseRetreat: Math.max(0.08, 1 - phaseAdvance - phaseFight),
      fightStarted: false,
      disengageNoted: false,
      lastFightTick: 0
    });

    this.pushEvent(launchText + " Cost billed to taxpayers.");
    this.updateHud();
  }

  resolveProjectileHit(projectile, now) {
    const weapon = WEAPONS.find((item) => item.id === projectile.weaponId);
    const target = this.state.threats.find((item) => item.id === projectile.targetId);
    if (!weapon) return;

    const impactX = target
      ? target.x
      : (typeof projectile.targetX === "number" ? projectile.targetX : projectile.tx);
    const impactY = target
      ? target.y
      : (typeof projectile.targetY === "number" ? projectile.targetY : projectile.ty);

    this.addImpactEffect(impactX, impactY, weapon.id, now);

    if (!target) {
      if (weapon.radius) {
        this.state.threats.forEach((neighbor) => {
          const distance = Math.hypot(neighbor.x - impactX, neighbor.y - impactY);
          if (distance <= weapon.radius) {
            const splash = weapon.power * 0.42 * (1 - distance / weapon.radius) * rand(0.75, 1.12);
            neighbor.hp -= splash;
          }
        });
      }

      this.pushEvent(weapon.name + " impacted a cleared zone. Oversight calls this 'preemptive confidence'.");
      return;
    }

    const multiplier = weapon.effects[target.type] || 0.6;
    const damage = weapon.power * multiplier * rand(0.88, 1.14);
    target.hp -= damage;

    if (weapon.suppression) {
      target.timer += rand(2.2, 4.4);
      this.pushEvent("Ground troops tangled " + target.type + " in paperwork and checkpoints.");
    }

    if (weapon.radius) {
      this.state.threats.forEach((neighbor) => {
        if (neighbor.id === target.id) return;
        const distance = Math.hypot(neighbor.x - impactX, neighbor.y - impactY);
        if (distance <= weapon.radius) {
          const splash = damage * 0.55 * (1 - distance / weapon.radius * 0.6);
          neighbor.hp -= splash;
        }
      });

      this.pushEvent("Big missile splash impacted nearby sectors.");
    }
  }

  tickThreats(dt) {
    for (let i = this.state.threats.length - 1; i >= 0; i--) {
      const threat = this.state.threats[i];
      const pressure = threat.type === "insurgent" ? 1.05 : threat.type === "armor" ? 0.92 : 1;
      threat.timer -= dt * pressure;

      if (threat.hp <= 0) {
        this.neutralizeThreat(i, true);
        continue;
      }

      if (threat.timer <= 0) {
        this.handleThreatExpiry(threat);
        this.neutralizeThreat(i, false);
      }
    }
  }

  neutralizeThreat(threatIndex, withReward) {
    const threat = this.state.threats[threatIndex];
    if (!threat) return;

    if (withReward) {
      this.state.treasury += rand(THREAT_CLEAR_REWARD.min, THREAT_CLEAR_REWARD.max);
      this.state.stability += 1.2;
      this.pushEvent("Threat neutralized. Officials claim strategic brilliance.");
    }

    this.state.threats.splice(threatIndex, 1);
    if (this.state.selectedThreatId === threat.id) this.state.selectedThreatId = null;
  }

  handleThreatExpiry(threat) {
    let damage = THREAT_FAILURE_DAMAGE_BASE * threat.severity;

    if (this.state.defenses.missileDefense && threat.type === "air") {
      damage *= 0.45;
      this.pushEvent("Missile Defense blunted an air strike.");
    }

    this.state.treasury -= damage;
    this.state.stability -= 3.4 * threat.severity;
    this.pushEvent(threat.callout + " succeeded near critical infrastructure. Cost: " + formatMoney(damage));
  }

  updateDefenses(dt) {
    if (this.state.defenses.drone) {
      this.state.treasury -= DEFENSE_ECONOMY.droneUpkeep * dt;

      if (Math.random() < dt * 0.48) {
        const priorityTargets = this.state.threats.filter((threat) => threat.type === "insurgent" || threat.type === "cyber");
        const target = priorityTargets.length ? pick(priorityTargets) : this.state.threats[0];

        if (target) {
          target.hp -= rand(7, 16);
          target.timer += 0.5;
          this.pushEvent("Drone Retaliation harassed " + target.type + " cells.");
        }
      }
    }

    if (this.state.defenses.missileDefense) {
      this.state.treasury -= DEFENSE_ECONOMY.missileUpkeep * dt;

      const airThreat = this.state.threats.find((threat) => threat.type === "air" && threat.timer < 6.5);
      if (airThreat && Math.random() < dt * 0.85) {
        airThreat.hp -= rand(10, 20);
        this.pushEvent("Missile Defense intercepted inbound fragments.");
      }
    }
  }

  updateProjectiles(now) {
    const survivors = [];

    for (const projectile of this.state.projectiles) {
      const elapsed = now - projectile.start;
      const progress = Math.min(1, elapsed / projectile.duration);

      if (projectile.animation === "airstrike") {
        if (!projectile.dropDone && progress >= projectile.dropProgress) {
          this.resolveAirstrikeDrop(projectile, now);
          projectile.dropDone = true;
        }

        if (elapsed < projectile.duration) {
          survivors.push(projectile);
        } else if (!projectile.dropDone) {
          this.resolveAirstrikeDrop(projectile, now);
        }

        continue;
      }

      if (projectile.animation === "convoy") {
        this.updateConvoyMission(projectile, now, elapsed);

        if (elapsed < projectile.duration) {
          survivors.push(projectile);
        } else {
          this.finishConvoyMission(projectile, now);
        }

        continue;
      }

      if (elapsed >= projectile.duration) {
        this.resolveProjectileHit(projectile, now);
      } else {
        survivors.push(projectile);
      }
    }

    this.state.projectiles = survivors;
  }

  resolveAirstrikeDrop(projectile, now) {
    const weapon = WEAPONS.find((item) => item.id === projectile.weaponId);
    if (!weapon) return;

    const dropPoints = Array.isArray(projectile.clusterLine) && projectile.clusterLine.length
      ? projectile.clusterLine
      : [{ x: projectile.targetX, y: projectile.targetY }];

    dropPoints.forEach((point, index) => {
      this.addImpactEffect(point.x, point.y, "airplane", now + index * 28);
    });

    this.state.threats.forEach((threat) => {
      let totalDamage = 0;

      dropPoints.forEach((point) => {
        const distance = Math.hypot(threat.x - point.x, threat.y - point.y);
        if (distance <= 34) {
          const falloff = 1 - distance / 34;
          const base = rand(5, 10);
          const typeBonus = weapon.effects[threat.type] || 0.65;
          totalDamage += base * typeBonus * (0.55 + falloff * 0.9);
        }
      });

      if (totalDamage > 0) {
        threat.hp -= totalDamage;
      }
    });

    this.pushEvent("Airplane released cluster munitions across the target corridor.");
  }

  updateConvoyMission(projectile, now, elapsed) {
    const advanceEnd = projectile.duration * projectile.phaseAdvance;
    const fightEnd = advanceEnd + projectile.duration * projectile.phaseFight;

    if (!projectile.fightStarted && elapsed >= advanceEnd) {
      projectile.fightStarted = true;
      projectile.lastFightTick = now;
      this.pushEvent("Ground troops reached contact and started exchanging fire.");
    }

    if (projectile.fightStarted && elapsed < fightEnd) {
      const weapon = WEAPONS.find((item) => item.id === projectile.weaponId);
      const target = this.state.threats.find((item) => item.id === projectile.targetId);

      while (now - projectile.lastFightTick >= 260) {
        projectile.lastFightTick += 260;

        if (target && weapon) {
          const typeBonus = weapon.effects[target.type] || 0.65;
          const damage = rand(2.8, 5.4) * typeBonus;
          target.hp -= damage;
          target.timer += rand(0.12, 0.24);
          this.addImpactEffect(target.x + rand(-10, 10), target.y + rand(-10, 10), "ground-troops", projectile.lastFightTick);
        }
      }
    }

    if (!projectile.disengageNoted && elapsed >= fightEnd) {
      projectile.disengageNoted = true;
      this.pushEvent("Ground troops disengaging and withdrawing in formation.");
    }
  }

  finishConvoyMission(projectile, now) {
    const target = this.state.threats.find((item) => item.id === projectile.targetId);
    if (target) {
      target.timer += rand(1.8, 3.1);
      this.addImpactEffect(target.x, target.y, "ground-troops", now);
    }

    this.pushEvent("Ground troop formation cleared objective and returned to staging.");
  }

  randomWorldEvent() {
    if (!this.state.running) return;

    const swing = rand(RANDOM_EVENT_SWING.min, RANDOM_EVENT_SWING.max);
    this.state.treasury += swing;

    const sign = swing >= 0 ? "+" : "";
    this.pushEvent(pick(WORLD_EVENT_LINES) + " Treasury shift: " + sign + formatMoney(swing) + ".");
  }

  updateInstruction() {
    if (!this.root.classList.contains("active") || !this.state.running) return;

    const urgent = this.state.threats.slice().sort((a, b) => a.timer - b.timer)[0];
    if (urgent && urgent.timer < 7) {
      if (urgent.type === "insurgent") {
        this.instructionText.textContent =
          "Insurgents in this area. Highlighted zone expires in " + urgent.timer.toFixed(1) + "s.";
      } else {
        this.instructionText.textContent = "Urgent: " + urgent.callout + " expires in " + urgent.timer.toFixed(1) + "s.";
      }
      return;
    }

    this.instructionText.textContent = pick(COMMANDER_LINES);
  }

  toggleDroneRetaliation() {
    if (!this.state.running) return;

    if (!this.state.defenses.drone) {
      const needsMissileDefense = !this.state.defenses.missileDefense;
      const requiredBudget =
        DEFENSE_ECONOMY.droneActivation + (needsMissileDefense ? DEFENSE_ECONOMY.missileActivation : 0);

      if (this.state.treasury < requiredBudget) {
        this.pushEvent(
          "Cannot activate Drone Retaliation: need " + formatMoney(requiredBudget) + " in treasury."
        );
        return;
      }

      if (needsMissileDefense) {
        this.state.treasury -= DEFENSE_ECONOMY.missileActivation;
        this.state.defenses.missileDefense = true;
        this.missileDefenseBtn.classList.add("active");
        this.pushEvent("Missile Defense auto-enabled to support Drone Retaliation.");
      }

      this.state.treasury -= DEFENSE_ECONOMY.droneActivation;
      this.state.defenses.drone = true;
      this.droneBtn.classList.add("active");
      this.updateDefenseButtons();
      this.updateHud();
      this.pushEvent("Drone Retaliation online.");
      return;
    }

    this.state.defenses.drone = false;
    this.droneBtn.classList.remove("active");
    this.updateDefenseButtons();
    this.updateHud();
    this.pushEvent("Drone Retaliation offline.");
  }

  toggleMissileDefense() {
    if (!this.state.running) return;

    if (!this.state.defenses.missileDefense) {
      if (this.state.treasury < DEFENSE_ECONOMY.missileActivation) {
        this.pushEvent("Cannot activate Missile Defense: treasury too low.");
        return;
      }

      this.state.treasury -= DEFENSE_ECONOMY.missileActivation;
    }

    this.state.defenses.missileDefense = !this.state.defenses.missileDefense;
    this.missileDefenseBtn.classList.toggle("active", this.state.defenses.missileDefense);

    if (!this.state.defenses.missileDefense && this.state.defenses.drone) {
      this.state.defenses.drone = false;
      this.droneBtn.classList.remove("active");
      this.pushEvent("Drone Retaliation offline because Missile Defense was disabled.");
    }

    this.updateDefenseButtons();
    this.updateHud();
    this.pushEvent("Missile Defense " + (this.state.defenses.missileDefense ? "online." : "offline."));
  }

  updateFrame(now) {
    if (!this.state.previousFrameAt) this.state.previousFrameAt = now;
    const dt = Math.min(0.05, (now - this.state.previousFrameAt) / 1000);
    this.state.previousFrameAt = now;

    if (this.state.running) {
      this.state.treasury += rand(TREASURY_DRIFT_PER_SECOND.min, TREASURY_DRIFT_PER_SECOND.max) * dt;
      this.state.stability += rand(-0.2, 0.18) * dt;

      this.updateDefenses(dt);
      this.tickThreats(dt);
      this.updateProjectiles(now);
      this.updateEffects(now);

      if (this.state.threats.length < 3 && Math.random() < dt * 0.7) this.spawnThreat();

      if (this.state.stability <= 0 || this.state.treasury <= BANKRUPTCY_THRESHOLD) {
        this.endSimulation();
      }
    }

    this.draw(now);

    if (now >= this.state.nextUiRefreshAt) {
      this.renderThreatList();
      this.updateHud();
      this.state.nextUiRefreshAt = now + 180;
    }

    requestAnimationFrame(this.updateFrame);
  }

  endSimulation() {
    this.stop();
    this.state.projectiles = [];
    this.state.effects = [];
    this.state.selectedThreatId = null;
    this.pushEvent("Command center dissolved into hearings and resignation letters.");
    this.instructionText.textContent = "Simulation over. Refresh page to retry this noble project.";
    this.updateHud();
  }

  draw(now) {
    this.terrain.drawBase(this.ctx);
    this.drawTacticalGrid();
    this.drawRoadLinks();
    this.drawEntities();
    this.drawThreats(now);
    this.drawProjectiles(now);
    this.drawEffects(now);
    this.drawHudMarks();
  }

  drawTacticalGrid() {
    const grid = 64;

    this.ctx.strokeStyle = "rgba(233, 245, 248, 0.06)";
    this.ctx.lineWidth = 1;

    for (let x = 0; x < this.canvas.width; x += grid) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    for (let y = 0; y < this.canvas.height; y += grid) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }

    this.ctx.fillStyle = "rgba(236, 246, 248, 0.45)";
    this.ctx.font = "10px 'IBM Plex Mono', monospace";

    for (let x = 0; x < this.canvas.width; x += grid) {
      const label = String.fromCharCode(65 + ((x / grid) % 26));
      this.ctx.fillText(label, x + 4, 12);
    }

    for (let y = 0; y < this.canvas.height; y += grid) {
      this.ctx.fillText(String(Math.floor(y / grid) + 1), 4, y + 14);
    }
  }

  drawRoadLinks() {
    this.ctx.strokeStyle = "rgba(210, 204, 176, 0.24)";
    this.ctx.lineWidth = 1.3;

    this.state.links.forEach((link) => {
      this.ctx.beginPath();
      this.ctx.moveTo(link.ax, link.ay);
      this.ctx.lineTo(link.bx, link.by);
      this.ctx.stroke();
    });
  }

  drawEntities() {
    this.state.entities.forEach((entity) => {
      const style = ENTITY_STYLE[entity.type] || ENTITY_STYLE.building;
      this.ctx.fillStyle = style.color;

      switch (entity.type) {
        case "city": {
          this.ctx.fillRect(entity.x - entity.size, entity.y - entity.size, entity.size * 2, entity.size * 2);
          break;
        }
        case "base": {
          this.ctx.beginPath();
          this.ctx.moveTo(entity.x, entity.y - entity.size);
          this.ctx.lineTo(entity.x + entity.size, entity.y - entity.size * 0.2);
          this.ctx.lineTo(entity.x + entity.size * 0.6, entity.y + entity.size);
          this.ctx.lineTo(entity.x - entity.size * 0.6, entity.y + entity.size);
          this.ctx.lineTo(entity.x - entity.size, entity.y - entity.size * 0.2);
          this.ctx.closePath();
          this.ctx.fill();
          break;
        }
        case "hospital": {
          const arm = entity.size;
          this.ctx.fillRect(entity.x - arm / 3, entity.y - arm, arm / 1.5, arm * 2);
          this.ctx.fillRect(entity.x - arm, entity.y - arm / 3, arm * 2, arm / 1.5);
          break;
        }
        case "factory": {
          this.ctx.fillRect(entity.x - entity.size, entity.y - entity.size * 0.55, entity.size * 2, entity.size * 1.1);
          this.ctx.fillRect(entity.x - entity.size * 0.92, entity.y - entity.size * 1.25, entity.size * 0.35, entity.size * 0.7);
          this.ctx.fillRect(entity.x + entity.size * 0.28, entity.y - entity.size * 1.05, entity.size * 0.35, entity.size * 0.5);
          break;
        }
        case "power": {
          this.ctx.beginPath();
          this.ctx.moveTo(entity.x - entity.size * 0.2, entity.y - entity.size);
          this.ctx.lineTo(entity.x + entity.size * 0.28, entity.y - entity.size * 0.25);
          this.ctx.lineTo(entity.x - entity.size * 0.02, entity.y - entity.size * 0.25);
          this.ctx.lineTo(entity.x + entity.size * 0.2, entity.y + entity.size);
          this.ctx.lineTo(entity.x - entity.size * 0.4, entity.y + entity.size * 0.16);
          this.ctx.lineTo(entity.x - entity.size * 0.1, entity.y + entity.size * 0.16);
          this.ctx.closePath();
          this.ctx.fill();
          break;
        }
        case "building": {
          this.ctx.beginPath();
          this.ctx.moveTo(entity.x, entity.y - entity.size);
          this.ctx.lineTo(entity.x + entity.size, entity.y + entity.size);
          this.ctx.lineTo(entity.x - entity.size, entity.y + entity.size);
          this.ctx.closePath();
          this.ctx.fill();
          break;
        }
        default: {
          this.ctx.beginPath();
          this.ctx.arc(entity.x, entity.y, entity.size, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      if (style.label) {
        this.ctx.fillStyle = "rgba(235, 241, 244, 0.78)";
        this.ctx.font = "10px 'IBM Plex Mono', monospace";
        this.ctx.fillText(entity.name, entity.x + entity.size + 4, entity.y - entity.size);
      }
    });
  }

  drawThreats(now) {
    this.state.threats.forEach((threat) => {
      const pulse = 1 + Math.sin(now * 0.004 + threat.id) * 0.17;
      const radius = threat.radius * pulse;
      const palette = this.getThreatPalette(threat.type);

      this.ctx.fillStyle = palette.fill;
      this.ctx.beginPath();
      this.ctx.arc(threat.x, threat.y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = palette.stroke;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(threat.x, threat.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.strokeStyle = palette.outer;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.arc(threat.x, threat.y, radius + 8, 0, Math.PI * 2);
      this.ctx.stroke();

      this.drawThreatMarker(threat, Math.max(6, radius * 0.34), now, palette.marker, threat.id === this.state.selectedThreatId);

      this.ctx.fillStyle = "rgba(255, 235, 235, 0.94)";
      this.ctx.font = "11px 'IBM Plex Mono', monospace";
      this.ctx.fillText(threat.type.toUpperCase() + " " + threat.timer.toFixed(1) + "s", threat.x + radius + 4, threat.y - 2);

      if (threat.id === this.state.selectedThreatId) {
        this.ctx.strokeStyle = "#f7b73f";
        this.ctx.setLineDash([5, 3]);
        this.ctx.beginPath();
        this.ctx.arc(threat.x, threat.y, radius + 14, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
      }
    });
  }

  drawProjectiles(now) {
    this.state.projectiles.forEach((projectile) => {
      const progress = Math.min(1, (now - projectile.start) / projectile.duration);

      if (projectile.animation === "airstrike") {
        this.drawAirstrikeProjectile(projectile, progress);
      } else if (projectile.animation === "convoy") {
        this.drawConvoyProjectile(projectile, progress, now);
      } else {
        this.drawBallisticProjectile(projectile, progress);
      }
    });

    this.ctx.setLineDash([]);
    this.ctx.lineCap = "butt";
  }

  drawBallisticProjectile(projectile, progress) {
    const trailStartProgress = Math.max(0, progress - 0.28);
    const tip = this.getProjectilePoint(projectile, progress);
    const trailStart = this.getProjectilePoint(projectile, trailStartProgress);
    const rear = this.getProjectilePoint(projectile, Math.max(0, progress - 0.06));
    const angle = Math.atan2(tip.y - rear.y, tip.x - rear.x);

    const trailGradient = this.ctx.createLinearGradient(trailStart.x, trailStart.y, tip.x, tip.y);
    if (projectile.weaponId === "big-missiles") {
      trailGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      trailGradient.addColorStop(0.45, "rgba(255, 184, 122, 0.26)");
      trailGradient.addColorStop(1, "rgba(255, 152, 106, 0.84)");
    } else {
      trailGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      trailGradient.addColorStop(0.4, "rgba(255, 214, 130, 0.24)");
      trailGradient.addColorStop(1, "rgba(255, 232, 170, 0.72)");
    }

    this.ctx.strokeStyle = trailGradient;
    this.ctx.lineWidth = projectile.trailWidth;
    this.ctx.lineCap = "round";
    this.ctx.beginPath();

    const segments = 11;
    for (let i = 0; i <= segments; i++) {
      const t = trailStartProgress + (progress - trailStartProgress) * (i / segments);
      const point = this.getProjectilePoint(projectile, t);
      if (i === 0) this.ctx.moveTo(point.x, point.y);
      else this.ctx.lineTo(point.x, point.y);
    }

    this.ctx.stroke();

    this.ctx.fillStyle = projectile.weaponId === "big-missiles" ? "rgba(255, 145, 95, 0.42)" : "rgba(255, 191, 124, 0.38)";
    this.ctx.beginPath();
    this.ctx.arc(rear.x, rear.y, projectile.spriteSize * 0.82, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.save();
    this.ctx.translate(tip.x, tip.y);
    this.ctx.rotate(angle);
    this.ctx.fillStyle = projectile.weaponId === "big-missiles" ? "#ffd1a0" : "#ffe8bf";
    this.ctx.beginPath();
    this.ctx.moveTo(projectile.spriteSize + 2, 0);
    this.ctx.lineTo(-projectile.spriteSize, -projectile.spriteSize * 0.62);
    this.ctx.lineTo(-projectile.spriteSize * 0.35, 0);
    this.ctx.lineTo(-projectile.spriteSize, projectile.spriteSize * 0.62);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  drawAirstrikeProjectile(projectile, progress) {
    const trailStartProgress = Math.max(0, progress - 0.4);
    const tip = this.getLinearProjectilePoint(projectile, progress);
    const rear = this.getLinearProjectilePoint(projectile, Math.max(0, progress - 0.06));
    const angle = Math.atan2(tip.y - rear.y, tip.x - rear.x);

    this.ctx.strokeStyle = "rgba(198, 231, 255, 0.5)";
    this.ctx.lineWidth = projectile.trailWidth;
    this.ctx.lineCap = "round";
    this.ctx.setLineDash([10, 7]);
    this.ctx.beginPath();

    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const t = trailStartProgress + (progress - trailStartProgress) * (i / segments);
      const point = this.getLinearProjectilePoint(projectile, t);
      if (i === 0) this.ctx.moveTo(point.x, point.y);
      else this.ctx.lineTo(point.x, point.y);
    }

    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.save();
    this.ctx.translate(tip.x, tip.y);
    this.ctx.rotate(angle);

    this.ctx.fillStyle = "#d5ebff";
    this.ctx.beginPath();
    this.ctx.moveTo(projectile.spriteSize + 2, 0);
    this.ctx.lineTo(-projectile.spriteSize, -projectile.spriteSize * 0.8);
    this.ctx.lineTo(-projectile.spriteSize * 0.22, 0);
    this.ctx.lineTo(-projectile.spriteSize, projectile.spriteSize * 0.8);
    this.ctx.closePath();
    this.ctx.fill();

    this.ctx.fillStyle = "rgba(176, 222, 255, 0.7)";
    this.ctx.fillRect(-projectile.spriteSize * 1.2, -1, projectile.spriteSize * 0.7, 2);
    this.ctx.restore();

    if (Array.isArray(projectile.clusterLine) && projectile.clusterLine.length) {
      const dropStart = projectile.dropProgress - 0.12;
      const dropEnd = projectile.dropProgress + 0.08;

      if (progress >= dropStart && progress <= dropEnd) {
        const phase = clamp((progress - dropStart) / (dropEnd - dropStart), 0, 1);

        projectile.clusterLine.forEach((dropPoint, index) => {
          const delay = index * 0.08;
          const local = clamp((phase - delay) / 0.75, 0, 1);
          if (local <= 0) return;

          const bombX = dropPoint.x - projectile.dirX * (1 - local) * 26;
          const bombY = dropPoint.y - (1 - local) * 38;

          this.ctx.strokeStyle = "rgba(255, 235, 178, " + (0.35 + local * 0.4).toFixed(3) + ")";
          this.ctx.lineWidth = 1.3;
          this.ctx.beginPath();
          this.ctx.moveTo(bombX, bombY - 5);
          this.ctx.lineTo(bombX, bombY + 5);
          this.ctx.stroke();

          this.ctx.fillStyle = "rgba(255, 232, 170, " + (0.55 + local * 0.35).toFixed(3) + ")";
          this.ctx.beginPath();
          this.ctx.arc(bombX, bombY, 2.2, 0, Math.PI * 2);
          this.ctx.fill();
        });
      }
    }
  }

  drawConvoyProjectile(projectile, progress, now) {
    const advanceEnd = projectile.phaseAdvance;
    const fightEnd = projectile.phaseAdvance + projectile.phaseFight;

    let phase = "advance";
    let anchor;
    let heading;

    if (progress < advanceEnd) {
      const local = advanceEnd <= 0 ? 1 : progress / advanceEnd;
      anchor = this.getProjectilePoint(projectile, local);
      heading = this.getProjectilePoint(projectile, Math.min(1, local + 0.02));
      phase = "advance";
    } else if (progress < fightEnd) {
      const sway = Math.sin(now * 0.011 + projectile.wobbleSeed) * 2.8;
      anchor = {
        x: projectile.targetX + Math.cos(now * 0.009 + projectile.wobbleSeed) * 2.4,
        y: projectile.targetY + sway
      };
      heading = {
        x: anchor.x + Math.sign(projectile.targetX - projectile.sx || 1),
        y: anchor.y
      };
      phase = "fight";
    } else {
      const retreatSpan = Math.max(0.001, 1 - fightEnd);
      const local = (progress - fightEnd) / retreatSpan;
      anchor = {
        x: projectile.targetX + (projectile.sx - projectile.targetX) * local,
        y: projectile.targetY + (projectile.sy - projectile.targetY) * local
      };
      heading = {
        x: projectile.targetX + (projectile.sx - projectile.targetX) * Math.min(1, local + 0.02),
        y: projectile.targetY + (projectile.sy - projectile.targetY) * Math.min(1, local + 0.02)
      };
      phase = "retreat";
    }

    const angle = Math.atan2(heading.y - anchor.y, heading.x - anchor.x);
    const perpendicular = angle + Math.PI / 2;

    this.ctx.strokeStyle = phase === "fight" ? "rgba(232, 202, 144, 0.45)" : "rgba(198, 215, 148, 0.56)";
    this.ctx.lineWidth = projectile.trailWidth;
    this.ctx.lineCap = "round";
    this.ctx.setLineDash(phase === "fight" ? [2, 4] : [4, 5]);
    this.ctx.beginPath();

    const lineStart = this.getProjectilePoint(projectile, Math.max(0, progress - 0.5));
    this.ctx.moveTo(lineStart.x, lineStart.y);
    this.ctx.lineTo(anchor.x, anchor.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    const unitCount = 5;
    for (let i = 0; i < unitCount; i++) {
      const spread = i - (unitCount - 1) / 2;
      const unitX = anchor.x + Math.cos(perpendicular) * spread * 7;
      const unitY = anchor.y + Math.sin(perpendicular) * spread * 7;

      this.ctx.save();
      this.ctx.translate(unitX, unitY);
      this.ctx.rotate(angle);

      this.ctx.fillStyle = "#c8d48a";
      this.ctx.fillRect(-projectile.spriteSize * 0.8, -projectile.spriteSize * 0.36, projectile.spriteSize * 1.6, projectile.spriteSize * 0.72);
      this.ctx.fillStyle = "#7f8f55";
      this.ctx.fillRect(projectile.spriteSize * 0.2, -projectile.spriteSize * 0.25, projectile.spriteSize * 0.34, projectile.spriteSize * 0.5);

      if (phase === "fight") {
        this.ctx.fillStyle = "rgba(255, 231, 166, 0.86)";
        this.ctx.fillRect(projectile.spriteSize * 0.9, -1, 2, 2);
      }

      this.ctx.restore();
    }

    if (phase === "fight") {
      for (let flash = 0; flash < 4; flash++) {
        const pulse = (Math.sin(now * 0.02 + flash + projectile.wobbleSeed) + 1) * 0.5;
        const fx = projectile.targetX + Math.cos(flash * 1.4) * (10 + pulse * 8);
        const fy = projectile.targetY + Math.sin(flash * 1.1) * (8 + pulse * 7);
        this.ctx.fillStyle = "rgba(255, 210, 140, " + (0.25 + pulse * 0.5).toFixed(3) + ")";
        this.ctx.beginPath();
        this.ctx.arc(fx, fy, 1.4 + pulse * 1.5, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  getThreatPalette(type) {
    return THREAT_PALETTES[type] || THREAT_PALETTES.insurgent;
  }

  drawThreatMarker(threat, size, now, color, selected) {
    const wobble = Math.sin(now * 0.006 + threat.id) * 0.35;
    const markerSize = size + wobble;

    this.ctx.save();
    this.ctx.translate(threat.x, threat.y);

    if (threat.marker === "diamond") {
      this.ctx.rotate(Math.PI / 4);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.6 : 1.9;
      this.ctx.strokeRect(-markerSize * 0.8, -markerSize * 0.8, markerSize * 1.6, markerSize * 1.6);
    } else if (threat.marker === "triangle") {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.6 : 1.9;
      this.ctx.beginPath();
      this.ctx.moveTo(0, -markerSize);
      this.ctx.lineTo(markerSize * 0.95, markerSize * 0.75);
      this.ctx.lineTo(-markerSize * 0.95, markerSize * 0.75);
      this.ctx.closePath();
      this.ctx.stroke();
    } else if (threat.marker === "square") {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.6 : 1.9;
      this.ctx.strokeRect(-markerSize * 0.9, -markerSize * 0.9, markerSize * 1.8, markerSize * 1.8);
    } else if (threat.marker === "hex") {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.6 : 1.9;
      this.ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i + Math.PI / 6;
        const x = Math.cos(angle) * markerSize;
        const y = Math.sin(angle) * markerSize;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.closePath();
      this.ctx.stroke();
    } else if (threat.marker === "cross") {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.8 : 2;
      this.ctx.beginPath();
      this.ctx.moveTo(-markerSize, -markerSize);
      this.ctx.lineTo(markerSize, markerSize);
      this.ctx.moveTo(markerSize, -markerSize);
      this.ctx.lineTo(-markerSize, markerSize);
      this.ctx.stroke();
    } else if (threat.marker === "reticle") {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.6 : 1.8;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, markerSize, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(-markerSize - 4, 0);
      this.ctx.lineTo(markerSize + 4, 0);
      this.ctx.moveTo(0, -markerSize - 4);
      this.ctx.lineTo(0, markerSize + 4);
      this.ctx.stroke();
    } else if (threat.marker === "chevron") {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.8 : 2;
      this.ctx.beginPath();
      this.ctx.moveTo(-markerSize, -markerSize * 0.35);
      this.ctx.lineTo(0, markerSize * 0.9);
      this.ctx.lineTo(markerSize, -markerSize * 0.35);
      this.ctx.stroke();
    } else {
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = selected ? 2.6 : 1.9;
      this.ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const x = Math.cos(angle) * markerSize;
        const y = Math.sin(angle) * markerSize;
        if (i === 0) this.ctx.moveTo(x, y);
        else this.ctx.lineTo(x, y);
      }
      this.ctx.closePath();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  getProjectilePoint(projectile, t) {
    const oneMinus = 1 - t;
    return {
      x: oneMinus * oneMinus * projectile.sx + 2 * oneMinus * t * projectile.cpx + t * t * projectile.tx,
      y: oneMinus * oneMinus * projectile.sy + 2 * oneMinus * t * projectile.cpy + t * t * projectile.ty
    };
  }

  getLinearProjectilePoint(projectile, t) {
    return {
      x: projectile.sx + (projectile.tx - projectile.sx) * t,
      y: projectile.sy + (projectile.ty - projectile.sy) * t
    };
  }

  addImpactEffect(x, y, weaponId, now) {
    let maxRadius = 24;
    let duration = 420;
    let color = "255, 196, 136";
    let variant = "standard";

    if (weaponId === "big-missiles") {
      maxRadius = 78;
      duration = 980;
      color = "255, 146, 96";
      variant = "heavy";
    } else if (weaponId === "airplane") {
      maxRadius = 28;
      duration = 520;
      color = "176, 222, 255";
      variant = "cluster";
    } else if (weaponId === "ground-troops") {
      maxRadius = 18;
      duration = 360;
      color = "204, 226, 160";
      variant = "ground";
    }

    this.state.effects.push({
      x,
      y,
      start: now,
      duration,
      maxRadius,
      color,
      variant
    });

    if (weaponId === "big-missiles") {
      this.state.effects.push({
        x: x + rand(-16, 16),
        y: y + rand(-16, 16),
        start: now + 45,
        duration: duration * 0.72,
        maxRadius: maxRadius * 0.62,
        color: "255, 170, 118",
        variant: "heavy-secondary"
      });
      this.state.effects.push({
        x: x + rand(-24, 24),
        y: y + rand(-24, 24),
        start: now + 80,
        duration: duration * 0.56,
        maxRadius: maxRadius * 0.46,
        color: "255, 186, 136",
        variant: "heavy-secondary"
      });
    }
  }

  updateEffects(now) {
    this.state.effects = this.state.effects.filter((effect) => now - effect.start <= effect.duration);
  }

  drawEffects(now) {
    this.state.effects.forEach((effect) => {
      if (now < effect.start) return;

      const age = clamp((now - effect.start) / effect.duration, 0, 1);
      const radius = effect.maxRadius * (0.24 + age * 0.88);
      const alpha = 1 - age;

      this.ctx.fillStyle = "rgba(" + effect.color + ", " + (0.26 * alpha).toFixed(3) + ")";
      this.ctx.beginPath();
      this.ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = "rgba(" + effect.color + ", " + (0.76 * alpha).toFixed(3) + ")";
      this.ctx.lineWidth = effect.variant === "heavy" ? 3 : 2;
      this.ctx.beginPath();
      this.ctx.arc(effect.x, effect.y, radius * 0.82, 0, Math.PI * 2);
      this.ctx.stroke();

      if (effect.variant === "heavy" || effect.variant === "heavy-secondary") {
        this.ctx.strokeStyle = "rgba(" + effect.color + ", " + (0.55 * alpha).toFixed(3) + ")";
        this.ctx.lineWidth = effect.variant === "heavy" ? 2.4 : 1.6;
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, radius * 1.08, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.fillStyle = "rgba(255, 236, 196, " + (0.28 * alpha).toFixed(3) + ")";
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, radius * 0.34, 0, Math.PI * 2);
        this.ctx.fill();
      }

      if (effect.variant === "cluster") {
        this.ctx.strokeStyle = "rgba(" + effect.color + ", " + (0.42 * alpha).toFixed(3) + ")";
        this.ctx.lineWidth = 1.4;
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, radius * 0.54, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    });
  }

  drawHudMarks() {
    this.ctx.strokeStyle = "rgba(194, 214, 222, 0.35)";
    this.ctx.lineWidth = 1;

    this.ctx.beginPath();
    this.ctx.moveTo(this.canvas.width - 70, 14);
    this.ctx.lineTo(this.canvas.width - 14, 14);
    this.ctx.lineTo(this.canvas.width - 14, 70);
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(220, 233, 238, 0.65)";
    this.ctx.font = "10px 'IBM Plex Mono', monospace";
    this.ctx.fillText("N", this.canvas.width - 28, 32);
    this.ctx.fillText("RELIEF / TAC OVERLAY", 10, this.canvas.height - 10);
  }
}

window.CommandCenterGame = CommandCenterGame;
