/**
 * paywallUI.js
 * Renders pricing modal, plan badges, usage meters, and upgrade prompts.
 * Import this into any project's app.js and call initPaywall().
 *
 * CSP: no inline scripts or inline event handlers. Every control is wired
 * with addEventListener inside this module.
 * Pricing: paid plans only (decision #94). Early access = promo codes.
 * Checkout: fails closed. Plan buttons call checkout only when CHECKOUT_OPEN.
 * Entitlement: the scanner API is the gate (402 without a paid plan, before any
 * data-provider call) and counts usage server-side. This module never writes
 * usage or subscription docs; it shows the API's answer honestly.
 */

import {
  PLANS, CHECKOUT_OPEN, hasPaidPlan,
  getSubscription, onSubscriptionChange, getUsage,
  mountEmbeddedCheckout, openCustomerPortal
} from "./paymentService.js";
import { ApiError, apiErrorMessage } from "../config/env.js";

const NO_PLAN = { plan: "none", status: "none" };
const EARLY_ACCESS_MAILTO =
  "mailto:hello@mdo3d.com?subject=" + encodeURIComponent("RonnaScanner early-access code");

let _userId = null;
let _subscription = { ...NO_PLAN };
let _unsubscribe = null;
let _lastFocus = null;

function currentPlanKey() {
  return hasPaidPlan(_subscription) ? _subscription.plan : null;
}

// Flat whole dollars (no *.99). null = not set yet: Stripe shows the amount at checkout.
function fmtPrice(n) {
  return Number.isFinite(n) ? `$${Math.round(n)}<span>/mo</span>` : `<span class="plan-price-tbd">Price shown at checkout</span>`;
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
// Sign-in is checked here; the plan check is the API's (402). No client-side
// counter: the server meters paid calls and has no unpaid allowance.
export async function gate(action, onAllowed, onBlocked) {
  if (!_userId) { onBlocked?.(); showAuthPrompt(); return; }
  return onAllowed();
}

/**
 * Handle an error from a scanner call. Shows the sign-in prompt on 401 and the
 * paywall on 402. Returns { title, detail } for the tool's empty state.
 */
export function handleApiError(err, action = "scan") {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) showAuthPrompt();
  if (status === 402) showUpgradePrompt(action);
  const title = status === 501 ? "This tool isn't open yet."
    : status === 402 ? "A Pro or Team plan is required."
    : status === 401 ? "Sign in to continue."
    : status === 429 ? "Too many requests."
    : "The scanner service is unavailable right now.";
  return { status, title, detail: apiErrorMessage(err) };
}

// ─── Pricing modal ────────────────────────────────────────────────────────────
function planButtonHtml(key, plan) {
  const current = currentPlanKey();
  if (current === key) {
    return CHECKOUT_OPEN
      ? `<button type="button" class="plan-btn manage-btn" data-paywall-action="portal">Manage plan</button>`
      : `<button type="button" class="plan-btn soon-btn" disabled>Billing portal coming soon</button>`;
  }
  if (!CHECKOUT_OPEN) {
    return `<button type="button" class="plan-btn soon-btn" disabled>${esc(plan.name)} — coming soon</button>`;
  }
  const verb = current ? "Switch to" : "Get";
  return `<button type="button" class="plan-btn upgrade-btn" data-paywall-action="checkout" data-plan="${esc(key)}">${verb} ${esc(plan.name)}</button>`;
}

/**
 * @param {string} highlightPlan plan key to badge as recommended (no "most popular": there is no sales data)
 * @param {{action?:string}} [limitInfo] set when opened from a 402 (no paid plan)
 */
export function showPricingModal(highlightPlan = "pro", limitInfo = null) {
  removePricingModal();
  _lastFocus = document.activeElement;
  const current = currentPlanKey();
  const subline = limitInfo
    ? `A Pro or Team plan is required to run ${esc(limitInfo.action || "scan")}s. RonnaScanner is a paid tool.`
    : "RonnaScanner is a paid tool. Pick the plan that fits your work.";

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
              : key === highlightPlan ? '<div class="popular-badge">Recommended</div>' : ""}
            <h3 class="plan-name">${esc(plan.name)}</h3>
            <div class="plan-price">${fmtPrice(plan.price)}</div>
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
        if (PLANS[btn.dataset.plan]) startEmbeddedCheckout(btn.dataset.plan);
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
    await openCustomerPortal();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { closePricingModal(); showAuthPrompt(); return; }
    showCheckoutError(`Billing portal unavailable: ${e instanceof ApiError ? apiErrorMessage(e) : ((e && e.message) || "please try again")}`);
  }
}

async function startEmbeddedCheckout(planKey) {
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
    const checkout = await mountEmbeddedCheckout("stripe-checkout-mount", planKey);
    // Store reference for cleanup
    window._stripeCheckout = checkout;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { closePricingModal(); showAuthPrompt(); return; }
    // 409 already subscribed, 503 not open, 429, 400: the API's own message is honest.
    showCheckoutError(`Checkout failed: ${e instanceof ApiError ? apiErrorMessage(e) : ((e && e.message) || "the payment form could not load")}`);
  }
}

// ─── Upgrade prompt (inline banner, shown on a 402) ──────────────────────────
export function showUpgradePrompt(action = "scan") {
  removeUpgradePrompt();
  const banner = document.createElement("div");
  banner.id = "upgrade-prompt";
  banner.className = "upgrade-prompt";
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <div class="upgrade-content">
      <div class="upgrade-icon" aria-hidden="true">🚀</div>
      <div class="upgrade-text">
        <strong>A Pro or Team plan is required to run ${esc(action)}s</strong>
        <p>${CHECKOUT_OPEN
          ? "No results were generated. Choose a plan to continue."
          : `No results were generated. Plans are coming soon. Have an early-access code? <a href="${EARLY_ACCESS_MAILTO}" class="upgrade-link">Contact us</a>.`}</p>
      </div>
      <button type="button" class="upgrade-cta" id="upgrade-cta-btn">See plans</button>
      <button type="button" class="upgrade-dismiss" id="upgrade-dismiss-btn" aria-label="Dismiss">&times;</button>
    </div>`;
  // Insert after hero or at top of tool section
  const toolSection = document.querySelector(".tool-section") || document.body;
  toolSection.insertBefore(banner, toolSection.firstChild);
  banner.querySelector("#upgrade-cta-btn").addEventListener("click", () => showPricingModal("pro", { action }));
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
// Paid: this month's count, read from the API-written usage doc (read-only).
// No paid plan: says a plan is required (there is no unpaid allowance to meter).
export async function renderUsageMeter(containerId, action) {
  const container = document.getElementById(containerId);
  if (!container || !_userId) return;
  const span = document.createElement("span");
  if (currentPlanKey()) {
    const used = await getUsage(_userId, action);
    span.className = "usage-unlimited";
    span.textContent = used === null
      ? `${PLANS[currentPlanKey()].name} plan active`
      : `${PLANS[currentPlanKey()].name} plan · ${used} ${action} this month`;
    container.replaceChildren(span);
    return;
  }
  container.innerHTML = `
    <div class="usage-meter">
      <div class="usage-label"><span>A Pro or Team plan is required to run ${esc(action)}.</span><button type="button" class="usage-upgrade">See plans</button></div>
    </div>`;
  container.querySelector(".usage-upgrade").addEventListener("click", () => showPricingModal("pro"));
}

export function getCurrentPlan() { return currentPlanKey() || "none"; }
export function getSubscriptionData() { return _subscription; }
