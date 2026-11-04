// Pain-track pictures: every track drawn the same way on Dr. Jared's own anatomy figure (grayscale), so clients can
// compare them at a glance. Red = where the pain is felt; × = where the trigger point usually sits.
// All coordinates are px of assets/pain/body-figures.webp (1182×1073). Pain is drawn on the body's RIGHT side
// (viewer's left on the front figure, viewer's right on the back figure).
(() => {
  // Crops, all 4:5 and zoomed out enough to show where on the body you are: [x, y, w, h]
  const C = {
    "f-up": [40, 0, 400, 500],      // head to waist, front
    "f-arm": [0, 110, 400, 500],    // neck to fingertips, front
    "f-trunk": [90, 170, 400, 500], // chest to upper thigh, front
    "f-hip": [70, 360, 400, 500],   // waist to knee, front
    "f-knee": [50, 470, 400, 500],  // hip to ankle, front
    "b-up": [770, 0, 400, 500],     // head to waist, back
    "b-arm": [782, 110, 400, 500],  // neck to fingertips, back
    "b-low": [760, 270, 400, 500],  // low back to knee, back
    "b-leg": [775, 380, 400, 500],  // buttock to calf, back
    "b-calf": [775, 573, 400, 500]  // knee to heel, back
  };
  // e: pain zones [cx, cy, rx, ry, angle?, strength?]; x: trigger points [x, y]
  const P = {
    "scalene-chest": [{ v: "f-arm", e: [[228, 262, 52, 34], [158, 248, 22, 26, 0, .7], [138, 325, 16, 42, 12, .8], [100, 445, 12, 36, 18, .75], [62, 540, 12, 18, 20, .8]], x: [[262, 176]] }],
    "pec-major": [{ v: "f-arm", e: [[228, 262, 50, 40], [172, 238, 32, 34], [150, 330, 15, 40, 14, .8], [128, 395, 16, 16, 0, .85], [104, 455, 11, 36, 18, .7], [70, 585, 11, 22, 15, .7]], x: [[222, 250], [238, 290]] }],
    "pec-minor-rib": [{ v: "f-arm", e: [[222, 252, 42, 30], [174, 236, 36, 36], [148, 335, 13, 38, 14, .75], [106, 452, 11, 36, 18, .7], [68, 588, 11, 22, 15, .7]], x: [[212, 268]] }],
    "scalenes": [
      { v: "f-arm", e: [[226, 255, 40, 26, 0, .8], [158, 252, 26, 38], [136, 330, 17, 48, 12], [98, 452, 12, 36, 18, .8], [58, 548, 11, 17, 20, .85]], x: [[262, 176]] },
      { v: "b-up", e: [[963, 268, 15, 52], [1048, 312, 17, 42, -10, .85]], x: [] }
    ],
    "supraspinatus": [{ v: "b-arm", e: [[1042, 248, 32, 34], [1062, 325, 18, 48, -12, .85], [1088, 395, 16, 16], [1102, 450, 10, 26, -12, .5]], x: [[999, 224]] }],
    "subscapularis": [
      { v: "b-arm", e: [[1038, 255, 32, 34], [1058, 322, 18, 46, -12, .85], [1116, 512, 22, 10, -10]], x: [[1021, 300]] },
      { v: "f-up", e: [[168, 245, 26, 30, 0, .7]], x: [] }
    ],
    "anterior-deltoid": [{ v: "f-up", e: [[172, 242, 32, 44], [150, 298, 18, 26, 12, .7]], x: [[172, 238]] }],
    "levator": [{ v: "b-up", e: [[969, 196, 38, 24, 18], [961, 262, 16, 44], [1049, 252, 20, 20, 0, .55]], x: [[951, 195]] }],
    "infraspinatus": [
      { v: "b-up", e: [[1005, 280, 34, 34, 0, .55], [943, 168, 14, 14, 0, .7]], x: [[1006, 285]] },
      { v: "f-arm", e: [[170, 240, 30, 30], [138, 320, 17, 44, 12, .85], [98, 450, 11, 34, 18, .7], [56, 545, 10, 17, 20, .75]], x: [] }
    ],
    "triceps": [{ v: "b-arm", e: [[1040, 252, 24, 24, 0, .75], [1060, 322, 19, 48, -12], [1082, 396, 18, 18], [1102, 455, 13, 38, -12, .8], [1142, 575, 10, 18, -15, .7]], x: [[1058, 335]] }],
    "serratus": [
      { v: "f-trunk", e: [[188, 335, 30, 36], [150, 340, 10, 34, 10, .6]], x: [[192, 330]] },
      { v: "b-up", e: [[983, 338, 20, 20]], x: [] }
    ],
    "extensor-radialis": [{ v: "b-arm", e: [[1094, 396, 18, 18], [1104, 450, 14, 36, -12], [1124, 538, 14, 20, -12, .85]], x: [[1098, 420]] }],
    "medial-forearm": [{ v: "f-arm", e: [[130, 396, 16, 16], [106, 448, 14, 38, 18], [76, 508, 14, 13, 0, .75]], x: [[118, 425]] }],
    "radialis-general": [{ v: "f-arm", e: [[100, 394, 16, 16], [84, 452, 12, 36, 18], [50, 544, 14, 16, 20]], x: [[106, 412]] }],
    "foot": [{ v: "b-calf", e: [[989, 1035, 24, 20], [987, 990, 10, 22, 0, .7]], x: [[989, 1040]] }],
    "calf-soleus": [{ v: "b-calf", e: [[977, 850, 26, 46], [987, 960, 10, 30, 0, .75], [989, 1035, 22, 18], [983, 748, 18, 13, 0, .6]], x: [[976, 865]] }],
    "iliacus": [
      { v: "f-hip", e: [[222, 488, 32, 24, 30], [222, 568, 24, 46, 6, .85]], x: [[214, 468]] },
      { v: "b-low", e: [[941, 455, 20, 42]], x: [] }
    ],
    "psoas": [
      { v: "f-hip", e: [[244, 505, 20, 18], [224, 568, 24, 42, 6, .85]], x: [[242, 452]] },
      { v: "b-low", e: [[935, 420, 15, 60], [945, 490, 18, 18, 0, .85]], x: [] }
    ],
    "ql": [{ v: "b-low", e: [[965, 420, 22, 30], [945, 482, 20, 20], [983, 522, 30, 22, 0, .85], [1028, 560, 20, 20, 0, .8]], x: [[953, 418]] }],
    "hip-general": [
      { v: "f-hip", e: [[210, 488, 26, 26], [190, 520, 16, 22, 0, .7]], x: [] },
      { v: "b-low", e: [[983, 542, 32, 30], [1028, 562, 20, 26, 0, .85]], x: [] }
    ],
    "glute-max": [{ v: "b-low", e: [[914, 495, 24, 30], [976, 558, 40, 34], [911, 558, 10, 12, 0, .8]], x: [[976, 560]] }],
    "glute-min": [{ v: "b-leg", e: [[1018, 548, 22, 30], [1016, 640, 15, 58], [1013, 820, 11, 48, 6, .75], [981, 585, 28, 22, 0, .7]], x: [[1016, 515]] }],
    "groin-rotational": [{ v: "f-hip", e: [[248, 525, 18, 20], [248, 602, 18, 50, -4], [236, 740, 15, 20, 0, .85], [222, 820, 9, 32, 0, .65]], x: [[248, 572]] }],
    "pectineus": [{ v: "f-hip", e: [[244, 530, 22, 22], [246, 582, 15, 30, -4, .85]], x: [[242, 536]] }],
    "external-oblique": [{ v: "f-trunk", e: [[236, 400, 30, 42], [242, 492, 20, 18, 0, .85], [236, 338, 26, 16, 0, .7]], x: [[226, 402]] }],
    "knee": [{ v: "f-knee", e: [[215, 750, 26, 28], [236, 742, 14, 20, 0, .8], [220, 680, 16, 30, 0, .6]], x: [[222, 640]] }]
  };

  const FIG = "assets/pain/body-figures-gray.webp";
  let uid = 0;
  const label = (v) => (v.startsWith("f-") ? "Front" : "Back");
  function panel({ v, e, x }, alt) {
    const [cx, cy, cw, ch] = C[v], id = `pp${++uid}`;
    const s = cw / 400; // stroke scale
    return `<svg class="pp-panel" viewBox="${cx} ${cy} ${cw} ${ch}" role="img" aria-label="${alt} (${label(v).toLowerCase()} view)" preserveAspectRatio="xMidYMid meet">
      <defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${7 * s}"/></filter>
      <radialGradient id="${id}g"><stop offset="0" stop-color="#d7191f" stop-opacity=".95"/><stop offset=".65" stop-color="#e2343a" stop-opacity=".75"/><stop offset="1" stop-color="#ef4c4f" stop-opacity="0"/></radialGradient></defs>
      <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" fill="#fff"/>
      <image href="${FIG}" x="0" y="0" width="1182" height="1073"/>
      <g filter="url(#${id})" style="mix-blend-mode:multiply">${e.map(([ex, ey, rx, ry, a = 0, o = 1]) =>
        `<ellipse cx="${ex}" cy="${ey}" rx="${rx * 1.25}" ry="${ry * 1.25}" transform="rotate(${a} ${ex} ${ey})" fill="url(#${id}g)" opacity="${o}"/>`).join("")}</g>
      ${(x || []).map(([tx, ty]) => `<g transform="translate(${tx} ${ty})" stroke-linecap="round"><path d="M-7-7L7 7M7-7L-7 7" stroke="#fff" stroke-width="${6.5 * s}"/><path d="M-7-7L7 7M7-7L-7 7" stroke="#7a0d10" stroke-width="${3.2 * s}"/></g>`).join("")}
      <text x="${cx + 12 * s}" y="${cy + 24 * s}" font-family="Montserrat, system-ui, sans-serif" font-size="${15 * s}" font-weight="700" letter-spacing="1.5" fill="#6b6a6e">${label(v).toUpperCase()}</text>
    </svg>`;
  }
  const has = (trackId) => !!P[trackId];
  // One or two panels (front/back) for a track; alt text names the pain area
  const html = (trackId, alt = "Pain pattern") => (P[trackId] ? `<div class="pp ${P[trackId].length > 1 ? "pp-2" : ""}">${P[trackId].map((p) => panel(p, alt)).join("")}</div>` : "");

  window.MDFitPatterns = { has, html, PATTERNS: P, CROPS: C };
})();
