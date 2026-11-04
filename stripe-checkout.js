// Embedded Stripe Checkout: mounts Stripe's in-page form in a dialog.
// Apple Pay, Google Pay, Link and card come automatically from Stripe's dynamic payment methods,
// which stay on because the server never passes payment_method_types.
(function () {
  "use strict";
  const STRIPE_JS = "https://js.stripe.com/v3/";
  let stripePromise = null;
  function loadStripe() {
    if (stripePromise) return stripePromise;
    stripePromise = new Promise((resolve, reject) => {
      if (window.Stripe) return resolve(window.Stripe);
      const s = document.createElement("script"); s.src = STRIPE_JS; s.async = true;
      s.onload = () => resolve(window.Stripe); s.onerror = () => reject(new Error("Couldn't load Stripe."));
      document.head.appendChild(s);
    });
    return stripePromise;
  }

  let dlg, mount;
  function ensure() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "stripe-dlg";
    dlg.innerHTML = `
      <header><b>Secure checkout</b><button type="button" aria-label="Close" class="stripe-close">&times;</button></header>
      <p class="stripe-meta">Powered by Stripe · Apple Pay · Google Pay · Link · Card</p>
      <div class="stripe-mount" id="stripe-mount"></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector(".stripe-close").addEventListener("click", () => close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
    mount = dlg.querySelector(".stripe-mount");
    return dlg;
  }
  let embedded;
  async function open({ clientSecret, publishableKey }) {
    if (!clientSecret || !publishableKey) throw new Error("Checkout isn't ready.");
    ensure();
    mount.innerHTML = `<p class="stripe-loading">Loading secure checkout…</p>`;
    dlg.showModal();
    const Stripe = await loadStripe();
    const stripe = Stripe(publishableKey);
    mount.innerHTML = "";
    if (embedded) { try { embedded.destroy(); } catch {} embedded = null; }
    embedded = await stripe.initEmbeddedCheckout({ clientSecret });
    embedded.mount(mount);
  }
  function close() {
    if (embedded) { try { embedded.destroy(); } catch {} embedded = null; }
    if (dlg && dlg.open) dlg.close();
    if (mount) mount.innerHTML = "";
  }
  window.MDFitStripe = { open, close, loadStripe };
})();
