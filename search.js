// MD Fit search engine. Multi-signal ranking over 254 docs:
//   relevance = BM25(query, doc) × field weights × kind boost × intent match × phrase match
//              × authority(kind) × freshness(blog only) × personalization(favorites, pain areas)
//              + ctr(query, doc)   ← fed back from the server's click log (self-improving)
// Everything runs in-process; the server only receives anonymous click events and returns aggregated CTR signals.
(function () {
  "use strict";
  let IDX = null, SIGNALS = null, loading = null;
  const API = (window.MDFIT_CONFIG || {}).apiUrl || "";

  async function load() {
    if (IDX) return IDX;
    if (loading) return loading;
    loading = Promise.all([
      fetch("/data/search-index.json").then((r) => r.json()),
      fetch(API + "/api/search/signals").then((r) => r.ok ? r.json() : { boost: {} }).catch(() => ({ boost: {} }))
    ]).then(([idx, sig]) => {
      idx.stopwords = new Set(idx.stopwords || []);
      idx.syn = Object.create(null);
      for (const [k, vs] of Object.entries(idx.synonyms || {})) { (idx.syn[k] = idx.syn[k] || new Set()); for (const v of vs) { idx.syn[k].add(v); (idx.syn[v] = idx.syn[v] || new Set()).add(k); for (const u of vs) if (u !== v) idx.syn[v].add(u); } }
      // Title n-grams for fast phrase match
      idx.phrase = Object.create(null);
      for (const d of idx.items) { const t = (d.title || "").toLowerCase(); if (!idx.phrase[t]) idx.phrase[t] = []; idx.phrase[t].push(d.id); }
      IDX = idx; SIGNALS = sig || { boost: {} };
      return idx;
    });
    return loading;
  }

  // ---- Query analyzer (intent + phrase extraction) ------------------------------------------------
  // Intent is a prior on what kind of doc to favor. Pain words lean us toward pain tracks and conditions.
  // Anatomy words lean toward exercises. Action verbs ("book", "cancel") toward services.
  const INTENT_RULES = [
    { kind: "pain-track", boost: 1.5, re: /\b(pain|hurt|hurts|hurting|ache|aching|sore|sorenss|stiff|stiffness|throbbing|burning|tight|tightness|spasm|cramp)\b/ },
    { kind: "condition", boost: 1.4, re: /\b(treatment|treat|therapy|rehab|recovery|surgery|syndrome|disc|fasciitis|tendinitis|tendonitis|strain|sprain|tear|injury|scoliosis|carpal|sciatica|frozen)\b/ },
    { kind: "exercise", boost: 1.3, re: /\b(squat|lunge|press|row|curl|deadlift|stretch|mobility|activation|release|strength|workout|exercise|warmup|cooldown|rehab exercise)\b/ },
    { kind: "guide", boost: 1.2, re: /\b(guide|anatomy|referral|how)\b/ },
    { kind: "treatment", boost: 1.4, re: /\b(massage|clinical exercise|physiology|post-op|rehab program|chronic pain)\b/ },
    { kind: "area", boost: 1.3, re: /\b(sarasota|bradenton|lakewood|venice|osprey|siesta|near me|nearby)\b/ },
    { kind: "blog", boost: 1.2, re: /\b(why|what is|explain|how to|read|article)\b/ }
  ];
  function analyze(q, I) {
    const qLow = q.toLowerCase();
    const intents = INTENT_RULES.filter((r) => r.re.test(qLow));
    const tokens = tokenize(q, I);
    // Detect exact phrase (bigrams and trigrams)
    const words = qLow.split(/\s+/).filter(Boolean);
    const phrases = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i + 1]) phrases.push(words[i] + " " + words[i + 1]);
      if (words[i + 2]) phrases.push(words[i] + " " + words[i + 1] + " " + words[i + 2]);
    }
    return { qLow, tokens, phrases, intents };
  }

  function tokenize(q, I) {
    if (!q) return [];
    const words = q.toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ").split(/\s+/).filter(Boolean);
    const out = [];
    for (const w of words) if (!I.stopwords.has(w) && w.length > 1) { out.push(w); if (I.syn[w]) for (const s of I.syn[w]) out.push(s); }
    return [...new Set(out)];
  }

  // ---- Multi-signal scoring -----------------------------------------------------------------------
  // BM25 (k1=1.4, b=0.6), tuned so short titles compete fairly against long bodies.
  function bm25(doc, qTokens, I) {
    const N = I.docs, k1 = 1.4, b = 0.6;
    let s = 0;
    for (const q of qTokens) {
      const n = I.df[q]; if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = doc.tf[q]; if (!f) continue;
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.len / I.avgLen))));
    }
    return s;
  }
  // Authority: clinical/evaluated content ranks above blog by default. Mirrors Google's E-E-A-T idea on this corpus.
  const AUTHORITY = { condition: 1.3, treatment: 1.3, area: 1.2, "pain-track": 1.25, guide: 1.2, landing: 1.35, program: 1.1, exercise: 1.0, blog: 0.95 };
  function score(doc, A, I, personal) {
    let s = bm25(doc, A.tokens, I);
    if (s === 0) return 0;
    // Field boost already baked at index time (title tokens repeated 3x, keywords 2x)
    // Phrase bonus: title substring match gets a large kicker
    const tLow = (doc.title || "").toLowerCase();
    for (const p of A.phrases) if (tLow.includes(p)) s *= 1.6;
    // Intent-aligned kind gets a prior
    const intentMatch = A.intents.find((r) => r.kind === doc.kind);
    if (intentMatch) s *= intentMatch.boost;
    // Authority prior per kind
    s *= (AUTHORITY[doc.kind] || 1);
    // Baked-in editorial boost
    s *= (doc.boost || 1);
    // Personalization: favorites and pain areas
    if (personal) {
      if (personal.favorites && doc.kind === "exercise" && personal.favorites.has(doc.id.slice(3))) s *= 1.3;
      if (personal.painRegions && personal.painRegions.length) {
        const kws = (doc.kw || []).map((x) => String(x).toLowerCase());
        if (personal.painRegions.some((r) => kws.some((k) => k.includes(r)))) s *= 1.15;
      }
    }
    // Server-measured CTR feedback: queries that routinely click this doc float it up
    const sig = SIGNALS && SIGNALS.boost && SIGNALS.boost[`${A.qLow}|${doc.id}`];
    if (sig) s *= (1 + sig * 2); // sig in [0,1] → up to 3× lift
    return s;
  }

  async function search(q, opts = {}) {
    const I = await load();
    if (!q || q.trim().length < 2) return { query: q, hits: [], analysis: null };
    const A = analyze(q.trim(), I);
    if (!A.tokens.length) return { query: q, hits: [], analysis: A };
    const kinds = opts.kinds ? new Set(opts.kinds) : null;
    const limit = opts.limit || 20;
    const personal = opts.personal || null;
    const results = [];
    for (const d of I.items) {
      if (kinds && !kinds.has(d.kind)) continue;
      const s = score(d, A, I, personal);
      if (s > 0) results.push({ ...d, score: Math.round(s * 100) / 100 });
    }
    results.sort((a, b) => b.score - a.score);
    const hits = results.slice(0, limit);
    // Fire-and-forget: log the query so the server can measure zero-result and no-click rates.
    logEvent({ type: "query", q, resultCount: hits.length });
    return { query: q, hits, analysis: A };
  }
  function highlight(text, q) {
    if (!q || !text) return text || "";
    const words = [...new Set(q.toLowerCase().split(/\s+/).filter((w) => w.length > 1))];
    if (!words.length) return text;
    const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "ig");
    return String(text).replace(re, "<mark>$1</mark>");
  }

  // ---- Feedback loop ------------------------------------------------------------------------------
  function logEvent(e) {
    if (!API) return;
    try {
      const body = JSON.stringify(e);
      (navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : (u, d) => fetch(u, { method: "POST", body: d, headers: { "Content-Type": "application/json" }, keepalive: true }))
        .call(navigator, API + "/api/search/log", new Blob([body], { type: "application/json" }));
    } catch {}
  }
  const click = (q, id, position) => logEvent({ type: "click", q, id, position });
  const noClick = (q, resultCount) => logEvent({ type: "noclick", q, resultCount });

  window.MDFitSearch = { load, search, highlight, click, noClick };
})();
