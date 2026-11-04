// Muscle-level pain finder data: which muscles commonly refer pain to a spot (classic trigger-point
// referral patterns, plus Dr. Jared's guides), what aggravates them, and which of his videos help.
// Educational only. Shared by the homepage pain map and the client app's Pain Tool.
(() => {
  // worse: aggravator tags (see AGGRAVATORS). videos: exact names from the exercise library. guide: Dr. Jared's guide id.
  const M = {
    "ext-oblique": { name: "External oblique", does: "Rotates and side-bends the trunk; wraps the side of the abdomen.", refers: "Abdominal wall, the side of the belly and down into the groin; can feel like heartburn or a side stitch.", worse: ["turning", "breathing", "running"], videos: ["Thread The Needle", "Lying Open Book", "Baseball Cable Stretch"] },
    "ant-delt": { name: "Anterior deltoid (front delt)", does: "Lifts the arm forward and turns it inward; the main mover in pressing and front raises.", refers: "Front of the shoulder and down the front of the upper arm, close to the muscle itself. Often blamed on the joint.", worse: ["overhead", "gripping"], videos: ["Scapular CARs", "Shoulder Drop Hold", "Wall Push Up"] },
    "lat-delt": { name: "Lateral deltoid (middle delt)", does: "Lifts the arm out to the side; holds the arm up when carrying or working at shoulder height.", refers: "Outside of the shoulder cap and the side of the upper arm toward the deltoid's insertion.", worse: ["overhead", "gripping", "sleeping"], videos: ["Lateral Raise", "Scapular CARs", "Shoulder Drop Hold"] },
    "post-delt": { name: "Posterior deltoid (rear delt)", does: "Pulls the arm back and turns it outward; works in rows and reaching behind.", refers: "Back of the shoulder and the back of the upper arm.", worse: ["reaching-back", "gripping"], videos: ["Face Pull", "Rotator Cuff External Rotation", "Floor Slide Scapular Retract"] },
    "teres-major": { name: "Teres major", does: "The lat's little helper: pulls the arm down, back and inward.", refers: "Back of the shoulder and the back of the upper arm, sometimes the back of the forearm. Hurts reaching up and forward.", worse: ["overhead", "gripping"], videos: ["Dynamic Childs Pose", "Thread The Needle", "Lat Pulldown"], guide: "rotator-cuff" },
    "pec-major-clav": { name: "Pectoralis major, upper (clavicular) head", does: "Raises the arm forward and across the body; the 'upper chest' in incline pressing.", refers: "Front of the shoulder over the front delt, often mistaken for a front-shoulder joint problem.", worse: ["overhead", "screens", "gripping"], videos: ["Baseball Cable Stretch", "Thoracic Open Book", "Wall Push Up"] },
    "pec-major-stern": { name: "Pectoralis major, lower (sternal) head", does: "Pulls the arm down and across the chest; the main 'chest' in pressing and hugging.", refers: "Front of the chest, down the inner arm to the inner elbow and the ring and little fingers. Chest pain must be checked by a doctor first.", worse: ["screens", "breathing", "gripping"], videos: ["Baseball Cable Stretch", "Lying Open Book", "Thoracic Extension Over Chair"] },
    "subclavius": { name: "Subclavius", does: "Small muscle under the collarbone that steadies it against the breastbone.", refers: "Under the collarbone and down the front of the arm and forearm into the thumb, index and middle fingers.", worse: ["breathing", "overhead", "gripping"], videos: ["Baseball Cable Stretch", "90/90 Breathing", "Thoracic Open Book"] },
    "coracobrachialis": { name: "Coracobrachialis", does: "Deep upper-arm muscle that pulls the arm forward and toward the body.", refers: "Front of the shoulder, the back of the upper arm and forearm, and the back of the hand toward the middle finger.", worse: ["overhead", "reaching-back"], videos: ["Baseball Cable Stretch", "Shoulder Drop Hold"] },
    "biceps-long": { name: "Biceps, long head", does: "Bends the elbow, turns the palm up and helps hold the ball of the shoulder in its socket.", refers: "Front of the shoulder over the biceps groove and down the front of the arm toward the elbow crease.", worse: ["overhead", "gripping"], videos: ["Baseball Cable Stretch", "Eccentric Wrist Pronator", "Bicep Curl"] },
    "biceps-short": { name: "Biceps, short head", does: "Bends the elbow and pulls the arm forward and across the body.", refers: "Front of the shoulder near the collarbone tip, the inner front of the arm and the elbow crease.", worse: ["gripping"], videos: ["Baseball Cable Stretch", "Bicep Curl", "Eccentric Wrist Pronator"] },
    "triceps-long": { name: "Triceps, long head", does: "Straightens the elbow and pulls the arm back; the only triceps head that crosses the shoulder.", refers: "Back of the shoulder and arm, up toward the base of the neck, and down the back of the forearm.", worse: ["overhead", "gripping"], videos: ["Tricep Extension", "Thread The Needle", "Overhead Tricep Extension"] },
    "triceps-lateral": { name: "Triceps, lateral head", does: "Straightens the elbow; the outer 'horseshoe' of the back of the arm.", refers: "Back of the upper arm and the outside of the elbow, a common tennis-elbow look-alike, and the back of the forearm.", worse: ["gripping"], videos: ["Tricep Kickback", "Tricep Extension"] },
    "triceps-medial": { name: "Triceps, medial head", does: "Deep head that straightens the elbow in every push.", refers: "The point of the elbow and the inner elbow, a golfer's-elbow look-alike, sometimes the ring and little fingers.", worse: ["gripping"], videos: ["Tricep Extension", "Eccentric Wrist Pronator"] },
    "middle-trap": { name: "Middle trapezius", does: "Pulls the shoulder blades together and holds them back.", refers: "Burning ache between the shoulder blade and the spine, and the top of the shoulder.", worse: ["screens", "gripping"], videos: ["Floor Slide Scapular Retract", "Face Pull", "Thoracic Extension Over Chair"] },
    "lower-trap": { name: "Lower trapezius", does: "Pulls the shoulder blades down and rotates them up so the arm can go overhead.", refers: "Up the back of the neck to the base of the skull, the top of the shoulder, and along the inner shoulder blade. A hidden driver of neck tension.", worse: ["screens", "overhead"], videos: ["Floor Slide Scapular Retract", "Scapular CARs", "Face Pull"] },
    "rhomboid-minor": { name: "Rhomboid minor", does: "Upper rhomboid: pulls the top of the shoulder blade toward the spine.", refers: "Along the inner edge of the upper shoulder blade, next to the spine.", worse: ["screens", "gripping"], videos: ["Floor Slide Scapular Retract", "Thread The Needle", "Thoracic Rotation Seated"] },
    "rhomboid-major": { name: "Rhomboid major", does: "Pulls the shoulder blade toward the spine and down; steadies it when you pull.", refers: "Between the shoulder blade and the spine. Often strained because tight chest muscles pull the blades apart.", worse: ["screens", "gripping"], videos: ["Floor Slide Scapular Retract", "Thread The Needle", "Thoracic Extension Over Chair"] },
    "wrist-ext": { name: "Wrist extensors (ECRL, ECRB)", does: "Lift the wrist; work hard to steady it when you grip or type.", refers: "Outside of the elbow (tennis elbow) and the back of the wrist and hand on the thumb side.", worse: ["gripping", "screens"], videos: ["Eccentric Wrist Drops", "Weighted Wrist Circles"] },
    "finger-ext": { name: "Finger extensors (extensor digitorum)", does: "Straighten the fingers; work with every click, tap and grip release.", refers: "Back of the forearm and back of the hand into the middle or ring finger; a 'stiff fingers' feeling.", worse: ["gripping", "screens"], videos: ["Eccentric Wrist Drops", "Weighted Wrist Circles"] },
    "wrist-flex": { name: "Wrist flexors (FCR, FCU)", does: "Bend the wrist and steady it in pulling and lifting.", refers: "Inside of the elbow (golfer's elbow) and the palm side of the wrist.", worse: ["gripping"], videos: ["Eccentric Wrist Pronator", "Weighted Wrist Circles"] },
    "finger-flex": { name: "Finger flexors", does: "Close the fingers and thumb into a grip.", refers: "Palm and the front of the fingers, sometimes a 'trigger finger' catching feeling.", worse: ["gripping"], videos: ["Eccentric Wrist Pronator", "Weighted Wrist Circles"] },
    "iliocostalis": { name: "Iliocostalis (outer back extensor)", does: "Outer column of the back extensors; keeps you upright and bends you sideways.", refers: "Low back and buttock from the lumbar part; the lower shoulder blade and even the belly from the thoracic part.", worse: ["standing", "sitting", "lifting"], videos: ["Cat Cow Desk Variation", "Dowel Hip Hinge", "Sit Turn Lean"] },
    "longissimus": { name: "Longissimus (middle back extensor)", does: "Long middle column of the back extensors; holds posture all day.", refers: "Low in the buttock and over the SI joint, often well below where the muscle actually is.", worse: ["standing", "sitting", "lifting"], videos: ["Cat Cow Desk Variation", "Pike Forward Fold", "Dowel Hip Hinge"] },
    "adductor-longus": { name: "Adductor longus & brevis", does: "Pull the thigh inward; steady the pelvis when you change direction.", refers: "Deep groin, the inner thigh and down to the inner knee and top of the shin.", worse: ["running", "stairs"], videos: ["Standing Hip Abduction/Adduction", "Cossack Squat", "Goblet Sumo Squat"] },
    "adductor-magnus": { name: "Adductor magnus", does: "The big inner-thigh muscle; pulls the leg in and helps extend the hip.", refers: "Deep inside the pelvis and groin, and the inner thigh from the groin toward the knee.", worse: ["running", "stairs", "sitting"], videos: ["Standing Hip Abduction/Adduction", "Cossack Squat", "Romanian Deadlift"] },
    "biceps-femoris": { name: "Biceps femoris (outer hamstring)", does: "Bends the knee, extends the hip and turns the lower leg out.", refers: "Back of the knee on the outside and up the back of the thigh.", worse: ["sitting", "running"], videos: ["Romanian Deadlift", "Dowel Hip Hinge", "Pike Forward Fold"] },
    "medial-hamstrings": { name: "Semitendinosus & semimembranosus (inner hamstrings)", does: "Bend the knee, extend the hip and turn the lower leg in.", refers: "The buttock crease, back of the thigh and the inner back of the knee, sometimes the inner calf.", worse: ["sitting", "running"], videos: ["Romanian Deadlift", "Dowel Hip Hinge", "Pike Forward Fold"] },
    "vastus-intermedius": { name: "Vastus intermedius", does: "Deep quad under the rectus femoris; straightens the knee.", refers: "Front of the mid-thigh, worse climbing stairs or standing up from a chair.", worse: ["stairs", "sitting"], videos: ["Step Up", "Knee Circles", "Couch Stretch"], guide: "quads" },
    "suboccipitals": { name: "Suboccipitals", does: "Tiny muscles that tilt and steady the head at the base of the skull.", refers: "A band of headache from the base of the skull wrapping to behind the eye and the forehead. Often mistaken for migraine.", worse: ["screens", "stress", "turning"], videos: ["Chin Glide Seated", "Deep Cervical Flexor Nods Seated", "Seated Desk Posture Reset"], guide: "posterior-neck" },
    "occipitalis": { name: "Occipitalis", does: "Scalp muscle at the back of the head.", refers: "Ache at the back of the head that can shoot through the skull to behind the eye, with scalp tenderness.", worse: ["stress", "screens"], videos: ["Chin Glide Seated", "Neck Neuroglide Seated"], guide: "posterior-neck" },
    "upper-trap": { name: "Upper trapezius", does: "Shrugs and lifts the shoulders; holds up the arms all day.", refers: "Up the side of the neck, behind the ear and into the temple (a question-mark shape). Very common tension headache source.", worse: ["stress", "screens", "gripping"], videos: ["Upper Trap Stretch Seated", "Towel Neck Stretch Eccentric", "Seated Desk Posture Reset"] },
    "scm": { name: "Sternocleidomastoid (SCM)", does: "Turns and bends the head; runs from behind the ear to the collarbone.", refers: "Forehead, around and behind the eye, cheek, ear and top of the head. Can cause dizziness or ear fullness.", worse: ["turning", "screens", "breathing"], videos: ["SCM Release Seated", "Chin Glide Seated", "Neck Neuroglide Seated"] },
    "levator": { name: "Levator scapulae", does: "Lifts the shoulder blade and turns the neck.", refers: "The angle where the neck meets the shoulder, down the inner edge of the shoulder blade. Classic \"stiff neck, can't turn my head\".", worse: ["turning", "screens", "stress", "sleeping"], videos: ["Levator Scap Stretch Seated", "Scapular CARs", "Towel Neck Stretch Eccentric"], guide: "posterior-neck" },
    "scalenes": { name: "Scalenes", does: "Side-neck muscles that lift the top ribs when you breathe.", refers: "Chest, front and back of the upper arm, inner shoulder blade and down the forearm to the thumb and index finger. Can add tingling in the hand.", worse: ["breathing", "screens", "stress", "sleeping"], videos: ["Standing Scalene Stretch", "Eccentric Scalene Drop", "90/90 Breathing"], guide: "scalenes" },
    "splenius": { name: "Splenius capitis & cervicis", does: "Extend and rotate the head and neck.", refers: "Pain on the top of the head, and deep ache inside the head behind the eye.", worse: ["screens", "turning"], videos: ["Chin Glide Seated", "Neck Neuroglide Seated", "Towel Neck Stretch Eccentric"] },
    "temporalis": { name: "Temporalis", does: "Closes the jaw; fan-shaped over the temple.", refers: "Temple headache, above the eyebrow and into the upper teeth.", worse: ["clenching", "stress"], videos: ["Box Breathing", "Chin Glide Seated"] },
    "masseter": { name: "Masseter", does: "The main chewing muscle at the angle of the jaw.", refers: "Jaw, cheek, in front of the ear and the back teeth. Can feel like an earache or toothache.", worse: ["clenching", "stress"], videos: ["Box Breathing", "Chin Glide Seated"] },
    "supraspinatus": { name: "Supraspinatus (rotator cuff)", does: "Starts lifting the arm out to the side; keeps the ball in the socket.", refers: "Deep ache at the top and side of the shoulder that can run down the outside of the arm to the elbow. Worse reaching overhead.", worse: ["overhead", "sleeping"], videos: ["Rotator Cuff External Rotation", "Abducted External Rotation", "Rotator Cuff 90 Band Vibration"], guide: "rotator-cuff" },
    "infraspinatus": { name: "Infraspinatus (rotator cuff)", does: "Rotates the arm outward; covers the back of the shoulder blade.", refers: "Deep in the front of the shoulder joint, down the front and outside of the arm. Hard to reach behind your back or sleep on that side.", worse: ["overhead", "sleeping", "reaching-back"], videos: ["Rotator Cuff External Rotation", "Abducted External Rotation", "Lying Open Book"], guide: "rotator-cuff" },
    "teres-minor": { name: "Teres minor (rotator cuff)", does: "Small outward rotator under the infraspinatus.", refers: "A localized deep ache at the back of the shoulder.", worse: ["overhead", "sleeping"], videos: ["Rotator Cuff External Rotation", "Scapular CARs"], guide: "rotator-cuff" },
    "subscapularis": { name: "Subscapularis (rotator cuff)", does: "Rotates the arm inward; lines the underside of the shoulder blade.", refers: "Back of the shoulder, down the back of the arm, sometimes a band around the wrist. Can feel like a frozen shoulder.", worse: ["overhead", "reaching-back"], videos: ["Rotator Cuff Internal Rotation", "Abducted Internal Rotation", "Shoulder Drop Hold"], guide: "rotator-cuff" },
    "pec-minor": { name: "Pectoralis minor", does: "Pulls the shoulder blade forward; tight with rounded shoulders.", refers: "Front of the shoulder and chest, down the inner arm to the last three fingers. Can pinch nerves to the hand.", worse: ["screens", "breathing", "overhead"], videos: ["Baseball Cable Stretch", "Floor Slide Scapular Retract", "Thoracic Extension Over Chair"] },
    "serratus": { name: "Serratus anterior", does: "Wraps the ribs and holds the shoulder blade to the chest wall.", refers: "Side of the rib cage and the bottom tip of the shoulder blade; a side \"stitch\" that hurts with deep breaths.", worse: ["breathing", "running"], videos: ["Serratus Stretch Breathing", "Scap Push Ups", "Thread The Needle"] },
    "lats": { name: "Latissimus dorsi", does: "Pulls the arm down and back; the widest back muscle.", refers: "Bottom tip of the shoulder blade and down the back of the arm to the ring and little fingers.", worse: ["overhead", "gripping"], videos: ["Overhead Straight Arm Pulldown", "Dynamic Childs Pose", "Thread The Needle"] },
    "intercostals": { name: "Intercostals", does: "Small muscles between the ribs that help you breathe.", refers: "Sharp or aching pain along the rib, worse with deep breaths, coughing or twisting.", worse: ["breathing", "turning"], videos: ["90/90 Breathing", "Serratus Stretch Breathing", "Lying Open Book"], guide: "scalenes" },
    "brachioradialis": { name: "Brachioradialis", does: "Bends the elbow with the thumb up (hammer position).", refers: "Outside of the elbow and the web of the thumb.", worse: ["gripping"], videos: ["Eccentric Wrist Pronator", "Eccentric Wrist Drops"] },
    "supinator": { name: "Supinator", does: "Turns the palm up.", refers: "Outer elbow and the thumb web; common in tennis elbow that won't settle.", worse: ["gripping"], videos: ["Eccentric Wrist Pronator", "Weighted Wrist Circles"] },
    "ql": { name: "Quadratus lumborum (QL)", does: "Deep low-back muscle that hikes the hip and steadies the spine.", refers: "Low back and flank, over the SI joint and buttock, and the point of the hip. Hurts rolling in bed, standing up or coughing.", worse: ["standing", "turning", "breathing", "sitting"], videos: ["Sit Turn Lean", "Dynamic Childs Pose", "Pillow Belt Reset"] },
    "multifidus": { name: "Multifidus", does: "Deep stabilizers between each vertebra.", refers: "Deep, pinpoint pain right next to the spine, the sacrum and sometimes the tailbone.", worse: ["sitting", "standing", "lifting"], videos: ["Dead Bug", "Pillow Belt Reset", "Cat Cow Desk Variation"] },
    "psoas": { name: "Psoas", does: "Main hip flexor; runs from the lumbar spine to the thigh.", refers: "Vertical band along the low back, plus the front of the thigh and groin. Hard to stand up straight after sitting.", worse: ["sitting", "standing"], videos: ["Couch Stretch", "Hip Neuroglide", "90/90 Hip Switch"], guide: "iliopsoas" },
    "iliacus": { name: "Iliacus", does: "Hip flexor lining the inside of the pelvis.", refers: "Groin, front of the thigh, and the back of the pelvis high in the glute. Often overlooked.", worse: ["sitting", "running"], videos: ["Couch Stretch", "Hip Neuroglide", "Dynamic Childs Pose"], guide: "iliopsoas" },
    "glute-med": { name: "Gluteus medius", does: "Holds the pelvis level when you stand on one leg.", refers: "Along the belt line, over the SI joint, the buttock and the top of the hip.", worse: ["standing", "sleeping", "running", "stairs"], videos: ["Standing Clamshell", "Glute Walk", "Standing Hip Abduction/Adduction"], guide: "lateral-hip" },
    "glute-min": { name: "Gluteus minimus", does: "Deep hip stabilizer under the glute medius.", refers: "Outer hip down the side of the thigh and leg to the ankle, or down the back of the thigh and calf. A common sciatica look-alike.", worse: ["standing", "sleeping", "sitting"], videos: ["Standing Hip IR Liftoff", "Standing Clamshell", "90/90 Hip Switch"], guide: "lateral-hip" },
    "piriformis": { name: "Piriformis", does: "Rotates the hip outward; sits over the sciatic nerve.", refers: "Mid-buttock and back of the hip, down the back-outside of the thigh toward the calf.", worse: ["sitting", "running", "stairs"], videos: ["90/90 Hip Switch", "Standing Hip ER Liftoff", "Hip Neuroglide"], guide: "lateral-hip" },
    "glute-max": { name: "Gluteus maximus", does: "Extends the hip; powers stairs, hills and standing up.", refers: "Buttock and the tailbone; aches with long sitting and walking uphill.", worse: ["sitting", "stairs"], videos: ["Hip Thrust", "Quadruped Glute Kick", "Constant Glute Engagement"] },
    "tfl": { name: "Tensor fasciae latae (TFL)", does: "Small front-outer hip muscle that pulls on the IT band.", refers: "Front-outer hip down the outside of the thigh, usually stopping at the knee.", worse: ["sitting", "running", "sleeping"], videos: ["Standing Hip CARs", "Couch Stretch", "Side Crab Walk"], guide: "lateral-hip" },
    "rectus-femoris": { name: "Rectus femoris (quads)", does: "Front-thigh muscle that crosses both hip and knee.", refers: "A deep ache around and behind the kneecap, and the front of the hip bone. Worse on stairs or after sitting.", worse: ["stairs", "sitting", "running"], videos: ["Couch Stretch", "Knee Circles", "Step Up"], guide: "quads" },
    "vmo": { name: "Vastus medialis", does: "Inner quad that guides the kneecap.", refers: "Inner knee and inside of the kneecap; can make the knee feel like it buckles.", worse: ["stairs", "running"], videos: ["Step Up", "Knee Neuroglide", "Bodyweight Squat"], guide: "quads" },
    "vastus-lateralis": { name: "Vastus lateralis", does: "Outer quad, the largest of the four.", refers: "Down the outer thigh to the outside of the knee; can make lying on that side painful.", worse: ["sleeping", "running", "stairs"], videos: ["Couch Stretch", "Knee Circles", "Lunges"], guide: "quads" },
    "popliteus": { name: "Popliteus", does: "Small muscle that unlocks the knee.", refers: "Back of the knee; worse crouching, walking downhill or running.", worse: ["stairs", "running"], videos: ["Knee Circles", "Knee Neuroglide"] },
    "gastroc": { name: "Gastrocnemius", does: "Upper calf; pushes you off the ground and bends the knee.", refers: "Upper calf, back of the knee and the arch of the foot; deep cramp-like tightness.", worse: ["running", "stairs", "standing"], videos: ["Eccentric Calf Drops", "Toe Walk", "Ankle Neuroglide"], guide: "calf" },
    "soleus": { name: "Soleus", does: "Deep lower calf; holds you upright when you stand and walk.", refers: "Heel and Achilles tendon, lower calf; can contribute to plantar fasciitis.", worse: ["standing", "running", "stairs"], videos: ["Eccentric Calf Drops", "Ankle Neuroglide", "Heel Walk"], guide: "calf" },
    "tib-post": { name: "Tibialis posterior", does: "Deep calf muscle that holds up the arch.", refers: "Inner ankle and arch, along the inner shin; common with flat feet.", worse: ["running", "standing"], videos: ["Single Leg Balance", "Toe Walk", "Ankle Neuroglide"], guide: "calf" },
    "tib-ant": { name: "Tibialis anterior", does: "Lifts the foot and toes.", refers: "Front of the shin, front of the ankle and the big toe.", worse: ["running", "stairs"], videos: ["Heel Walk", "Ankle Neuroglide"] },
    "peroneals": { name: "Peroneals (fibularis)", does: "Outer-leg muscles that steady the ankle.", refers: "Outer ankle and outside of the foot; common after ankle sprains.", worse: ["running", "standing"], videos: ["Single Leg Balance", "March Balance", "Ankle Neuroglide"] },
    "foot-intrinsics": { name: "Foot muscles (intrinsics)", does: "Small muscles in the sole that shape the arch.", refers: "Heel and sole of the foot; first-step-in-the-morning pain like plantar fasciitis.", worse: ["standing", "running"], videos: ["Toe Walk", "Single Leg Balance", "Eccentric Calf Drops"], guide: "calf" }
  };

  const AGGRAVATORS = {
    "sitting": "Sitting", "standing": "Standing or walking", "screens": "Desk, phone or screens", "overhead": "Reaching overhead",
    "reaching-back": "Reaching behind your back", "gripping": "Gripping, lifting or typing", "sleeping": "Lying on it at night",
    "stairs": "Stairs, squats or hills", "running": "Running or sports", "breathing": "Deep breaths or coughing",
    "turning": "Turning your head or body", "lifting": "Bending or lifting", "stress": "Stress", "clenching": "Clenching or chewing"
  };

  // "Where exactly?" for each Pain Tool area; muscles listed most-common first
  const SPOTS = {
    "head": [["Forehead", ["scm", "suboccipitals", "occipitalis"]], ["Temple", ["upper-trap", "temporalis", "scm"]], ["Behind or around the eye", ["suboccipitals", "scm", "splenius", "occipitalis"]], ["Jaw, cheek or teeth", ["masseter", "temporalis", "scm"]], ["Ear area", ["scm", "masseter", "upper-trap"]]],
    "neck": [["Side of the neck", ["scalenes", "levator", "scm", "upper-trap"]], ["Front of the neck", ["scm", "scalenes"]], ["Where neck meets shoulder", ["levator", "upper-trap", "scalenes", "lower-trap"]]],
    "shoulder": [["Top of the shoulder", ["supraspinatus", "upper-trap", "lat-delt", "levator", "lower-trap"]], ["Front of the shoulder", ["infraspinatus", "ant-delt", "biceps-long", "pec-major-clav", "coracobrachialis", "pec-minor", "biceps-short", "scalenes"]],
      ["Outside of the shoulder or arm", ["lat-delt", "supraspinatus", "infraspinatus", "scalenes"]], ["Deep inside the joint", ["infraspinatus", "supraspinatus", "subscapularis", "biceps-long"]], ["Under the collarbone", ["subclavius", "pec-major-clav", "scalenes", "scm"]]],
    "chest": [["Front of the chest", ["pec-major-stern", "pec-major-clav", "pec-minor", "scalenes", "subclavius"]], ["Side of the ribs", ["serratus", "intercostals", "lats"]], ["Along one rib", ["intercostals", "serratus"]], ["Belly or side of the abdomen", ["ext-oblique", "intercostals", "psoas"]]],
    "elbow": [["Outside of the elbow", ["wrist-ext", "supinator", "brachioradialis", "triceps-lateral", "finger-ext", "supraspinatus"]], ["Inside of the elbow", ["wrist-flex", "triceps-medial", "pec-major-stern", "finger-flex"]],
      ["Point of the elbow", ["triceps-medial", "triceps-long"]], ["Front of the elbow", ["biceps-long", "biceps-short", "brachioradialis"]], ["Forearm", ["finger-ext", "wrist-ext", "wrist-flex", "scalenes", "infraspinatus", "triceps-long"]]],
    "wrist": [["Back of the hand or wrist", ["wrist-ext", "finger-ext", "scalenes", "subscapularis", "coracobrachialis"]], ["Palm side", ["wrist-flex", "finger-flex", "pec-minor", "lats"]], ["Thumb and index finger", ["scalenes", "brachioradialis", "supinator", "subclavius", "wrist-ext"]],
      ["Ring and little finger", ["pec-minor", "pec-major-stern", "lats", "subscapularis", "triceps-medial"]], ["Tingling or numbness", ["scalenes", "pec-minor", "subscapularis", "subclavius"]]],
    "hip": [["Groin", ["iliacus", "adductor-longus", "adductor-magnus", "psoas"]], ["Front of the hip bone", ["rectus-femoris", "iliacus", "tfl"]], ["Outside of the hip", ["tfl", "glute-min", "glute-med", "ql"]]],
    "thigh": [["Front of the thigh", ["rectus-femoris", "vastus-intermedius", "psoas", "iliacus", "adductor-longus"]], ["Outside of the thigh", ["vastus-lateralis", "tfl", "glute-min"]], ["Inner thigh", ["adductor-longus", "adductor-magnus", "vmo"]]],
    "knee": [["Kneecap or just below", ["rectus-femoris", "vmo", "vastus-lateralis", "vastus-intermedius"]], ["Inside of the knee", ["vmo", "adductor-longus", "medial-hamstrings"]], ["Outside of the knee", ["vastus-lateralis", "tfl", "biceps-femoris"]], ["Front of the shin", ["tib-ant", "adductor-longus", "rectus-femoris"]]],
    "ankle": [["Inner ankle and arch", ["tib-post", "soleus", "foot-intrinsics", "gastroc"]], ["Outer ankle", ["peroneals", "glute-min"]], ["Front of the ankle or big toe", ["tib-ant"]], ["Sole of the foot", ["foot-intrinsics", "gastroc", "soleus", "tib-post"]]],
    "head-b": [["Base of the skull", ["suboccipitals", "upper-trap", "splenius", "lower-trap"]], ["Back of the head", ["occipitalis", "suboccipitals", "splenius"]], ["Top of the head", ["splenius", "scm"]]],
    "neck-b": [["Back of the neck", ["suboccipitals", "splenius", "levator", "upper-trap", "lower-trap"]], ["Top of the shoulder", ["upper-trap", "levator", "supraspinatus", "middle-trap"]], ["Can't turn my head", ["levator", "scm", "splenius"]]],
    "upper-back": [["Between the shoulder blades", ["scalenes", "rhomboid-major", "middle-trap", "levator", "rhomboid-minor", "iliocostalis"]], ["Inner edge of the shoulder blade", ["levator", "rhomboid-minor", "lower-trap", "middle-trap", "scalenes"]], ["Bottom tip of the shoulder blade", ["lats", "serratus", "iliocostalis"]]],
    "shoulder-b": [["Back of the shoulder", ["post-delt", "teres-minor", "subscapularis", "teres-major", "infraspinatus", "triceps-long"]], ["On the shoulder blade", ["infraspinatus", "middle-trap", "supraspinatus", "lower-trap"]], ["Back of the upper arm", ["triceps-long", "triceps-lateral", "teres-major", "subscapularis", "lats", "scalenes", "coracobrachialis"]]],
    "low-back": [["Across the low back", ["ql", "iliocostalis", "glute-med", "psoas"]], ["Right beside the spine", ["multifidus", "psoas", "longissimus"]], ["Flank or side", ["ql", "iliocostalis"]], ["SI joint / back of pelvis", ["ql", "longissimus", "glute-med", "iliacus", "multifidus"]], ["Tailbone", ["multifidus", "glute-max"]]],
    "glute": [["Middle of the buttock", ["piriformis", "glute-min", "glute-med", "longissimus"]], ["Upper buttock, belt line", ["glute-med", "ql", "iliacus", "iliocostalis"]], ["Outer hip", ["glute-min", "glute-med", "tfl"]], ["Pain down the leg (sciatica-like)", ["glute-min", "piriformis", "ql"]]],
    "hamstring": [["Back of the thigh", ["biceps-femoris", "medial-hamstrings", "piriformis", "glute-min", "adductor-magnus"]], ["Buttock crease", ["medial-hamstrings", "glute-max"]], ["Back of the knee", ["popliteus", "gastroc", "biceps-femoris", "medial-hamstrings"]]],
    "calf": [["Upper calf", ["gastroc", "glute-min"]], ["Lower calf", ["soleus", "gastroc", "tib-post"]], ["Back of the knee", ["gastroc", "popliteus", "biceps-femoris"]], ["Outer calf", ["glute-min", "peroneals", "piriformis"]]],
    "heel": [["Achilles tendon", ["soleus", "tib-post", "gastroc"]], ["Bottom of the heel", ["soleus", "foot-intrinsics"]], ["Arch", ["tib-post", "gastroc", "foot-intrinsics"]]]
  };

  // Tap-a-muscle maps: [x, y, deep] in px of assets/pain/body-figures.webp (1182×1073); box = the zoomed crop [x, y, w, h]
  const MAPS = {
    "body-front": { label: "Body · front", box: [40, 0, 520, 1073], pts: { "temporalis": [255, 70], "masseter": [264, 116], "scm": [268, 158], "scalenes": [254, 182, 1], "upper-trap": [228, 186], "subclavius": [250, 207, 1], "pec-major-clav": [212, 222], "ant-delt": [178, 222], "lat-delt": [140, 228], "pec-minor": [205, 252, 1], "pec-major-stern": [240, 262], "coracobrachialis": [162, 288, 1], "biceps-long": [134, 305], "biceps-short": [152, 322], "serratus": [190, 345], "intercostals": [222, 320, 1], "ext-oblique": [226, 400], "supinator": [100, 398, 1], "brachioradialis": [93, 425], "wrist-ext": [80, 452], "wrist-flex": [118, 440], "finger-flex": [104, 475], "psoas": [262, 468, 1], "iliacus": [232, 500, 1], "tfl": [204, 528], "adductor-longus": [262, 578], "rectus-femoris": [240, 622], "vastus-lateralis": [196, 645], "vastus-intermedius": [226, 672, 1], "vmo": [264, 705], "tib-ant": [214, 830], "peroneals": [198, 880], "tib-post": [222, 920, 1], "foot-intrinsics": [232, 1042] } },
    "body-back": { label: "Body · back", box: [600, 0, 582, 1073], pts: { "occipitalis": [905, 58], "suboccipitals": [890, 105, 1], "splenius": [884, 136, 1], "levator": [852, 168, 1], "upper-trap": [828, 186], "supraspinatus": [830, 207, 1], "rhomboid-minor": [884, 222, 1], "middle-trap": [860, 236], "post-delt": [784, 232], "infraspinatus": [830, 262], "rhomboid-major": [872, 262, 1], "subscapularis": [848, 286, 1], "teres-minor": [800, 268], "teres-major": [808, 298], "lower-trap": [884, 312], "triceps-long": [776, 300], "triceps-lateral": [758, 325], "triceps-medial": [772, 372, 1], "lats": [832, 350], "finger-ext": [712, 455], "iliocostalis": [852, 415], "longissimus": [880, 440], "ql": [848, 462, 1], "multifidus": [898, 470, 1], "glute-med": [828, 505], "glute-min": [812, 535, 1], "piriformis": [872, 522, 1], "glute-max": [862, 565], "adductor-magnus": [893, 642], "biceps-femoris": [835, 672], "medial-hamstrings": [878, 672], "popliteus": [860, 762, 1], "gastroc": [850, 822], "soleus": [856, 905] } },
    "shoulder-front": { label: "Shoulder · front", box: [110, 150, 200, 250], pts: { "upper-trap": [228, 184], "subclavius": [250, 207, 1], "pec-major-clav": [212, 222], "ant-delt": [178, 222], "lat-delt": [140, 228],
      "pec-minor": [205, 252, 1], "pec-major-stern": [240, 262], "coracobrachialis": [162, 288, 1], "biceps-long": [134, 305], "biceps-short": [152, 322], "serratus": [190, 345] } },
    "shoulder-back": { label: "Shoulder · back", box: [740, 145, 190, 255], pts: { "levator": [852, 168, 1], "upper-trap": [828, 186], "supraspinatus": [830, 207, 1], "rhomboid-minor": [884, 222, 1], "middle-trap": [860, 236],
      "post-delt": [784, 232], "infraspinatus": [830, 262], "rhomboid-major": [872, 262, 1], "subscapularis": [848, 286, 1], "teres-minor": [800, 268], "teres-major": [808, 298], "lower-trap": [884, 312],
      "triceps-long": [776, 300], "triceps-lateral": [758, 325], "triceps-medial": [772, 372, 1], "lats": [832, 350] } }
  };

  // Rank muscles for chosen spots ("area|spot label") and aggravators: earlier in a spot's list = more common.
  // Each area carries the same total weight, so an area left at "anywhere" (all its spots) can't outvote
  // an area where the client picked one exact spot.
  function rank(spotKeys, aggr = []) {
    const score = new Map(), why = new Map(), perArea = new Map();
    for (const key of spotKeys) perArea.set(key.split("|")[0], (perArea.get(key.split("|")[0]) || 0) + 1);
    for (const key of spotKeys) {
      const [area, label] = key.split("|");
      const spot = (SPOTS[area] || []).find((s) => s[0] === label);
      if (!spot) continue;
      spot[1].forEach((id, i) => {
        score.set(id, (score.get(id) || 0) + Math.max(1, 4 - i) / perArea.get(area));
        why.set(id, [...(why.get(id) || []), label]);
      });
    }
    for (const id of score.keys()) {
      const hits = M[id].worse.filter((w) => aggr.includes(w));
      score.set(id, score.get(id) + hits.length * 1.5);
    }
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id, s]) => ({ id, ...M[id], score: s, spots: why.get(id), matches: M[id].worse.filter((w) => aggr.includes(w)) }));
  }

  // Muscle -> body area name used by the intake form and the pain log (the area where it ranks highest)
  const AREA_NAME = { "head": "Neck", "neck": "Neck", "head-b": "Neck", "neck-b": "Neck", "shoulder": "Shoulder", "shoulder-b": "Shoulder",
    "chest": "Other", "elbow": "Elbow / wrist / hand", "wrist": "Elbow / wrist / hand", "upper-back": "Upper back", "low-back": "Lower back",
    "hip": "Hip", "thigh": "Hip", "glute": "Hip", "hamstring": "Hip", "knee": "Knee", "ankle": "Ankle / foot", "calf": "Ankle / foot", "heel": "Ankle / foot" };
  function areaOf(id) {
    let best = null, rankAt = Infinity;
    for (const [area, spots] of Object.entries(SPOTS)) for (const sp of spots) {
      const i = sp[1].indexOf(id);
      if (i >= 0 && i < rankAt) { rankAt = i; best = area; }
    }
    return AREA_NAME[best] || "Other";
  }

  // Attachments (origin → insertion), shown under "Want to know more?"
  const ATTACH = {
    "ext-oblique": "Outer surface of ribs 5–12 → iliac crest, the abdominal aponeurosis and the linea alba",
    "ant-delt": "Outer third of the collarbone → deltoid tuberosity of the upper arm",
    "lat-delt": "Acromion → deltoid tuberosity of the upper arm",
    "post-delt": "Spine of the shoulder blade → deltoid tuberosity of the upper arm",
    "teres-major": "Lower outer corner of the shoulder blade → front of the upper arm, below the shoulder (medial lip of the bicipital groove)",
    "pec-major-clav": "Inner half of the collarbone → outer lip of the bicipital groove of the upper arm",
    "pec-major-stern": "Breastbone, upper six rib cartilages and the abdominal aponeurosis → outer lip of the bicipital groove",
    "subclavius": "First rib and its cartilage → underside of the collarbone",
    "coracobrachialis": "Coracoid process of the shoulder blade → inner middle of the upper arm bone",
    "biceps-long": "Top of the shoulder socket (supraglenoid tubercle) → radius (radial tuberosity) and forearm fascia",
    "biceps-short": "Coracoid process of the shoulder blade → radius (radial tuberosity) and forearm fascia",
    "triceps-long": "Just below the shoulder socket (infraglenoid tubercle) → olecranon, the point of the elbow",
    "triceps-lateral": "Back of the upper arm bone, above the radial groove → olecranon",
    "triceps-medial": "Back of the upper arm bone, below the radial groove → olecranon",
    "middle-trap": "Spinous processes of C7–T3 → acromion and the spine of the shoulder blade",
    "lower-trap": "Spinous processes of T4–T12 → base of the spine of the shoulder blade",
    "rhomboid-minor": "Spinous processes of C7–T1 → inner edge of the shoulder blade at the root of its spine",
    "rhomboid-major": "Spinous processes of T2–T5 → inner edge of the shoulder blade, below its spine",
    "wrist-ext": "Outer elbow (lateral supracondylar ridge and lateral epicondyle) → bases of the 2nd and 3rd hand bones",
    "finger-ext": "Lateral epicondyle of the elbow → back of the middle and end bones of fingers 2–5",
    "wrist-flex": "Medial epicondyle of the elbow → bases of the 2nd–3rd hand bones (FCR) and the pisiform / 5th hand bone (FCU)",
    "finger-flex": "Medial epicondyle, ulna and radius → middle and end bones of the fingers and thumb",
    "iliocostalis": "Sacrum, iliac crest and ribs → ribs and the transverse processes of the neck vertebrae",
    "longissimus": "Sacrum, iliac crest and lumbar/thoracic transverse processes → thoracic and cervical transverse processes, lower ribs and the skull (mastoid)",
    "adductor-longus": "Pubic bone, near the pubic symphysis → middle third of the back of the thigh bone (linea aspera)",
    "adductor-magnus": "Pubic bone, ischium and sit bone → whole length of the linea aspera and the adductor tubercle above the inner knee",
    "biceps-femoris": "Sit bone (long head) and back of the thigh bone (short head) → head of the fibula, outside of the knee",
    "medial-hamstrings": "Sit bone → inner top of the shin bone (pes anserinus and the medial tibial condyle)",
    "vastus-intermedius": "Front and outer surfaces of the thigh bone → kneecap and, via the patellar tendon, the shin (tibial tuberosity)",
    "suboccipitals": "Top two neck vertebrae (C1–C2) → base of the skull and C1",
    "occipitalis": "Back of the skull (superior nuchal line) → galea aponeurotica over the top of the head",
    "upper-trap": "Base of the skull and the nuchal ligament → outer third of the collarbone",
    "scm": "Top of the breastbone and inner collarbone → mastoid process behind the ear",
    "levator": "Transverse processes of C1–C4 → upper inner corner of the shoulder blade",
    "scalenes": "Transverse processes of C2–C7 → first and second ribs",
    "splenius": "Nuchal ligament and spinous processes of C7–T6 → mastoid, base of the skull and the transverse processes of C1–C3",
    "temporalis": "Temporal fossa on the side of the skull → coronoid process and front of the jaw's ramus",
    "masseter": "Cheekbone (zygomatic arch) → angle and outer surface of the jaw",
    "supraspinatus": "Supraspinous fossa of the shoulder blade → top of the greater tubercle of the upper arm",
    "infraspinatus": "Infraspinous fossa of the shoulder blade → middle of the greater tubercle of the upper arm",
    "teres-minor": "Upper outer edge of the shoulder blade → bottom of the greater tubercle of the upper arm",
    "subscapularis": "Front (rib side) of the shoulder blade → lesser tubercle of the upper arm",
    "pec-minor": "Ribs 3–5 → coracoid process of the shoulder blade",
    "serratus": "Outer surface of ribs 1–8 or 9 → front of the inner edge of the shoulder blade",
    "lats": "Spinous processes of T7–L5, the thoracolumbar fascia, iliac crest and lower ribs → floor of the bicipital groove of the upper arm",
    "intercostals": "Lower edge of each rib → upper edge of the rib below",
    "brachioradialis": "Lateral supracondylar ridge of the upper arm → radius, just above the wrist (styloid process)",
    "supinator": "Lateral epicondyle and the ulna → upper third of the radius",
    "ql": "Back of the iliac crest → 12th rib and the transverse processes of L1–L4",
    "multifidus": "Sacrum and transverse processes of the vertebrae → spinous processes 2–4 levels above",
    "psoas": "Bodies and transverse processes of T12–L5 → lesser trochanter of the thigh bone",
    "iliacus": "Inside of the pelvic bowl (iliac fossa) → lesser trochanter of the thigh bone, with the psoas",
    "glute-med": "Outer surface of the pelvis (ilium) → outer side of the greater trochanter",
    "glute-min": "Outer surface of the pelvis, below the glute medius → front of the greater trochanter",
    "piriformis": "Front of the sacrum → top of the greater trochanter",
    "glute-max": "Back of the pelvis, sacrum, tailbone and thoracolumbar fascia → IT band and the gluteal tuberosity of the thigh bone",
    "tfl": "Front of the iliac crest (ASIS) → IT band, which runs to the outside of the shin (Gerdy's tubercle)",
    "rectus-femoris": "Front of the pelvis (AIIS) and above the hip socket → kneecap and, via the patellar tendon, the tibial tuberosity",
    "vmo": "Inner thigh bone (linea aspera) → inner edge of the kneecap and the patellar tendon",
    "vastus-lateralis": "Greater trochanter and the linea aspera → outer edge of the kneecap and the patellar tendon",
    "popliteus": "Outside of the lower thigh bone (lateral condyle) → back of the upper shin bone",
    "gastroc": "Back of the thigh bone, just above the knee (both condyles) → heel bone via the Achilles tendon",
    "soleus": "Back of the upper fibula and shin bone → heel bone via the Achilles tendon",
    "tib-post": "Back of the shin bone, fibula and the membrane between them → navicular and the bones of the arch",
    "tib-ant": "Outer surface of the shin bone → inner side of the foot (medial cuneiform and the base of the 1st metatarsal)",
    "peroneals": "Outer surface of the fibula → base of the 5th metatarsal (brevis) and under the foot to the 1st metatarsal (longus)",
    "foot-intrinsics": "Heel bone and the plantar fascia → toes"
  };
  for (const [id, a] of Object.entries(ATTACH)) if (M[id]) M[id].attach = a;

  // Homepage pain map: unnamed tappable regions sized to the large muscle groups, drawn a little wider than
  // the muscle bellies on purpose so patients pick where it HURTS, not a muscle (referred pain rarely starts
  // where it's felt). Outlines are in px of assets/pain/body-figures.webp (1182×1073), drawn for the body's
  // RIGHT side; paired regions are mirrored for the left. tracks: pain tracks offered, in order.
  // spots: Pain Tool "area|spot" keys that rank the muscles under "Want to know more?".
  const all = (a) => (SPOTS[a] || []).map((s) => `${a}|${s[0]}`);
  const FRONT_MID = 287, BACK_MID = 911.5; // measured from the figure silhouettes
  // Draw order matters where regions overlap on purpose: the later region takes the tap there.
  const R = [
    // ---- Front
    { id: "f-head", view: "front", pair: false, pts: [[287, 0], [330, 10], [348, 55], [340, 108], [322, 140], [330, 172], [342, 200], [287, 212], [232, 200], [244, 172], [252, 140], [234, 108], [226, 55], [244, 10]],
      tracks: ["scalenes", "levator", "scalene-chest"], spots: [...all("head"), ...all("neck")] },
    { id: "f-chest", view: "front", pts: [[287, 208], [240, 200], [200, 206], [190, 236], [188, 282], [192, 320], [200, 338], [250, 342], [287, 338]],
      tracks: ["pec-major", "pec-minor-rib", "scalene-chest", "serratus"], spots: ["chest|Front of the chest", "chest|Side of the ribs", "chest|Along one rib", "shoulder|Under the collarbone"] },
    { id: "f-abdomen", view: "front", pts: [[287, 338], [250, 342], [200, 338], [190, 372], [194, 410], [204, 430], [250, 432], [287, 428]],
      tracks: ["external-oblique", "serratus", "psoas"], spots: ["chest|Belly or side of the abdomen", "chest|Side of the ribs", "chest|Along one rib"] },
    { id: "f-lower-abdomen", view: "front", pts: [[287, 428], [250, 432], [204, 430], [194, 452], [202, 478], [232, 502], [258, 530], [287, 524]],
      tracks: ["external-oblique", "iliacus", "psoas", "groin-rotational", "pectineus"], spots: ["hip|Groin", "hip|Front of the hip bone", "chest|Belly or side of the abdomen"] },
    { id: "f-shoulder-arm", view: "front", pts: [[252, 160], [240, 186], [204, 200], [190, 232], [190, 282], [180, 322], [170, 362], [156, 394], [104, 398], [110, 350], [114, 300], [116, 252], [130, 214], [160, 196], [206, 180], [236, 156]],
      tracks: ["anterior-deltoid", "pec-major", "scalenes", "supraspinatus", "infraspinatus", "subscapularis", "pec-minor-rib", "levator", "triceps"],
      spots: [...all("shoulder"), "neck|Where neck meets shoulder", "shoulder-b|Back of the upper arm", "elbow|Front of the elbow"] },
    { id: "f-forearm-hand", view: "front", pts: [[100, 392], [158, 394], [146, 440], [120, 482], [104, 512], [98, 588], [78, 644], [40, 656], [24, 604], [4, 568], [22, 534], [56, 506], [64, 460], [84, 418]],
      tracks: ["medial-forearm", "radialis-general", "extensor-radialis", "scalenes", "pec-major", "pec-minor-rib", "triceps"], spots: [...all("elbow"), ...all("wrist")] },
    { id: "f-thigh", view: "front", pts: [[194, 468], [232, 500], [262, 534], [286, 566], [284, 630], [270, 690], [254, 712], [196, 714], [174, 690], [164, 620], [166, 540], [178, 490]],
      tracks: ["iliacus", "groin-rotational", "pectineus", "glute-min", "hip-general", "knee"], spots: [...all("thigh"), "hip|Outside of the hip"] },
    { id: "f-knee", view: "front", pts: [[180, 708], [258, 706], [262, 754], [246, 800], [200, 802], [184, 760]],
      tracks: ["knee", "groin-rotational", "glute-min"], spots: ["knee|Kneecap or just below", "knee|Inside of the knee", "knee|Outside of the knee"] },
    { id: "f-leg", view: "front", pts: [[186, 800], [248, 798], [242, 868], [232, 950], [240, 1032], [244, 1066], [200, 1072], [166, 1062], [180, 1020], [190, 960], [184, 880]],
      tracks: ["knee", "calf-soleus", "foot", "glute-min"], spots: ["knee|Front of the shin", ...all("ankle")] },
    // ---- Back
    { id: "b-head", view: "back", pair: false, pts: [[911, 0], [949, 10], [965, 55], [955, 96], [911, 110], [867, 96], [857, 55], [873, 10]],
      tracks: ["levator", "scalenes"], spots: all("head-b") },
    { id: "b-shoulder-arm", view: "back", pts: [[938, 140], [950, 165], [985, 192], [1030, 204], [1060, 222], [1082, 250], [1086, 292], [1094, 340], [1094, 385], [1070, 398], [1046, 388], [1034, 346], [1030, 300], [1040, 262], [1010, 236], [975, 226], [945, 212]],
      tracks: ["supraspinatus", "infraspinatus", "subscapularis", "triceps", "levator", "scalenes"],
      spots: ["shoulder-b|Back of the shoulder", "shoulder-b|Back of the upper arm", "neck-b|Top of the shoulder", "elbow|Point of the elbow"] },
    { id: "b-blade", view: "back", pts: [[952, 232], [985, 214], [1030, 222], [1058, 240], [1062, 280], [1040, 320], [1010, 350], [975, 355], [950, 330], [945, 280]],
      tracks: ["infraspinatus", "levator", "scalenes", "serratus", "supraspinatus", "subscapularis"], spots: [...all("upper-back"), "shoulder-b|On the shoulder blade"] },
    { id: "b-spine", view: "back", pair: false, pts: [[892, 100], [930, 100], [936, 150], [938, 220], [938, 300], [936, 350], [886, 350], [884, 300], [884, 220], [886, 150]],
      tracks: ["levator", "scalenes", "infraspinatus", "serratus"], spots: [...all("neck-b"), "upper-back|Between the shoulder blades"] },
    { id: "b-forearm-hand", view: "back", pts: [[1062, 398], [1096, 390], [1112, 432], [1132, 480], [1142, 514], [1170, 548], [1182, 580], [1164, 622], [1132, 640], [1116, 600], [1106, 556], [1104, 516], [1090, 472], [1070, 432]],
      tracks: ["extensor-radialis", "triceps", "radialis-general", "subscapularis", "scalenes"],
      spots: ["elbow|Outside of the elbow", "elbow|Forearm", "elbow|Point of the elbow", "wrist|Back of the hand or wrist", "wrist|Ring and little finger", "wrist|Thumb and index finger"] },
    { id: "b-glute-ham", view: "back", pts: [[922, 520], [967, 505], [1009, 496], [1037, 518], [1045, 575], [1050, 640], [1046, 700], [1032, 745], [985, 750], [945, 745], [932, 690], [927, 620], [915, 580]],
      tracks: ["glute-min", "glute-max", "ql", "hip-general", "iliacus", "psoas"], spots: [...all("glute"), "hamstring|Back of the thigh", "hamstring|Buttock crease"] },
    { id: "b-low-back", view: "back", pair: false, pts: [[880, 318], [942, 318], [952, 360], [962, 410], [976, 450], [980, 490], [960, 520], [940, 545], [922, 568], [900, 568], [882, 545], [862, 520], [842, 490], [846, 450], [860, 410], [870, 360]],
      tracks: ["ql", "psoas", "iliacus", "glute-max", "glute-min"], spots: all("low-back") },
    { id: "b-knee", view: "back", pts: [[943, 728], [1019, 722], [1017, 770], [981, 782], [947, 772]],
      tracks: ["calf-soleus", "knee"], spots: ["hamstring|Back of the knee", "calf|Back of the knee"] },
    { id: "b-calf-heel", view: "back", pts: [[943, 776], [1021, 772], [1027, 840], [1015, 905], [1008, 960], [1017, 1030], [999, 1070], [963, 1068], [957, 1010], [955, 940], [939, 860]],
      tracks: ["calf-soleus", "foot", "glute-min"], spots: [...all("calf"), ...all("heel")] }
  ];
  const mirror = (r) => ({ ...r, id: r.id + "-l", side: "left", pts: r.pts.map(([x, y]) => [2 * (r.view === "front" ? FRONT_MID : BACK_MID) - x, y]) });
  const BODY_REGIONS = R.flatMap((r) => (r.pair === false ? [{ ...r, side: "center" }] : [{ ...r, id: r.id + "-r", side: "right" }, mirror(r)]));

  window.MDFitMuscles = { MUSCLES: M, AGGRAVATORS, SPOTS, MAPS, BODY_REGIONS, rank, areaOf };
})();
