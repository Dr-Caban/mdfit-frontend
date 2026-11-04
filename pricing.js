// MD Fit pricing math + homepage pricing section. window.MDFitPricing
(function () {
  "use strict";
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const money2 = (n) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Every plan option for `sessions` visits of `svc`. Plans that include the evaluation (svc.withEval) add it to
  // the total: Gold pays for the evaluation and every visit upfront. Same math as the server (backend/lib/payments.js).
  function quote(svc, sessions, p, evalRate = 0) {
    const ev = svc.withEval ? evalRate : 0;
    const base = ev + svc.rate * sessions;
    const gold = base * (1 - p.gold / 100);
    const silver = base * (1 - p.silver / 100);
    const e12 = base * (1 + p.ext12 / 100), e24 = base * (1 + p.ext24 / 100);
    return {
      base, sessions, evalRate: ev,
      guarantee: sessions >= p.guaranteeMin,
      options: [
        { id: "gold", name: "Gold", tag: p.gold ? `Save ${p.gold}%` : "Paid in full", total: gold, pay: money(gold), per: `everything paid upfront`, save: base - gold },
        { id: "silver", name: "Silver", tag: p.silver ? `Save ${p.silver}%` : `${p.silverPayments} payments`, total: silver, pay: `${p.silverPayments} × ${money2(silver / p.silverPayments)}`, per: `one a month · ${money(silver)} total`, save: base - silver },
        { id: "payg", name: "Bronze", tag: "Pay as you go", total: base, pay: money(svc.rate), per: ev ? `per visit, paid on the day · evaluation ${money(ev)} on day one` : `per visit, paid on the day`, save: 0 },
        { id: "ext12", name: "Platinum · 12 months", tag: `+${p.ext12}%`, total: e12, pay: `${money2(e12 / 12)}/mo`, per: `12 payments · ${money(e12)} total`, save: base - e12 },
        { id: "ext24", name: "Platinum · 24 months", tag: `+${p.ext24}%`, total: e24, pay: `${money2(e24 / 24)}/mo`, per: `24 payments · ${money(e24)} total`, save: base - e24 }
      ]
    };
  }

  let payOn = false, pub = "";
  let mountArgs = null;
  function mount(root, settings) {
    mountArgs = { root, settings };
    const services = settings.services || [], p = settings.plans;
    if (!root || !services.length || !p) return;
    const proto = services.filter((s) => s.protocol);
    const state = { svc: (proto[0] || services[0]).id, n: p.packageSizes.includes(12) ? 12 : p.packageSizes[0] };
    const evalRate = (services.find((s) => s.id === "eval") || {}).rate || 0;
    const minMonthly = Math.min(...proto.map((s) => quote(s, Math.min(...p.packageSizes), p, evalRate).options.find((o) => o.id === "ext24").total / 24));

    root.innerHTML = `
      <div class="rates">${services.map((s) => `
        <article class="rate-card">
          <h3>${esc(s.name)}</h3>
          <div><span class="price">${money(s.rate)}</span> <span class="unit">· ${esc(s.unit || "visit")}</span></div>
          <p>${esc(s.description)}</p>
          ${s.protocol ? `<span class="rate-tag">Available as a protocol plan</span>` : `<span class="rate-tag first">Where every plan starts</span>`}
          ${payOn ? `<button type="button" class="btn btn-sm rate-buy" data-pay-service="${esc(s.id)}">Pay ${money(s.rate)}<small>Apple Pay · Google Pay · Link · Card</small></button>` : ""}
        </article>`).join("")}
      </div>

      <div class="ext-banner" role="note">
        <div>
          <p class="ext-kicker">Platinum payment plans</p>
          <p class="ext-big">Start your protocol today from <strong>${money2(minMonthly)}/mo</strong></p>
          <p class="ext-small">Spread any protocol over <b>12 months for just +${p.ext12}%</b> or <b>24 months for +${p.ext24}%</b>. Paid directly to MD Fit, no outside financing.</p>
        </div>
        <a href="#calc" class="btn">Build my plan</a>
      </div>

      <div class="calc" id="calc">
        <div class="calc-head">
          <h3>Protocol plan calculator</h3>
          <p class="muted">Pick the service and how many visits Dr. Jared recommends. Every price updates live.</p>
        </div>
        <div class="calc-controls">
          <div class="chips" role="radiogroup" aria-label="Service" data-k="svc">${proto.map((s) => `<button type="button" role="radio" data-v="${esc(s.id)}">${esc(s.name)}</button>`).join("")}</div>
          <div class="chips" role="radiogroup" aria-label="Number of visits" data-k="n">${p.packageSizes.map((n) => `<button type="button" role="radio" data-v="${n}">${n} visits</button>`).join("")}</div>
        </div>
        <div class="calc-out" aria-live="polite"></div>
      </div>

      <div class="price-extras">
        <article class="guarantee">
          <div class="seal" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 3l5 4 6-1 2 6 6 3-2 6 2 6-6 3-2 6-6-1-5 4-5-4-6 1-2-6-6-3 2-6-2-6 6-3 2-6 6 1z"/><path d="M16 24l6 6 11-12" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div>
            <h3>Money-back guarantee</h3>
            <p>On every plan of <strong>${p.guaranteeMin} or more visits</strong>. If all three are true, ask for a full refund, no questions asked:</p>
            <ol>
              <li>You followed the entire protocol to your provider's satisfaction.</li>
              <li>You completed every visit in the protocol.</li>
              <li>You did not see a significant change in your pain.</li>
            </ol>
          </div>
        </article>
      </div>`;

    const draw = () => {
      $$(".chips", root).forEach((g) => $$("button", g).forEach((b) => { const on = String(state[g.dataset.k]) === b.dataset.v; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); }));
      const svc = services.find((s) => s.id === state.svc), q = quote(svc, state.n, p, evalRate);
      $(".calc-out", root).innerHTML = `
        <div class="opts">${q.options.map((o) => `
          <div class="opt opt-${o.id}">
            <span class="opt-tag">${esc(o.tag)}</span>
            <h4>${esc(o.name)}</h4>
            <p class="opt-pay">${esc(o.pay)}</p>
            <p class="opt-per">${esc(o.per)}</p>
            ${o.save > 0 ? `<p class="opt-save">You save ${money(o.save)}</p>` : ""}
            ${q.guarantee && o.id !== "payg" ? `<p class="opt-g">✓ Money-back guarantee</p>` : ""}
            <p class="opt-credit">Earn up to ${money(q.credit(o.total))} back</p>
            ${payOn ? `<button type="button" class="opt-buy" data-buy="${o.id}">Start this plan</button>` : ""}
          </div>`).join("")}
        </div>
        <p class="calc-note">${q.evalRate ? `Evaluation ${money(q.evalRate)} + ` : ""}${state.n} × ${money(svc.rate)} ${esc(svc.name)} visits = ${money(q.base)} at the standard rate.${q.guarantee ? "" : ` Choose ${p.guaranteeMin}+ visits to add the money-back guarantee.`}${q.evalRate ? "" : " Medical massage needs no evaluation."}</p>`;
    };
    root.addEventListener("click", async (e) => {
      const buy = e.target.closest("[data-buy]");
      if (buy) {
        const M = window.MDFit, me = M && M.auth && M.auth.client && M.auth.client();
        if (!me) { location.href = "/login?next=" + encodeURIComponent("/#pricing"); return; }
        buy.disabled = true; buy.textContent = "Opening secure checkout…";
        try {
          const r = await M.apiAuth("POST", "/api/me/checkout/protocol", { service: state.svc, sessions: state.n, plan: buy.dataset.buy, ui: "embedded" });
          window.MDFitStripe.open({ clientSecret: r.clientSecret, publishableKey: pub });
        } catch (err) { alert(err.message); }
        buy.disabled = false; buy.textContent = "Start this plan";
        return;
      }
      const pay = e.target.closest("[data-pay-service]");
      if (pay) {
        const M = window.MDFit, me = M && M.auth && M.auth.client && M.auth.client();
        if (!me) { location.href = "/login?next=" + encodeURIComponent("/#pricing"); return; }
        pay.disabled = true;
        try {
          const r = await M.apiAuth("POST", "/api/me/checkout/service", { service: pay.dataset.payService, ui: "embedded" });
          window.MDFitStripe.open({ clientSecret: r.clientSecret, publishableKey: pub });
        } catch (err) { alert(err.message); }
        pay.disabled = false;
        return;
      }
      const b = e.target.closest(".chips button"); if (!b) return;
      const k = b.parentElement.dataset.k; state[k] = k === "n" ? Number(b.dataset.v) : b.dataset.v; draw();
    });
    draw();
    const cfgUrl = (window.MDFIT_CONFIG || {}).apiUrl;
    if (cfgUrl) fetch(cfgUrl + "/api/app/config").then((r) => r.json()).then((c) => {
      pub = c.stripePublishableKey || "";
      if (c.features && c.features.payments && pub) {
        payOn = true;
        // Re-mount the pricing section so each service card shows its new Pay button.
        if (mountArgs) mount(mountArgs.root, mountArgs.settings);
      }
    }).catch(() => {});
  }
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  window.MDFitPricing = { quote, mount, money };
})();
