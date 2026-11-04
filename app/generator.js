// Workout generator: builds a session from Dr. Jared's exercise library.
// Structure: optional warm-up → a circuit (exercises per round × rounds, with rest) → optional cool-down.
// Reps/holds live in PRESCRIBE so they can be tuned in one place.
(() => {
  const EX = window.MDFIT_EXERCISES || [];

  const GOALS = [
    { id: "upper", label: "Upper Body", icon: "upper", regions: ["SH", "UB", "EL", "WR", "NK"] },
    { id: "lower", label: "Lower Body", icon: "lower", regions: ["HP", "LB", "KN", "AN"] },
    { id: "full", label: "Full Body", icon: "full", regions: null },
    { id: "core", label: "Core & Spine", icon: "core", regions: ["CO", "SP"] },
    { id: "mobility", label: "Mobility & Recovery", icon: "mobility", regions: null, mobility: true }
  ];
  const LOCATIONS = [
    { id: "home", label: "Home", icon: "home" },
    { id: "gym", label: "Gym", icon: "gym" },
    { id: "outdoor", label: "Outdoor", icon: "outdoor" },
    { id: "office", label: "Office / Desk", icon: "office" }
  ];
  const LEVELS = [
    { id: "beginner", label: "Beginner", hint: "Build the foundation", min: 1, max: 3, bars: 1 },
    { id: "intermediate", label: "Intermediate", hint: "Progress and improve", min: 2, max: 6, bars: 2 },
    { id: "advanced", label: "Advanced", hint: "Challenge yourself", min: 4, max: 8, bars: 3 },
    { id: "elite", label: "Elite", hint: "Maximum intensity", min: 6, max: 9, bars: 4 }
  ];
  const LENGTHS = [15, 20, 30, 45, 60, 90];
  const PER_ROUND = [2, 3, 4, 5, 6, 8, 10];
  const ROUNDS = [1, 2, 3, 4, 5, 6, 8, 10];
  const REST_EX = [0, 15, 20, 30, 45, 60, 90];
  const REST_ROUND = [0, 30, 60, 90, 120, 180];
  const ADDONS = [
    { id: "warmup", label: "Warm-up", on: true },
    { id: "cooldown", label: "Cool-down", on: true },
    { id: "mobility", label: "Mobility / flexibility" },
    { id: "core", label: "Core work" },
    { id: "balance", label: "Balance / stability" },
    { id: "sport", label: "Sport specific (power)" },
    { id: "bodyweight", label: "No equipment" }
  ];
  const TITLES = { beginner: "Foundations", intermediate: "Strength", advanced: "Power", elite: "Performance" };

  // Per-round prescription for circuit moves; warm-up and cool-down use the same table
  const PRESCRIBE = {
    Strength: { beginner: "10 reps", intermediate: "10 reps", advanced: "8 reps", elite: "6 reps" },
    Power: { beginner: "6 reps", intermediate: "6 reps", advanced: "5 reps", elite: "4 reps" },
    Activation: { beginner: "10 reps", intermediate: "12 reps", advanced: "12 reps", elite: "15 reps" },
    Mobility: { beginner: "30 sec", intermediate: "45 sec", advanced: "60 sec", elite: "45 sec" },
    Rehab: { beginner: "8 slow reps", intermediate: "8 slow reps", advanced: "10 slow reps", elite: "12 slow reps" },
    Neuroglide: { beginner: "6 gentle reps", intermediate: "8 gentle reps", advanced: "10 gentle reps", elite: "10 gentle reps" },
    Posture: { beginner: "2 min", intermediate: "2 min", advanced: "3 min", elite: "3 min" },
    Lifestyle: { beginner: "Daily habit", intermediate: "Daily habit", advanced: "Daily habit", elite: "Daily habit" },
    "Desk & posture": { beginner: "Set up once", intermediate: "Set up once", advanced: "Set up once", elite: "Set up once" }
  };
  const prescription = (ex, level) => (PRESCRIBE[ex.cat] || PRESCRIBE.Mobility)[level] || "10 reps";
  // Rough seconds one set takes, for the time estimate
  const workSecs = (rx) => { const m = rx.match(/(\d+)\s*(sec|min)/); return m ? Number(m[1]) * (m[2] === "min" ? 60 : 1) : 45; };

  // Exercises that need gym equipment (when the filename doesn't say home/gym)
  const EQUIP = /\b(DB|KB|Cable|Bench|Barbell|Sled|Erg|Bike|Pulldown|Landmine|GHD|TRX|Rack|Med Ball|Heavy Bag|Pole|Box|Pull Up|Muscle Up|Deadlift|Swing|Wall Ball|Farmer|Clean|Thruster|Strict Press|Push Press|Kettlebell|Dumbbell|Row|Fly|Curl To Press|Lat)\b/i;
  const needsGym = (e) => e.loc === "gym" || (e.loc === "any" && EQUIP.test(e.name));
  const BALANCE = /balance|single leg|march|heel walk|toe walk/i;
  const WARM = ["Mobility", "Activation", "Neuroglide"];
  const COOL = ["Mobility", "Rehab", "Neuroglide"];
  const MAIN = ["Strength", "Power", "Activation"];

  function byLocation(loc) {
    if (loc === "gym") return EX.slice();
    if (loc === "outdoor") return EX.filter((e) => e.loc === "outdoor" || (!needsGym(e) && !e.seated));
    if (loc === "office") return EX.filter((e) => !needsGym(e) && (e.seated || ["NK", "ERG", "SP", "SH", "WR"].includes(e.rc)) && e.cat !== "Power");
    return EX.filter((e) => !needsGym(e) && e.loc !== "outdoor"); // home
  }

  // Small seeded RNG so "Shuffle" gives a new mix but a given seed is repeatable
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function pick(pool, n, rand, taken) {
    const out = [], avail = pool.filter((e) => !taken.has(e.id)).sort(() => rand() - 0.5);
    for (const e of avail) {
      if (out.length >= n) break;
      if (out.some((o) => o.name === e.name)) continue;
      out.push(e); taken.add(e.id);
    }
    return out;
  }

  const DEFAULTS = { type: "workout", goal: "full", location: "home", level: "intermediate", length: 45, perRound: 8, rounds: 5, restEx: 15, restRound: 45,
    addons: { warmup: true, cooldown: true } };

  // Estimated minutes for a plan, used for the summary and to fit rounds to a target length
  function estimate({ warm = 0, cool = 0, perRound, rounds, restEx, restRound, work = 45 }) {
    const secs = (warm + cool) * 75 + rounds * (perRound * work + (perRound - 1) * restEx) + (rounds - 1) * restRound;
    return Math.max(1, Math.round(secs / 60));
  }
  // Picking a length sets a sensible circuit for it; clients can still change exercises, rounds and rest
  const PRESETS = { 15: [4, 3, 15, 30], 20: [5, 3, 15, 45], 30: [6, 4, 15, 60], 45: [8, 5, 15, 45], 60: [8, 6, 20, 60], 90: [10, 7, 20, 90] };
  function presetFor(length) {
    const [perRound, rounds, restEx, restRound] = PRESETS[length] || PRESETS[45];
    return { perRound, rounds, restEx, restRound };
  }

  // Rehab vs exercise follows Dr. Jared's file labels (see app/library.js). Rehab moves never fill a workout's main circuit;
  // they belong in warm-ups, cool-downs and rehab sessions. Rehab sessions use rehab moves only, low levels, rehab dosing.
  const LIBK = () => (window.MDFitLib && window.MDFitLib.kind) || (() => "Exercise");
  const isEx = (e) => LIBK()(e) === "Exercise", isRehab = (e) => LIBK()(e) === "Rehab";
  function rehabRx(e) {
    const n = e.name;
    if (/hold|engagement|brace/i.test(n)) return "3 × 30-sec hold";
    if (/eccentric|drop/i.test(n)) return "3 × 8 slow (3-sec lowering)";
    if (/stretch|release|surrender|child|fold|breathing|open book|thread/i.test(n)) return "2 × 30 sec each side";
    if (/cars|circles|liftoff|neuroglide|rotation|switch|cat cow|flow/i.test(n)) return "2 × 8 slow each side";
    if (/walk|march|balance/i.test(n)) return "2 × 30 sec";
    return "2 × 12 controlled";
  }
  const TYPES = [{ id: "workout", label: "Workout", hint: "Strength, power and conditioning" }, { id: "rehab", label: "Rehab session", hint: "Corrective work for pain and recovery" }];

  function generate(input = {}) {
    const o = { ...DEFAULTS, ...input, addons: { ...DEFAULTS.addons, ...(input.addons || {}) }, seed: input.seed ?? Date.now() };
    const rehab = o.type === "rehab";
    const G = GOALS.find((g) => g.id === o.goal) || GOALS[2];
    const L = LEVELS.find((l) => l.id === o.level) || LEVELS[1];
    // Rehab: up to 6 moves, up to 3 rounds, and never above level 4
    const perRound = Math.min(rehab ? 6 : 10, Math.max(1, Number(o.perRound) || 5)), rounds = Math.min(rehab ? 3 : 10, Math.max(1, Number(o.rounds) || 1));
    const rand = rng(o.seed), taken = new Set();
    let pool = byLocation(o.location);
    if (o.addons.bodyweight) pool = pool.filter((e) => !needsGym(e));
    if (pool.length < perRound + 4) pool = EX.filter((e) => !needsGym(e));
    const inRegion = (e) => !G.regions || G.regions.includes(e.rc) || (G.id === "full" && e.rc === "FB");
    const inBand = (e, lo = L.min, hi = L.max) => e.level >= lo && e.level <= hi;
    const easy = (e) => e.level <= Math.min(L.max, 4);
    const nWarm = o.addons.warmup ? (o.length <= 15 ? 1 : 2) : 0, nCool = o.addons.cooldown ? (o.length <= 20 ? 1 : 2) : 0;

    // Warm-up: rehab-side prep (mobility / activation), easy, in the region when possible
    const warmOK = (e) => WARM.includes(e.cat) && easy(e) && isRehab(e);
    let warm = pick(pool.filter((e) => warmOK(e) && inRegion(e)), nWarm, rand, taken);
    if (warm.length < nWarm) warm.push(...pick(pool.filter(warmOK), nWarm - warm.length, rand, taken));
    // Mobility and balance add-ons are rehab-side work: they go in the warm-up, not the main circuit
    if (!rehab && o.addons.mobility && !G.mobility) warm.push(...pick(pool.filter((e) => e.cat === "Mobility" && isRehab(e) && inRegion(e) && easy(e)), 1, rand, taken));
    if (!rehab && o.addons.balance) warm.push(...pick(pool.filter((e) => BALANCE.test(e.name) && easy(e)), 1, rand, taken));

    const circuit = [];
    const slot = (list) => { if (circuit.length < perRound) circuit.push(...list.slice(0, perRound - circuit.length)); };
    const need = () => perRound - circuit.length;
    if (rehab || G.mobility) {
      const lvl = Math.min(L.max, rehab ? 4 : 5);
      const rp = pool.filter((e) => isRehab(e) && e.level <= lvl);
      slot(pick(rp.filter(inRegion), need(), rand, taken));
      if (need() > 0) slot(pick(rp, need(), rand, taken));
    } else {
      if (o.addons.core && G.id !== "core") slot(pick(pool.filter((e) => ["CO", "SP"].includes(e.rc) && isEx(e) && e.level <= L.max), 1, rand, taken));
      if (o.addons.sport) slot(pick(pool.filter((e) => (e.cat === "Power" || e.cc === "PWR") && isEx(e) && inBand(e, Math.max(1, L.min - 1), L.max)), 1, rand, taken));
      const mainPool = pool.filter((e) => isEx(e) && inRegion(e) && inBand(e));
      if (G.id === "full") {
        const groups = [["FB", "CO"], ["HP", "LB", "KN"], ["SH", "UB", "EL"]].map((rc) => mainPool.filter((e) => rc.includes(e.rc)));
        for (let i = 0; need() > 0 && i < perRound * 3; i++) slot(pick(groups[i % 3], 1, rand, taken));
      } else slot(pick(mainPool, need(), rand, taken));
      // Not enough at this level/location: widen the level band, then any region (still exercise only)
      if (need() > 0) slot(pick(pool.filter((e) => isEx(e) && inRegion(e)), need(), rand, taken));
      if (need() > 0) slot(pick(pool.filter((e) => isEx(e) && e.level <= L.max), need(), rand, taken));
      if (need() > 0) slot(pick(EX.filter((e) => isEx(e) && !needsGym(e) && e.level <= L.max), need(), rand, taken));
    }

    // Cool-down: stretching / mobility from the rehab side
    const coolOK = (e) => COOL.includes(e.cat) && easy(e) && isRehab(e);
    let cool = pick(pool.filter((e) => coolOK(e) && inRegion(e)), nCool, rand, taken);
    if (cool.length < nCool) cool.push(...pick(pool.filter(coolOK), nCool - cool.length, rand, taken));

    const rx = (e) => (rehab || isRehab(e) ? rehabRx(e) : prescription(e, L.id));
    const tag = (arr, block) => arr.map((e) => ({ ...e, block, sets: block === "Circuit" ? rx(e) : (isRehab(e) ? rehabRx(e) : prescription(e, L.id)) }));
    const w = tag(warm, "Warm-up"), c = tag(circuit, "Circuit"), d = tag(cool, "Cool-down");
    const restEx = rehab ? Math.max(30, Number(o.restEx) || 0) : Number(o.restEx) || 0, restRound = rehab ? Math.max(60, Number(o.restRound) || 0) : Number(o.restRound) || 0;
    const work = c.length ? Math.round(c.reduce((s, e) => s + workSecs(e.sets), 0) / c.length) : 45;
    return {
      title: rehab ? `Rehab Session: ${G.label}` : G.mobility ? "Mobility & Recovery Flow" : `${G.label} ${TITLES[L.id]}`,
      type: rehab ? "rehab" : "workout",
      note: rehab ? "Rehab rules: slow and controlled, pain no higher than 3/10 during or after. Stop any move that causes sharp pain." : "",
      goal: G.label, goalId: G.id, location: o.location, level: L.id, levelLabel: rehab ? "Rehab" : L.label,
      perRound: c.length, rounds, restEx, restRound, addons: o.addons,
      warmup: w, circuit: c, cooldown: d, exercises: [...w, ...c, ...d],
      minutes: estimate({ warm: w.length, cool: d.length, perRound: c.length, rounds, restEx, restRound, work }),
      seed: o.seed, createdAt: new Date().toISOString()
    };
  }

  // Seconds one move takes in the player: timed holds as written, reps at ~4s each (slow/gentle ~6s)
  function stepSecs(rx) {
    const t = String(rx).match(/(\d+)\s*(sec|min)/); if (t) return Number(t[1]) * (t[2] === "min" ? 60 : 1);
    const r = String(rx).match(/(\d+)\s*(slow|gentle)?\s*reps?/); if (r) return Math.max(30, Number(r[1]) * (r[2] ? 6 : 4));
    return 45;
  }

  // Replace one move with a random alternative that fits the same slot (same block, location, level and, when possible, category and body region)
  function swap(w, block, index, seed = Date.now()) {
    const key = block === "Warm-up" ? "warmup" : block === "Cool-down" ? "cooldown" : "circuit";
    const old = w[key][index]; if (!old) return w;
    const L = LEVELS.find((l) => l.id === w.level) || LEVELS[1];
    const used = new Set([...w.warmup, ...w.circuit, ...w.cooldown].map((e) => e.id));
    let pool = byLocation(w.location).filter((e) => !used.has(e.id) && e.name !== old.name);
    if (w.addons && w.addons.bodyweight) pool = pool.filter((e) => !needsGym(e));
    const easy = (e) => e.level <= Math.min(L.max, 4);
    const tiers = key === "warmup" ? [(e) => WARM.includes(e.cat) && easy(e) && e.rc === old.rc, (e) => WARM.includes(e.cat) && easy(e)]
      : key === "cooldown" ? [(e) => COOL.includes(e.cat) && easy(e) && e.rc === old.rc, (e) => COOL.includes(e.cat) && easy(e)]
      : w.type === "rehab" ? [(e) => isRehab(e) && e.rc === old.rc && e.level <= 4, (e) => isRehab(e) && e.level <= 4]
      : [(e) => e.cat === old.cat && e.rc === old.rc && e.level >= L.min && e.level <= L.max,
         (e) => e.cat === old.cat && e.level >= L.min && e.level <= L.max,
         (e) => e.rc === old.rc && MAIN.includes(e.cat) && e.level <= L.max,
         (e) => old.cat === e.cat && e.level <= L.max];
    const rand = rng(seed);
    const fits = key === "circuit" ? (w.type === "rehab" ? isRehab : isEx) : isRehab;
    for (const t of tiers) {
      const c = pool.filter((e) => t(e) && fits(e));
      if (c.length) {
        const n = c[Math.floor(rand() * c.length)];
        const list = w[key].slice(); list[index] = { ...n, block, sets: w.type === "rehab" || isRehab(n) ? rehabRx(n) : prescription(n, L.id) };
        const out = { ...w, [key]: list };
        out.exercises = [...out.warmup, ...out.circuit, ...out.cooldown];
        return out;
      }
    }
    return w;
  }

  window.MDFitGen = { TYPES, rehabRx, byLocation, swap, stepSecs, GOALS, LOCATIONS, LEVELS, LENGTHS, PER_ROUND, ROUNDS, REST_EX, REST_ROUND, ADDONS, DEFAULTS, generate, presetFor, estimate, prescription, needsGym };
})();
