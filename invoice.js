// The page a person opens from the link in an invoice email. The link's own address is the key: there is no sign-in.
// It shows the invoice number, the amount and the clinic's message, and sends them to Stripe's page to pay.
// Whether it is paid is always the server's answer (which asks Stripe), never this page's own guess.
(() => {
  const API = window.MDFIT_CONFIG.apiUrl.replace(/\/+$/, "");
  const q = new URLSearchParams(location.search), id = q.get("id") || "", back = q.get("paid") === "1";
  const $ = (x) => document.getElementById(x), msg = document.querySelector(".form-msg"), btn = $("go");
  const say = (text, kind) => { msg.className = "form-msg" + (kind ? " " + kind : ""); msg.textContent = text; };
  const usd = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Inside the MD Fit app, Stripe's page opens in the phone's own browser sheet (Apple Pay works there) and the app
  // is handed back afterwards, the same way its other payments work.
  const inApp = !!(window.MDFitNative && typeof window.MDFitNative.checkout === "function");
  const call = async (method, path) => { const res = await fetch(`${API}/api/invoices/${id}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(path === "/pay" && inApp ? { ui: "app" } : {}) : undefined }); const data = await res.json().catch(() => ({})); if (!res.ok) { const e = new Error(data.error || "Something went wrong. Please call 941-313-0562."); e.paid = !!data.paid; throw e; } return data; };
  function show(v) {
    $("title").textContent = `Invoice ${v.number}`;
    $("who").textContent = `For ${v.firstName}`;
    $("amount").textContent = usd(v.amount); $("amount").hidden = false;
    if (v.message) { $("note").textContent = v.message; $("note").hidden = false; }
    btn.hidden = v.status !== "unpaid"; $("paid").hidden = v.status !== "paid";
    if (v.status === "void") say("This invoice was withdrawn. If that is a surprise, call 941-313-0562.", "err");
  }
  if (!/^[0-9a-f]{32}$/.test(id)) { say("This invoice link is incomplete. Open the link from your email again, or call 941-313-0562.", "err"); return; }
  btn.addEventListener("click", async () => {
    btn.disabled = true; say("Opening the secure payment page…");
    try { const r = await call("POST", "/pay"); if (inApp) { window.MDFitNative.checkout(r.url, "service"); btn.disabled = false; say("Finish paying in the window that opened. This page updates when you come back."); } else location.href = r.url; }
    catch (err) { btn.disabled = false; if (err.paid) { say(""); call("GET", "").then(show).catch(() => {}); } else say(err.message, "err"); }
  });
  // Coming back to this page (from the payment window in the app, or another tab): ask the server where it stands
  document.addEventListener("visibilitychange", async () => { if (document.hidden || !$("paid").hidden) return; try { const v = await call("POST", "/confirm"); show(v); if (v.status === "paid") say(""); } catch {} });
  (async () => {
    try {
      let v = await call("GET", ""); show(v);
      if (back && v.status === "unpaid") {
        // back from Stripe: the server asks Stripe; a card payment can take a few seconds to settle
        btn.hidden = true; say("Confirming your payment…");
        for (let i = 0; i < 8 && v.status === "unpaid"; i++) { v = await call("POST", "/confirm"); if (v.status === "unpaid" && i < 7) await new Promise((r) => setTimeout(r, 3000)); }
        show(v); say(v.status === "paid" ? "" : "We could not confirm the payment yet. If you paid, you will get a receipt by email; there is no need to pay again.");
        if (v.status !== "paid") btn.hidden = true;
      }
    } catch (err) { say(err.message, "err"); }
  })();
})();
