// Video library taxonomy: Dr. Jared's five categories, primary joint and primary muscle for every exercise. window.MDFitLib
(function () {
  "use strict";
  const CATEGORIES = ["Strength training", "Stretching", "Rehabilitation", "Specialty movements", "Mobility"];
  const SPECIALTY = /burpee|snatch|clean|thruster|wall ball|jump|dash|sled|bike|muscle up|handstand|turkish|crab|bear|spider|sprawl|heavy bag|slam|carry|ghd|pistol|walk out|blaster|tutorial|habit|walk break/i;
  const STRETCH = /stretch|release|child|fold|surrender|open book|thread the needle|couch|breathing|pole squat/i;
  const REHAB = /rotator cuff|eccentric|neuroglide|nods|chin glide|cars|liftoff|clamshell|reset|external rotation|internal rotation|shoulder drop|scapular|floor slide|wrist|knee circles|core brace|balance|march|heel walk|toe walk|vibration/i;
  // Categories nest under the two kinds: Exercise = Strength training + Specialty movements (power & conditioning);
  // Rehab = Rehabilitation + Stretching + Mobility.
  const CAT_BY_KIND = { Exercise: ["Strength training", "Specialty movements"], Rehab: ["Rehabilitation", "Stretching", "Mobility"] };
  function category(e) {
    if (kind(e) === "Exercise") return e.cat === "Power" || (SPECIALTY.test(e.name) && e.cc !== "STR") || e.cc === "PWR" ? "Specialty movements" : "Strength training";
    if (STRETCH.test(e.name)) return "Stretching";
    if (e.cc === "MOB" || e.cat === "Mobility") return /neuroglide|cars|liftoff|clamshell|knee circles/i.test(e.name) ? "Rehabilitation" : "Mobility";
    return "Rehabilitation";
  }

  const JOINTS = ["Shoulders", "Elbows", "Wrists & hands", "Neck", "Spine & back", "Core", "Hips", "Knees", "Ankles & feet", "Full body", "Desk & lifestyle"];
  const RC_JOINT = { SH: "Shoulders", EL: "Elbows", WR: "Wrists & hands", NK: "Neck", SP: "Spine & back", CO: "Core", HP: "Hips", KN: "Knees", AN: "Ankles & feet", FB: "Full body", ERG: "Desk & lifestyle" };
  function joint(e) {
    if (e.rc === "LB") return /heel|toe|calf|rope|balance|march/i.test(e.name) ? "Ankles & feet" : "Knees";
    if (e.rc === "UB") return /curl/i.test(e.name) ? "Elbows" : "Shoulders";
    return RC_JOINT[e.rc] || "Full body";
  }

  // First match wins, so the more specific muscles come first
  const MUSCLE_RULES = [
    ["Shoulders (delts & cuff)", /handstand|pike push|scap push/i], ["Upper back & spine", /breathing/i],
    ["Triceps", /tricep|\bdips?\b/i], ["Biceps", /bicep|curl/i], ["Forearms & grip", /wrist|farmer/i],
    ["Calves & feet", /calf|toe walk|heel walk|ankle|jump rope/i], ["Neck & traps", /neck|trap|scalene|scm|chin glide|cervical|levator/i],
    ["Chest", /bench|push up|fly|pec/i], ["Back & lats", /row|pulldown|pull up|\blat\b|face pull|muscle up|rack pull|floor slide|retract/i],
    ["Shoulders (delts & cuff)", /press|raise|handstand|rotator|scap|serratus|shoulder|external rotation|internal rotation|clavicle|overhead/i],
    ["Hip flexors", /couch|surrender|pillow belt|hip drop|psoas/i],
    ["Hamstrings", /rdl|romanian|deadlift|hinge|pull through|swing/i], ["Glutes", /glute|hip thrust|bridge|clamshell|abduction|hip |hip$|90\/90|cossack/i],
    ["Quads", /squat|lunge|step up|sissy|knee|split|sled|box jump|long jump/i],
    ["Core & abs", /plank|dead bug|sit up|core|bear|landmine|slam|carry|get up|crawl/i],
    ["Upper back & spine", /thoracic|t-spine|cat cow|open book|thread|spine|child|fold|breathing|sit turn|mobility flow|posture/i]
  ];
  const MUSCLES = ["Neck & traps", "Chest", "Back & lats", "Shoulders (delts & cuff)", "Biceps", "Triceps", "Forearms & grip", "Core & abs", "Upper back & spine", "Hip flexors", "Glutes", "Hamstrings", "Quads", "Calves & feet", "Full body"];
  function muscle(e) { for (const [m, re] of MUSCLE_RULES) if (re.test(e.name)) return m; return "Full body"; }

  // Rehab vs exercise, from Dr. Jared's own file labels (_RHB rehab, _STR strength, _PWR power, _ACT activation, _MOB mobility)
  // RHB / neuroglides / posture = rehab. STR / PWR = exercise. ACT and MOB split by what the movement is for:
  // corrective activation and joint mobility are rehab; conditioning and athletic movements are exercise.
  const KINDS = ["Exercise", "Rehab"];
  const ACT_REHAB = /chin glide|nods|core brace|floor slide|scapular|rotator cuff|heel walk|toe walk|march|balance|wrist circles|constant glute|glute walk|glute kick|glute bridge/i;
  const MOB_EXERCISE = /burpee|snatch|crab|spider|sprawl|turkish|wall ball|heavy bag|pistol|dash|box jump|muscle up|handstand|ghd|pike bear|walk out|swing|hip thrust|bulgarian|cossack|trx squat|straight arm pulldown/i;
  function kind(e) {
    if (["RHB", "NG", "POS", "ERG", "LIF"].includes(e.cc)) return "Rehab";
    if (["STR", "PWR"].includes(e.cc)) return "Exercise";
    if (e.cc === "ACT") return ACT_REHAB.test(e.name) ? "Rehab" : "Exercise";
    if (e.cc === "MOB") return MOB_EXERCISE.test(e.name) ? "Exercise" : "Rehab";
    return e.cat === "Rehab" ? "Rehab" : "Exercise";
  }

  window.MDFitLib = { CATEGORIES, CAT_BY_KIND, JOINTS, MUSCLES, KINDS, category, joint, muscle, kind };
})();
