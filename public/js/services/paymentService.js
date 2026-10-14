import { STRIPE_KEY, PRO_CHECKOUT_ENABLED, apiFetch, ApiError } from "../config/env.js";

/**
 * paymentService.js
 * Subscription state (read-only from Firestore) + Stripe checkout / billing portal
 * through the scanner API (mdothree/ronnascanner-api, AUDIT §7a).
 *
 * Contract with the API:
 *  - Every payment call sends `Authorization: Bearer <Firebase ID token>` (apiFetch).
 *    The API takes the user from the token. No userId is ever sent.
 *  - Checkout sends only the plan key ("pro" | "team") and the tool name. The server
 *    owns the Stripe price and the success / cancel URLs; sending a URL, an amount
 *    or a price object is refused with 400.
 *  - subscriptions/{uid} and usage/{uid}_{YYYY-MM} are written only by the API
 *    (Admin SDK). Firestore rules deny client writes, so this module only reads them.
 */

import { db } from "../config/firebase.js";
import {
  doc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── Plans ───────────────────────────────────────────────────────────────────
// Paid plans only (decision #94): no zero-price tier, paid from first use; early
// access is a Stripe promotion code entered at checkout.
// Features list only what the API does today. Pro and Team unlock the same thing
// on the server (lib/quota.js PAID_PLANS); Team adds nothing yet, so it claims
// nothing extra. Price: not set yet (flat whole dollars, no *.99; JARVIS
// MDO-RONNA-PRICE). With price null the cards say the price is shown at checkout,
// where Stripe shows the real amount.
export const PLANS = {
  pro: {
    name: "Pro",
    price: null,
    features: [
      "Lead scans: up to 100 companies per scan",
      "Email finder by name and company domain",
      "Save results to your account",
      "CSV and JSON export"
    ]
  },
  team: {
    name: "Team",
    price: null,
    features: ["Everything in Pro"]
  }
};

const ACTIVE_STATUSES = ["active", "trialing"];

// Mirrors the API's isPaidSubscription: a Pro/Team plan in an active status.
export function hasPaidPlan(sub) {
  return !!(sub && Object.prototype.hasOwnProperty.call(PLANS, sub.plan) && ACTIVE_STATUSES.includes(sub.status));
}

// ─── Checkout gate (fails closed) ────────────────────────────────────────────
export const CHECKOUT_OPEN = PRO_CHECKOUT_ENABLED && !!STRIPE_KEY;
const CHECKOUT_CLOSED_MSG = "Checkout is not open yet. No payment can be taken on this site right now.";
function assertCheckoutOpen() {
  if (!CHECKOUT_OPEN) throw new Error(CHECKOUT_CLOSED_MSG);
}

// The tool this page is (leads, emails, ...). The API uses it to pick the fixed
// success / cancel pages; it falls back to the allowlisted Origin when absent.
const TOOLS = ["leads", "emails", "contacts", "companies", "prospects"];
export function currentTool() {
  const host = (typeof location !== "undefined" && location.hostname) || "";
  const sub = host.split(".")[0];
  return TOOLS.includes(sub) ? sub : null;
}

function checkoutBody(planKey) {
  if (!Object.prototype.hasOwnProperty.call(PLANS, planKey)) throw new ApiError(400, "unknown_price", "Unknown plan.");
  const tool = currentTool();
  return tool ? { priceId: planKey, tool } : { priceId: planKey };
}

// ─── Stripe loader ────────────────────────────────────────────────────────────
let _stripe = null;
async function getStripe(publishableKey) {
  assertCheckoutOpen();
  if (_stripe) return _stripe;
  await loadScript("https://js.stripe.com/v3/");
  _stripe = Stripe(STRIPE_KEY || publishableKey);
  return _stripe;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Subscription state (read-only) ──────────────────────────────────────────
export async function getSubscription(userId) {
  try {
    const snap = await getDoc(doc(db, "subscriptions", userId));
    if (!snap.exists()) return { plan: "none", status: "none" };
    return snap.data();
  } catch {
    return { plan: "none", status: "none" };
  }
}

export function onSubscriptionChange(userId, callback) {
  return onSnapshot(doc(db, "subscriptions", userId), snap => {
    callback(snap.exists() ? snap.data() : { plan: "none", status: "none" });
  }, () => callback({ plan: "none", status: "none" }));
}

export async function isPro(userId) {
  return hasPaidPlan(await getSubscription(userId));
}

// ─── Usage (read-only; the API counts paid calls server-side) ─────────────────
export async function getUsage(userId, action) {
  const month = new Date().toISOString().slice(0, 7);
  try {
    const snap = await getDoc(doc(db, "usage", `${userId}_${month}`));
    return snap.exists() ? (snap.data()[action] || 0) : 0;
  } catch {
    return null; // unknown, not zero
  }
}

// ─── Stripe Checkout (redirect flow) ──────────────────────────────────────────
export async function createCheckoutSession(planKey) {
  assertCheckoutOpen();
  return apiFetch("/api/payment/create-session", checkoutBody(planKey)); // { sessionId, url }
}

// ─── Stripe Embedded Checkout ─────────────────────────────────────────────────
export async function mountEmbeddedCheckout(containerId, planKey) {
  assertCheckoutOpen();
  const { clientSecret, publishableKey } = await apiFetch("/api/payment/create-embedded-session", checkoutBody(planKey));
  if (!clientSecret) throw new Error("the payment form could not load");
  const stripe = await getStripe(publishableKey);
  const checkout = await stripe.initEmbeddedCheckout({ clientSecret });
  checkout.mount(`#${containerId}`);
  return checkout; // call checkout.destroy() to unmount
}

// ─── Customer portal (the caller's own account only) ─────────────────────────
export async function openCustomerPortal() {
  assertCheckoutOpen();
  const { url } = await apiFetch("/api/payment/portal", {});
  if (!url || !/^https:\/\//.test(url)) throw new Error("the billing portal could not open");
  window.location.href = url;
}
