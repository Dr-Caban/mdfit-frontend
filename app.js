// MD Fit homepage: content, booking widget, intake and newsletter, all from the Railway API.
(() => {
  const { GOOGLE_G, loadGoogleReviews, applyGoogleRating, $, $$, esc, get, api, fmtTime, fmtDate, todayInTz, addDays, telHref, wire, AREAS, areaChips, loadSite, mountBooker } = window.MDFit;

  $("#year").textContent = new Date().getFullYear();

  // ---- Mobile menu
  const menuBtn = $(".menu-btn"), menu = $("#menu");
  menuBtn.addEventListener("click", () => menuBtn.setAttribute("aria-expanded", menu.classList.toggle("open")));
  $$("#menu a").forEach((a) => a.addEventListener("click", () => { menu.classList.remove("open"); menuBtn.setAttribute("aria-expanded", false); }));

  // ---- Body-area chips (hero quick start + intake form)
  const renderAreas = (areas) => $$("[data-areas]").forEach((box) => (box.innerHTML = areaChips(areas)));
  renderAreas(AREAS);
  $("#quick-start").addEventListener("submit", (e) => {
    e.preventDefault();
    const picked = $$("input:checked", e.target).map((i) => i.value);
    $$("#lead-form [name=areas]").forEach((i) => (i.checked = picked.includes(i.value)));
    $("#intake").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => $("#lead-form [name=painLevel]").focus({ preventScroll: true }), 500);
  });

  // ---- Pain slider: "–" until touched, so we don't send a fake 0
  const pain = $("#lead-form [name=painLevel]"), painOut = $("#pain-out");
  pain.addEventListener("input", () => { delete pain.dataset.untouched; painOut.textContent = `${pain.value} / 10`; });
  $("#lead-form").addEventListener("reset", () => setTimeout(() => { pain.dataset.untouched = ""; painOut.textContent = "–"; }));

  // ---- Site content
  const SOCIAL_ICONS = {
    instagram: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM12 2c-2.7 0-3 0-4.1.1C4.3 2.3 2.3 4.3 2.1 7.9 2 9 2 9.3 2 12s0 3 .1 4.1c.2 3.6 2.2 5.6 5.8 5.8 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c3.6-.2 5.6-2.2 5.8-5.8.1-1.1.1-1.4.1-4.1s0-3-.1-4.1c-.2-3.6-2.2-5.6-5.8-5.8C15 2 14.7 2 12 2z"/>',
    facebook: '<path d="M14 8h3V4h-3c-2.8 0-5 2.2-5 5v2H7v4h2v7h4v-7h3l1-4h-4V9c0-.6.4-1 1-1z"/>',
    tiktok: '<path d="M16.5 3c.4 2.3 1.9 3.8 4.2 4v3.4c-1.5 0-3-.4-4.2-1.2v6.3a6 6 0 1 1-6-6h.6v3.5a2.6 2.6 0 1 0 2 2.5V3z"/>'
  };
  const options = (sel, list, keepFirst) => { sel.innerHTML = (keepFirst ? sel.options[0].outerHTML : "") + list.map((x) => `<option>${esc(x)}</option>`).join(""); };

  function renderSite(data) {
    const s = data.settings, b = s.business;
    $$("[data-bind]").forEach((el) => { const v = get(s, el.dataset.bind); if (v !== undefined && v !== "") el.textContent = v; });
    if (b.phone) $$("[data-phone-link]").forEach((a) => (a.href = telHref(b.phone)));
    $$("[data-maps]").forEach((a) => (a.href = b.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`));
    if (b.email) { $(".email-row").hidden = false; Object.assign($("[data-email-link]"), { href: "mailto:" + b.email, textContent: b.email }); }

    const o = data.options;
    const checked = $$("[data-areas] [name=areas]:checked").map((i) => i.value);
    renderAreas(o.areas);
    $$("[data-areas] [name=areas]").forEach((i) => (i.checked = checked.includes(i.value)));
    options($("#lead-form [name=service]"), o.services);
    options($("#lead-form [name=goal]"), o.goals);
    options($("#lead-form [name=duration]"), o.durations, true);
    options($("#lead-form [name=surgery]"), o.surgery, true);

    if (window.MDFitPricing) window.MDFitPricing.mount($(".pricing-app"), s);
    if (b.bookingNote) $("#pricing-sub").textContent = b.bookingNote;

    $(".coach-bio").innerHTML = s.coach.bio.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");
    if (s.coach.photoUrl) Object.assign($(".coach-photo"), { src: s.coach.photoUrl, alt: s.coach.name, hidden: false });

    const r = s.rating;
    $("#rating").hidden = !(r.score && r.count);
    $(".review-sum").innerHTML = r.score && r.count
      ? `<span class="stars" aria-hidden="true">★★★★★</span> <strong>${esc(r.score)} out of 5</strong> from ${esc(r.count)} reviews${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener">Read them on ${esc(r.source || "our review page")}</a>` : ""}`
      : "";
    $("#reviews").hidden = false;
    $(".quotes").innerHTML = s.testimonials.map((t) =>
      `<blockquote class="quote"><span class="stars" aria-hidden="true">★★★★★</span><p>&ldquo;${esc(t.quote)}&rdquo;</p><cite>${esc(t.name)}</cite></blockquote>`).join("");

    $(".contact").innerHTML = [
      b.address && `<li>${esc(b.address)}</li>`,
      b.phone && `<li><a href="${telHref(b.phone)}">${esc(b.phone)}</a></li>`,
      b.email && `<li><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></li>`,
      b.hours && `<li>${esc(b.hours)}</li>`
    ].filter(Boolean).join("");
    $(".socials").innerHTML = Object.keys(SOCIAL_ICONS).filter((k) => b[k])
      .map((k) => `<a href="${esc(b[k])}" target="_blank" rel="noopener" aria-label="${k}"><svg viewBox="0 0 24 24">${SOCIAL_ICONS[k]}</svg></a>`).join("");

    mountBooker($(".booker"), data);
    site = data;
    if (r.url) Object.assign($(".lr-google"), { hidden: false }).querySelector("a").href = r.url;
    loadGoogleReviews().then((g) => { if (g) { renderGoogleReviews(g); if (g.url) Object.assign($(".lr-google"), { hidden: false }).querySelector("a").href = g.url; } }).finally(loadSiteReviews);
    const code = new URLSearchParams(location.search).get("reward");
    if (code) redeem(code);
  }

  // Real Google reviews replace the hand-entered testimonials when the backend can reach Google.
  const starsFor = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
  function renderGoogleReviews(g) {
    applyGoogleRating(g);
    $("#reviews").hidden = false;
    $(".review-sum").innerHTML = `${GOOGLE_G}<span class="stars" aria-hidden="true">★★★★★</span> <strong>${g.rating.toFixed(1)} out of 5</strong> from ${g.count} Google reviews` +
      (g.url ? ` · <a href="${esc(g.url)}" target="_blank" rel="noopener">See all on Google</a>` : "");
    if (!g.reviews.length) return;
    $(".quotes").innerHTML = g.reviews.map((r) => `
      <blockquote class="quote g-review">
        <header>
          ${r.photo ? `<img src="${esc(r.photo)}" alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer">` : `<span class="g-initial">${esc(r.author.charAt(0))}</span>`}
          <div><cite>${r.authorUrl ? `<a href="${esc(r.authorUrl)}" target="_blank" rel="noopener">${esc(r.author)}</a>` : esc(r.author)}</cite>
            <small>${esc(r.relativeTime)}</small></div>
          ${GOOGLE_G}
        </header>
        <span class="stars" aria-label="${r.rating} out of 5 stars">${starsFor(r.rating)}</span>
        <p>${esc(r.text)}</p>
        <button type="button" class="more" hidden>Read more</button>
      </blockquote>`).join("");
    $$(".g-review").forEach((q) => {
      const p = $("p", q), more = $(".more", q);
      if (p.scrollHeight > p.clientHeight + 4) more.hidden = false;
      more.addEventListener("click", () => { q.classList.add("open"); more.hidden = true; });
    });
  }

  // ================= On-site reviews: easy form, reward for any rating, approved ones shown with a disclosure
  let site = null;
  async function loadSiteReviews() {
    let d; try { d = await api("/api/feedback"); } catch { return; }
    if (!d.reviews.length) return;
    $(".quotes").insertAdjacentHTML("beforeend", d.reviews.map((r) => `
      <blockquote class="quote site-review"><span class="stars" aria-label="${r.rating} out of 5 stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span>
        <p>&ldquo;${esc(r.text)}&rdquo;</p><cite>${esc(r.name)}</cite><small class="disclose">MD Fit client. Received a membership discount for sharing feedback.</small></blockquote>`).join(""));
  }
  async function redeem(code) {
    let r; try { r = await api(`/api/feedback/reward/${encodeURIComponent(code)}`); } catch { return; }
    if (!r.valid) return;
    mountBooker($(".booker"), site, { type: r.type.id, reward: { code, type: r.type } });
    const f = $(".booker [name=email]"); if (f && !f.value) { f.value = r.email; $(".booker [name=name]").value = r.name; }
    $("#book .sub").textContent = `Your free 30-minute plan review is unlocked. Pick a time below.`;
    setTimeout(() => $("#book").scrollIntoView({ behavior: "smooth" }), 150);
  }
  $("#review-form").addEventListener("change", (e) => { if (e.target.name === "rating") $("#review-form .form-msg").textContent = ""; });
  $("#review-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $(".form-msg", f);
    msg.className = "form-msg"; msg.textContent = "";
    const rating = Number((f.querySelector("[name=rating]:checked") || {}).value || 0);
    if (!rating) { msg.className = "form-msg err"; msg.textContent = "Tap the stars to rate your experience."; return; }
    if (!f.reportValidity()) return;
    const btn = $("button[type=submit]", f); btn.disabled = true;
    try {
      const out = await api("/api/feedback", { name: f.name.value, email: f.email.value, rating, text: f.text.value, publish: f.publish.checked, company: f.company.value });
      f.hidden = true;
      const done = $(".lr-done"); done.hidden = false;
      $(".lr-code", done).textContent = out.rewardCode;
      try { localStorage.setItem("mdfit_review_code", JSON.stringify(out.rewardCode)); } catch {}
    } catch (err) { msg.className = "form-msg err"; msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });


  // ================= Intake + newsletter =================
  wire($("#lead-form"), (data) => {
    if (pain.dataset.untouched !== undefined) delete data.painLevel;
    return api("/api/leads", data);
  });
  wire($("#news-form"), (data) => api("/api/subscribe", data));

  loadSite().then(renderSite).catch(() => {
    // Backend unreachable: keep the static page usable and point people to the phone
    options($("#lead-form [name=service]"), ["Not sure yet"]);
    options($("#lead-form [name=goal]"), ["Other"]);
    $(".pricing-app").innerHTML = `<p class="muted">Call 941-313-0562 for pricing.</p>`;
    $(".booker").innerHTML = `<div class="booker-step"><p>Online booking is unavailable right now. Call <a href="tel:+19413130562">941-313-0562</a> and we'll get you scheduled.</p></div>`;
    $("#reviews").hidden = true;
  });
})();
