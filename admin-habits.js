// MD Fit admin: Settings → Activities. Edit the daily activities list (name, XP, how-to line, on/off) and the daily goal.
// The two challenge items are earned automatically and their XP is fixed by the XP rules.
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

  function render() {
    const p = $("#habits-admin"); if (!p || !cfg) return;
    p.innerHTML = `
      <p class="muted">Daily activities members check off for extra XP (once each per day). The XP goes into their lifetime total and gem level. A check keeps the XP it was earned with, so changes here apply to new checks only.</p>
      <label class="hba-goal">Daily goal (XP from activities + workout for a day to count toward the streak)<input type="number" min="10" max="500" id="hba-goal" value="${esc(cfg.dailyGoal)}"></label>
      <div class="table-wrap"><table class="hba-habits"><thead><tr><th>On</th><th>Activity</th><th>XP</th><th>How (one short line)</th></tr></thead><tbody>
        ${cfg.habits.map((h) => `<tr data-habit="${esc(h.id)}"${h.active === false ? ' class="off"' : ""}>
          <td><input type="checkbox" data-f="active"${h.active !== false ? " checked" : ""} aria-label="${esc(h.name)} on"></td>
          <td><input data-f="name" maxlength="80" value="${esc(h.name)}" aria-label="Activity name">${h.auto ? `<small class="muted">Earned automatically by the challenge flow</small>` : ""}</td>
          <td><input data-f="points" type="number" min="0" max="100" value="${esc(h.points)}" aria-label="${esc(h.name)} XP"${h.auto ? " disabled" : ""}></td>
          <td><input data-f="how" maxlength="200" value="${esc(h.how)}" placeholder="How-to (short)" aria-label="How-to"></td></tr>`).join("")}
      </tbody></table></div>
      <div class="bar hba-actions"><button type="button" class="mini" id="hba-add">+ Add an activity</button><button type="button" class="mini" id="hba-reset">Restore the default list</button></div>
      <button type="button" class="btn" id="hba-save">Save activities</button>
      <p class="form-msg" role="status" id="hba-msg"></p>`;
  }
  // Read the form back into the shape PUT /api/admin/habits takes
  function collect() {
    const p = $("#habits-admin");
    const val = (tr, f) => $(`[data-f="${f}"]`, tr);
    const habits = $$("tr[data-habit]", p).map((tr) => ({ id: tr.dataset.habit, name: val(tr, "name").value.trim(), points: Number(val(tr, "points").value),
      how: val(tr, "how").value.trim(), active: val(tr, "active").checked }));
    return { habits, dailyGoal: Number($("#hba-goal").value) };
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
      const name = (prompt("Name of the new activity (for example: Sleep 7+ hours)") || "").trim(); if (!name) return;
      cfg = { ...cfg, ...collect() };
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "activity";
      while (cfg.habits.some((h) => h.id === id)) id += "-2";
      cfg.habits.push({ id, name, points: 5, how: "", active: true });
      render(); msg("Added. Save to make it live.");
    } else if (t.id === "hba-reset") {
      if (!confirm("Replace the activity list and daily goal with the defaults? (Not saved until you press Save.)")) return;
      cfg = { ...cfg, habits: cfg.defaults.habits.map((h) => ({ how: "", active: true, ...h })), dailyGoal: cfg.defaults.dailyGoal };
      render(); msg("Defaults restored. Save to make them live.");
    } else if (t.id === "hba-save") {
      t.disabled = true;
      try { cfg = await api("PUT", "/api/admin/habits", collect()); render(); msg("Saved. New checks use the new XP."); }
      catch (err) { msg(err.message, true); }
      finally { const b = $("#hba-save"); if (b) b.disabled = false; }
    }
  });
  window.loadHabits = loadHabits;
})();
