// MD Fit admin: Settings → Habits. Edit the healthy-habit library (points, category, optional + safer alternative,
// on/off), the per-category daily caps and the level goals. Members see changes from their next day: today's goal
// and caps are frozen per member at their first visit of the day.
// Loaded before admin.js, which registers window.loadHabits as the "habits" tab loader.
(() => {
  const API = () => window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function api(method, path, body) {
    let token = ""; try { token = sessionStorage.getItem("mdfit_token") || ""; } catch {}
    const res = await fetch(API() + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  let cfg = null;
  const LV = [["beginner", "Beginner"], ["advanced", "Advanced"], ["elite", "Elite"]];

  function render() {
    const p = $("#habits-admin"); if (!p || !cfg) return;
    const catOpts = (sel) => cfg.categories.map((c) => `<option value="${esc(c.id)}"${c.id === sel ? " selected" : ""}>${esc(c.label)}</option>`).join("");
    p.innerHTML = `
      <p class="muted">Points members earn for each healthy habit. A day counts (qualifying day) when points reach the member's goal. Changes apply from each member's next day; today's goal and caps stay as they were.</p>
      <h2>Daily goals by level</h2>
      <div class="grid4">${LV.map(([k, l]) => `<label>${l}<input type="number" min="10" max="300" data-level="${k}" value="${esc(cfg.levels[k])}"></label>`).join("")}</div>
      <p class="muted">After ${cfg.reentry.after}+ days with no points, a member's goal restarts at ${cfg.reentry.start} and goes up ${cfg.reentry.step} for each active day until it's back to their level.</p>
      <h2>Categories and daily caps</h2>
      <div class="table-wrap"><table class="hba-cats"><thead><tr><th>Category</th><th>Max points a day</th></tr></thead><tbody>
        ${cfg.categories.map((c) => `<tr data-cat="${esc(c.id)}"><td><input data-f="label" maxlength="40" value="${esc(c.label)}" aria-label="Category name"></td><td><input data-f="cap" type="number" min="0" max="500" value="${esc(c.cap)}" aria-label="${esc(c.label)} daily cap"></td></tr>`).join("")}
      </tbody></table></div>
      <h2>Habits</h2>
      <div class="table-wrap"><table class="hba-habits"><thead><tr><th>On</th><th>Habit</th><th>Category</th><th>Points</th><th>Optional</th><th>Safer alternative / how-to</th></tr></thead><tbody>
        ${cfg.habits.map((h) => `<tr data-habit="${esc(h.id)}"${h.active === false ? ' class="off"' : ""}>
          <td><input type="checkbox" data-f="active"${h.active !== false ? " checked" : ""} aria-label="${esc(h.name)} on"></td>
          <td><input data-f="name" maxlength="80" value="${esc(h.name)}" aria-label="Habit name">${h.auto ? `<small class="muted">Also counted from the workout log</small>` : ""}</td>
          <td><select data-f="category" aria-label="Category">${catOpts(h.category)}</select></td>
          <td><input data-f="points" type="number" min="0" max="100" value="${esc(h.points)}" aria-label="${esc(h.name)} points"></td>
          <td><input type="checkbox" data-f="optional"${h.optional ? " checked" : ""} aria-label="${esc(h.name)} optional"></td>
          <td><textarea data-f="alternative" rows="3" maxlength="300" placeholder="Safer alternative (needed if optional)" aria-label="Safer alternative">${esc(h.alternative)}</textarea>
              <input data-f="how" maxlength="200" value="${esc(h.how)}" placeholder="How-to (short)" aria-label="How-to"></td></tr>`).join("")}
      </tbody></table></div>
      <div class="bar hba-actions"><button type="button" class="mini" id="hba-add">+ Add a habit</button><button type="button" class="mini" id="hba-reset">Restore the default list</button></div>
      <button type="button" class="btn" id="hba-save">Save habits</button>
      <p class="form-msg" role="status" id="hba-msg"></p>`;
  }
  // Read the form back into the shape PUT /api/admin/habits takes
  function collect() {
    const p = $("#habits-admin");
    const val = (tr, f) => $(`[data-f="${f}"]`, tr);
    const levels = Object.fromEntries($$("[data-level]", p).map((i) => [i.dataset.level, Number(i.value)]));
    const categories = $$("tr[data-cat]", p).map((tr) => ({ id: tr.dataset.cat, label: val(tr, "label").value.trim(), cap: Number(val(tr, "cap").value) }));
    const habits = $$("tr[data-habit]", p).map((tr) => ({ id: tr.dataset.habit, name: val(tr, "name").value.trim(), category: val(tr, "category").value, points: Number(val(tr, "points").value),
      optional: val(tr, "optional").checked, alternative: val(tr, "alternative").value.trim(), how: val(tr, "how").value.trim(), active: val(tr, "active").checked }));
    return { levels, categories, habits };
  }
  const msg = (t, err) => { const m = $("#hba-msg"); if (m) { m.textContent = t; m.className = "form-msg" + (err ? " err" : " ok"); } };

  async function loadHabits() {
    const p = $("#habits-admin"); if (!p) return;
    cfg = await api("GET", "/api/admin/habits");
    render();
  }
  document.addEventListener("click", async (e) => {
    const t = e.target; if (!t.closest || !t.closest("#habits-admin")) return;
    if (t.id === "hba-add") {
      const name = (prompt("Name of the new habit (for example: Sleep 7+ hours)") || "").trim(); if (!name) return;
      cfg = { ...cfg, ...collect() };
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "habit";
      while (cfg.habits.some((h) => h.id === id)) id += "-2";
      cfg.habits.push({ id, name, category: cfg.categories[0].id, points: 5, optional: false, alternative: "", how: "", active: true });
      render(); msg("Added. Save to make it live.");
    } else if (t.id === "hba-reset") {
      if (!confirm("Replace the habit list, caps and level goals with the defaults? (Not saved until you press Save.)")) return;
      cfg = { ...cfg, habits: cfg.defaults.habits.map((h) => ({ optional: false, alternative: "", how: "", active: true, ...h })), categories: cfg.defaults.categories, levels: cfg.defaults.levels };
      render(); msg("Defaults restored. Save to make them live.");
    } else if (t.id === "hba-save") {
      t.disabled = true;
      try { cfg = await api("PUT", "/api/admin/habits", collect()); render(); msg("Saved. Members see it from their next day."); }
      catch (err) { msg(err.message, true); }
      finally { const b = $("#hba-save"); if (b) b.disabled = false; }
    }
  });
  window.loadHabits = loadHabits;
})();
