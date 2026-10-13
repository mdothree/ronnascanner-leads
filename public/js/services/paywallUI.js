/**
 * paywallUI.js
 * Renders pricing modal, plan badges, usage meters, and upgrade prompts.
 * Import this into any project's app.js and call initPaywall().
 *
 * CSP: no inline scripts or inline event handlers. Every control is wired
 * with addEventListener inside this module.
 * Pricing: paid plans only (decision #94). Early access = promo codes.
 * Checkout: fails closed. Plan buttons call checkout only when CHECKOUT_OPEN.
 */

import {
  PLANS, PREVIEW_LIMIT, CHECKOUT_OPEN, hasPaidPlan,
  getSubscription, onSubscriptionChange,
  checkLimit, trackUsage,
  mountEmbeddedCheckout, openCustomerPortal
} from "./paymentService.js";

const NO_PLAN = { plan: "none", status: "none" };
const EARLY_ACCESS_MAILTO =
  "mailto:hello@mdo3d.com?subject=" + encodeURIComponent("Ronna Scanner early-access code");

let _userId = null;
let _subscription = { ...NO_PLAN };
let _unsubscribe = null;
let _lastFocus = null;

function currentPlanKey() {
  return hasPaidPlan(_subscription) ? _subscription.plan : null;
}

function limitFor(action) {
  const key = currentPlanKey();
  return key ? (PLANS[key].limits?.[action] ?? Infinity) : PREVIEW_LIMIT;
}

function fmtPrice(n) {
  return `$${Number(n).toFixed(2)}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ─── Init (call once after auth) ─────────────────────────────────────────────
export async function initPaywall(userId) {
  _userId = userId;
  if (!userId) { _subscription = { ...NO_PLAN }; updateUI(); return; }

  _subscription = await getSubscription(userId);
  updateUI();

  if (_unsubscribe) _unsubscribe();
  _unsubscribe = onSubscriptionChange(userId, sub => {
    _subscription = sub;
    updateUI();
    // Close paywall modal if just subscribed
    if (hasPaidPlan(sub)) closePricingModal();
  });
}

// ─── Gate check ──────────────────────────────────────────────────────────────
export async function gate(action, onAllowed, onBlocked) {
  if (!_userId) { showAuthPrompt(); return; }

  const limit = limitFor(action);
  const { allowed, reason, used, limit: lim } = await checkLimit(_userId, action, limit);

  if (allowed) {
    await trackUsage(_userId, action);
    onAllowed();
  } else {
    if (reason === "login") { showAuthPrompt(); return; }
    onBlocked?.();
    showUpgradePrompt(action, used, lim);
  }
}

// ─── Pricing modal ────────────────────────────────────────────────────────────
function planButtonHtml(key, plan) {
  const current = currentPlanKey();
  if (current === key) {
    return CHECKOUT_OPEN
      ? `<button type="button" class="plan-btn manage-btn" data-paywall-action="portal">Manage plan</button>`
      : `<button type="button" class="plan-btn soon-btn" disabled>Billing portal coming soon</button>`;
  }
  if (!CHECKOUT_OPEN || !plan.priceId) {
    return `<button type="button" class="plan-btn soon-btn" disabled>${esc(plan.name)} — coming soon</button>`;
  }
  const verb = current ? "Switch to" : "Get";
  return `<button type="button" class="plan-btn upgrade-btn" data-paywall-action="checkout" data-plan="${esc(key)}">${verb} ${esc(plan.name)}</button>`;
}

/**
 * @param {string} highlightPlan plan key to badge as most popular
 * @param {{action?:string, used?:number, limit?:number}} [limitInfo] set when opened from a usage-limit hit
 */
export function showPricingModal(highlightPlan = "pro", limitInfo = null) {
  removePricingModal();
  _lastFocus = document.activeElement;
  const current = currentPlanKey();
  const subline = limitInfo && Number.isFinite(limitInfo.limit)
    ? `You've used ${limitInfo.used ?? limitInfo.limit} of ${limitInfo.limit} preview ${esc(limitInfo.action || "use")}s this month. Ronna Scanner is a paid tool.`
    : "Ronna Scanner is a paid tool. Pick the plan that fits your work.";

  const overlay = document.createElement("div");
  overlay.id = "pricing-modal-overlay";
  overlay.className = "pricing-overlay";
  overlay.innerHTML = `
    <div class="pricing-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-modal-title" aria-describedby="pricing-modal-desc">
      <button type="button" class="pricing-close" id="pricing-close-btn" aria-label="Close">&times;</button>
      <div class="pricing-header">
        <h2 id="pricing-modal-title">Choose your plan</h2>
        <p id="pricing-modal-desc">${subline}</p>
      </div>
      <div class="pricing-cards">
        ${Object.entries(PLANS).map(([key, plan]) => `
          <div class="pricing-card ${key === highlightPlan ? "highlighted" : ""} ${current === key ? "current" : ""}">
            ${current === key ? '<div class="current-badge">Current plan</div>'
              : key === highlightPlan ? '<div class="popular-badge">Most popular</div>' : ""}
            <h3 class="plan-name">${esc(plan.name)}</h3>
            <div class="plan-price">${fmtPrice(plan.price)}<span>/mo</span></div>
            <ul class="plan-features">
              ${plan.features.map(f => `<li>✓ ${esc(f)}</li>`).join("")}
            </ul>
            ${planButtonHtml(key, plan)}
          </div>
        `).join("")}
      </div>
      <div class="pricing-promo">
        <p>Have an early-access code? <a href="${EARLY_ACCESS_MAILTO}" class="pricing-promo-link">Contact us</a> and we'll set up your account.</p>
      </div>
      <div class="pricing-footer">
        <p>${CHECKOUT_OPEN
          ? "Payments processed by Stripe · Cancel anytime · No contracts"
          : "Checkout is not open yet. No payment can be taken on this site right now."}</p>
        <div id="stripe-embedded-container" class="stripe-embedded hidden"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector("#pricing-close-btn");
  closeBtn.addEventListener("click", closePricingModal);
  overlay.addEventListener("click", e => { if (e.target === overlay) closePricingModal(); });
  overlay.addEventListener("keydown", e => { if (e.key === "Escape") closePricingModal(); });

  overlay.querySelectorAll("[data-paywall-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.paywallAction;
      if (act === "checkout") {
        const plan = PLANS[btn.dataset.plan];
        if (plan) startEmbeddedCheckout(plan.priceId, btn.dataset.plan);
      } else if (act === "portal") {
        openPortal();
      }
    });
  });

  closeBtn.focus();
}

export function closePricingModal() {
  const had = !!document.getElementById("pricing-modal-overlay");
  removePricingModal();
  if (had && _lastFocus && typeof _lastFocus.focus === "function") _lastFocus.focus();
  _lastFocus = null;
}
function removePricingModal() {
  const el = document.getElementById("pricing-modal-overlay");
  if (el) el.remove();
}

function showCheckoutError(msg) {
  const container = document.getElementById("stripe-embedded-container");
  if (!container) return;
  container.classList.remove("hidden");
  const err = document.createElement("p");
  err.className = "checkout-error";
  err.setAttribute("role", "alert");
  err.textContent = msg;
  container.replaceChildren(err);
}

async function openPortal() {
  if (!CHECKOUT_OPEN) return;
  try {
    await openCustomerPortal(_userId);
  } catch (e) {
    showCheckoutError(`Billing portal unavailable: ${(e && e.message) || "please try again"}`);
  }
}

async function startEmbeddedCheckout(priceId, planKey) {
  if (!CHECKOUT_OPEN) return; // fail closed: never reach Stripe while checkout is gated
  if (!_userId) { closePricingModal(); showAuthPrompt(); return; }
  const container = document.getElementById("stripe-embedded-container");
  if (!container) return;
  container.classList.remove("hidden");
  const mount = document.createElement("div");
  mount.id = "stripe-checkout-mount";
  mount.className = "stripe-checkout-mount";
  container.replaceChildren(mount);
  try {
    const checkout = await mountEmbeddedCheckout("stripe-checkout-mount", priceId, _userId);
    // Store reference for cleanup
    window._stripeCheckout = checkout;
  } catch (e) {
    showCheckoutError(`Checkout failed: ${(e && e.message) || "the payment form could not load"}`);
  }
}

// ─── Upgrade prompt (inline banner) ──────────────────────────────────────────
export function showUpgradePrompt(action, used, limit) {
  removeUpgradePrompt();
  const pro = PLANS.pro;
  const banner = document.createElement("div");
  banner.id = "upgrade-prompt";
  banner.className = "upgrade-prompt";
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <div class="upgrade-content">
      <div class="upgrade-icon" aria-hidden="true">🚀</div>
      <div class="upgrade-text">
        <strong>You've used ${used} of ${limit} preview ${esc(action)}s this month</strong>
        <p>${CHECKOUT_OPEN
          ? `Pro is ${fmtPrice(pro.price)}/mo for unlimited ${esc(action)}s.`
          : `Pro (${fmtPrice(pro.price)}/mo) is coming soon. Have an early-access code? <a href="${EARLY_ACCESS_MAILTO}" class="upgrade-link">Contact us</a>.`}</p>
      </div>
      <button type="button" class="upgrade-cta" id="upgrade-cta-btn">See plans</button>
      <button type="button" class="upgrade-dismiss" id="upgrade-dismiss-btn" aria-label="Dismiss">&times;</button>
    </div>`;
  // Insert after hero or at top of tool section
  const toolSection = document.querySelector(".tool-section") || document.body;
  toolSection.insertBefore(banner, toolSection.firstChild);
  banner.querySelector("#upgrade-cta-btn").addEventListener("click", () => showPricingModal("pro", { action, used, limit }));
  banner.querySelector("#upgrade-dismiss-btn").addEventListener("click", removeUpgradePrompt);
}

function removeUpgradePrompt() {
  const el = document.getElementById("upgrade-prompt");
  if (el) el.remove();
}

// ─── Auth prompt ──────────────────────────────────────────────────────────────
function showAuthPrompt() {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.remove("hidden");
}

// ─── Plan badge (nav) ─────────────────────────────────────────────────────────
function updateUI() {
  const key = currentPlanKey();
  // Update plan badge in nav if it exists
  const badge = document.getElementById("plan-badge");
  if (badge) {
    badge.textContent = key ? PLANS[key].name : "";
    badge.className = `plan-badge plan-badge-${key || "none"}`;
    badge.style.display = key ? "inline-block" : "none";
  }
  // Update upgrade button visibility
  const upgradeBtn = document.getElementById("nav-upgrade");
  if (upgradeBtn) {
    upgradeBtn.style.display = key ? "none" : "";
  }
  // Show/hide manage button
  const manageBtn = document.getElementById("nav-manage");
  if (manageBtn) {
    manageBtn.style.display = key ? "" : "none";
  }
}

// ─── Usage meter widget ───────────────────────────────────────────────────────
export async function renderUsageMeter(containerId, action) {
  const container = document.getElementById(containerId);
  if (!container || !_userId) return;
  const limit = limitFor(action);
  if (limit === Infinity) {
    const span = document.createElement("span");
    span.className = "usage-unlimited";
    span.textContent = `✓ Unlimited ${action}s`;
    container.replaceChildren(span);
    return;
  }
  const { used = 0 } = await checkLimit(_userId, action, limit);
  const pct = Math.min(100, (used / limit) * 100);
  container.innerHTML = `
    <div class="usage-meter">
      <div class="usage-label"><span>${used} / ${limit} preview ${esc(action)}s used</span><button type="button" class="usage-upgrade">See plans</button></div>
      <div class="usage-bar"><div class="usage-fill ${pct > 80 ? "warning" : ""}"></div></div>
    </div>`;
  container.querySelector(".usage-fill").style.width = `${pct}%`;
  container.querySelector(".usage-upgrade").addEventListener("click", () =>
    showPricingModal("pro", used >= limit ? { action, used, limit } : null));
}

export function getCurrentPlan() { return currentPlanKey() || "none"; }
export function getSubscriptionData() { return _subscription; }
