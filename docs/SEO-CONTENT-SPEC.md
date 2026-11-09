# SEO content page spec (data/seo/pages/**/*.json)

Every condition, activity/audience, landing and blog page is **data**, rendered by `scripts/seo/build.js` into the
existing condition-page template. Write the JSON, never the HTML. Validate with `node scripts/seo/validate-page.js <file>`.

```jsonc
{
  "group": "conditions",            // conditions | activities | landing | blog
  "slug": "meniscus-tear-recovery", // URL = /conditions/<slug>, /activities/<slug>, /<slug> (landing), /blog/<slug>
  "title": "Meniscus Tear Recovery in Sarasota, FL | MD Fit",   // <= 60 characters, ends with " | MD Fit"
  "h1": "Meniscus Tear Recovery in Sarasota, FL",
  "description": "…",             // 120–160 characters, unique, plain text
  "about": { "type": "MedicalCondition", "name": "Meniscus tear" },  // conditions: MedicalCondition; activities: Thing; blog: omit
  "lead": "One or two sentences. Plain text.",
  "sections": [                      // 5–9 sections, in reading order. html: <p> <ul> <ol> <li> <b> <a href="/…"> only
    { "h2": "What a meniscus tear feels like", "html": "<p>…</p><ul><li>…</li></ul>" }
  ],
  "steps": null,                     // null = the standard 5-step MD Fit method; or 5 custom {"b":"Assess.","text":"…"} items
  "timeline": "Plain text about what to expect, or null when Dr. Jared must confirm it",
  "redFlags": ["Plain-text sentence", "…"],   // 3–6; chest/abdomen/head pages must say to call 911 for emergencies
  "faq": [ { "q": "…?", "a": "Plain text 1–3 sentences." } ],    // 3–5
  "muscles": ["vmo", "rectus-femoris"],       // ids from painmuscles.js (see data/seo/muscle-slugs.json keys), 2–6
  "pain": ["inside-of-knee", "below-kneecap"],// slugs from data/seo/pain-locations.json, 1–4
  "guides": ["quads"],                        // ids of /guides/<id>, 0–3
  "related": ["/conditions/knee-pain", "/treatments/post-op-rehab-timelines"],  // 3–8 existing or planned URLs
  "programs": ["golf"],                       // activities only: protocol ids in data/protocols (golf, pickleball, ski, marathon…)
  "datePublished": "2026-11-10", "dateModified": "2026-11-10",   // blog only
  "reviewStatus": "draft"                     // always "draft" until Dr. Jared signs off
}
```

Rules (from docs/SEO-PLAN.md): 700+ words of page-specific text in lead + sections + faq + redFlags + timeline;
no medical diagnosis claims ("educational", "often", "commonly"); no invented statistics, prices, timelines or
testimonials; Sarasota/Bradenton/Venice context only where it is true and useful; MD Fit's method is: assess,
release, correct, assign homework (free app videos), strengthen. Dr. Jared Caban is MD, MSc, CEP, CCEP, LMT.
Every page links the muscles and pain locations that drive it and at least 3 related pages.
