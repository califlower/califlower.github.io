(function () {
  const ECONOMY_SCALE = 10;
  const scaleMoney = (amount) => amount * ECONOMY_SCALE;

  window.TopSecretConfig = {
    PASSCODE: "1234",
    TERMINAL_LINE:
      "Welcome to our Dallas, Texas SCIF. Make no mistake: this is our most secure facility, despite being under a Buc-ee's. Here, you will coordinate the war effort against our foreign adversaries. Buc-ee up.",

    ECONOMY_SCALE,
    scaleMoney,

    STARTING_TREASURY: scaleMoney(180000),
    BANKRUPTCY_THRESHOLD: scaleMoney(-5000),
    THREAT_FAILURE_DAMAGE_BASE: scaleMoney(900),

    THREAT_CLEAR_REWARD: {
      min: scaleMoney(80),
      max: scaleMoney(460)
    },

    TREASURY_DRIFT_PER_SECOND: {
      min: scaleMoney(-180),
      max: scaleMoney(260)
    },

    RANDOM_EVENT_SWING: {
      min: scaleMoney(-1400),
      max: scaleMoney(1600)
    },

    DEFENSE_ECONOMY: {
      droneActivation: scaleMoney(900),
      droneUpkeep: scaleMoney(120),
      missileActivation: scaleMoney(1600),
      missileUpkeep: scaleMoney(180)
    },

    WEAPONS: [
      {
        id: "missiles",
        name: "Missiles",
        cost: scaleMoney(1800),
        speed: 1.55,
        power: 34,
        effects: { insurgent: 1.15, armor: 0.7, air: 0.45, cyber: 0.6 },
        note: "Baseline precision strike. Still expensive."
      },
      {
        id: "big-missiles",
        name: "Big Missiles",
        cost: scaleMoney(9000),
        speed: 1.05,
        power: 78,
        radius: 96,
        effects: { insurgent: 0.95, armor: 1.25, air: 0.65, cyber: 0.4 },
        note: "Budget-shredding splash option for dense targets."
      },
      {
        id: "airplane",
        name: "Airplane",
        cost: scaleMoney(5200),
        speed: 1.25,
        power: 40,
        effects: { insurgent: 1.0, armor: 0.8, air: 1.2, cyber: 0.55 },
        note: "High-cost flyover strike package."
      },
      {
        id: "ground-troops",
        name: "Ground Troops",
        cost: scaleMoney(3800),
        speed: 0.82,
        power: 20,
        suppression: true,
        effects: { insurgent: 1.3, armor: 0.45, air: 0.2, cyber: 0.75 },
        note: "Very costly, slow formation with sustained pressure."
      }
    ],

    THREAT_TYPES: ["insurgent", "armor", "air", "cyber"],

    THREAT_CALLOUTS: {
      insurgent: ["INSURGENTS IN THIS AREA", "CELL CHATTER DETECTED", "TRUCK-BED MILITIA SPOTTED"],
      armor: ["ARMORED CARAVAN ADVANCING", "TECHNICAL COLUMN FORMING", "HEAVY ROLLING STOCK"],
      air: ["ROGUE AIRFRAME INBOUND", "UNMARKED FLYING OBJECT", "JET NOISE OVER TAX DISTRICT"],
      cyber: ["MEME WARFARE ESCALATION", "SERVER FARM DISTRESS", "BOT SWARM SIGNAL SPIKE"]
    },

    WORLD_EVENT_LINES: [
      "Amazon tax bill increases again; procurement office celebrates new spreadsheet tabs.",
      "Committee subpoenas command center coffee budget.",
      "Defense lobbyist suggests adding gold-plated map legends.",
      "Public survey says 54% are impressed by blinking lights.",
      "Regional senator requests honorary missile naming rights.",
      "Warehouse near Buc-ee's requests hazard pay and kolache subsidy.",
      "Unplanned contractor retreat charges filed to emergency line-item."
    ],

    COMMANDER_LINES: [
      "Tap any threat once to auto-select and fire your active weapon.",
      "Missile Defense has to be online before Drone Retaliation can launch.",
      "Defenses have upkeep; budget panic is a valid tactical condition.",
      "Prioritize low timers first, then optimize for weapon matchups.",
      "Insurgent callouts are loud, but armor usually drains treasury harder.",
      "Keep stability above 30% or oversight staff will swarm your desk."
    ],

    ENTITY_COUNT: 40,

    ENTITY_TYPE_WEIGHTS: [
      "city",
      "city",
      "town",
      "town",
      "town",
      "hospital",
      "factory",
      "base",
      "power",
      "building",
      "building",
      "building",
      "building"
    ],

    ENTITY_STYLE: {
      city: { size: 7, color: "#98d7f5", label: true },
      town: { size: 5, color: "#cad8dd", label: true },
      hospital: { size: 6, color: "#a0ffc9", label: true },
      factory: { size: 6, color: "#f0d083", label: true },
      base: { size: 7, color: "#b9cbe2", label: true },
      power: { size: 6, color: "#9de9a2", label: true },
      building: { size: 4, color: "#f6d095", label: false }
    },

    ENTITY_NAME_BITS: ["Eagle", "Pecan", "Lone", "River", "Metro", "Ranch", "Union", "Dry", "Mesa", "Yard"],

    ENTITY_SUFFIXES: {
      city: ["City", "Metro", "District", "Capital"],
      town: ["Town", "Crossing", "Junction", "Heights"],
      hospital: ["Medical", "Hospital", "Trauma", "Care"],
      factory: ["Forge", "Fabrication", "Works", "Mill"],
      base: ["Garrison", "Airbase", "Fort", "Command"],
      power: ["Grid", "Plant", "Substation", "Reactor"],
      building: ["Depot", "Yards", "Plant", "Hub"]
    }
  };
})();
