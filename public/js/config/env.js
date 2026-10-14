/**
 * config/env.js
 * Centralized environment configuration.
 * Reads from import.meta.env (Vite) or falls back to window.__ENV__ (runtime injection).
 * All app.js files import API_URL and STRIPE_KEY from here — never hardcoded.
 */

const meta = (import.meta && import.meta.env) || {};
const win  = (typeof window !== "undefined" && window.__ENV__) || {};

// ─── Helper ───────────────────────────────────────────────────────────────────
function env(key, fallback = "") {
  return meta[key] || win[key] || fallback;
}

// ─── API ──────────────────────────────────────────────────────────────────────
const isLocalhost = typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export const API_URL = env("VITE_API_URL", isLocalhost ? "" : "");
// Empty string = same-origin (Vercel serves both static + /api on same domain)
// Set VITE_API_URL only when your API lives on a different domain

// ─── Stripe ───────────────────────────────────────────────────────────────────
export const STRIPE_KEY = isLocalhost
  ? env("VITE_STRIPE_PUBLISHABLE_KEY_TEST", env("VITE_STRIPE_PUBLISHABLE_KEY", ""))
  : env("VITE_STRIPE_PUBLISHABLE_KEY_LIVE", env("VITE_STRIPE_PUBLISHABLE_KEY", ""));

// Price ids live on the server only (STRIPE_PRO_PRICE_IDS / STRIPE_TEAM_PRICE_IDS):
// checkout sends the plan key "pro" | "team" and the API resolves it.

// ─── Feature flags ────────────────────────────────────────────────────────────
export const ENABLE_PAYMENTS   = env("VITE_ENABLE_PAYMENTS",     "true") === "true";

// ─── API errors ───────────────────────────────────────────────────────────────
// The scanner API (mdothree/ronnascanner-api, AUDIT §7a) answers JSON errors:
//   { error: "<code>", message: "<user-safe text>" }   (429 sends only { error: "<text>" })
// apiFetch throws an ApiError carrying the HTTP status, so callers can show the
// paywall on 402, "not open yet" on 501, and an honest message for the rest.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;   // 0 = network failure (no response)
    this.code = code || null;
  }
}

const STATUS_MESSAGES = {
  0:   "The scanner service is unavailable right now. No results were generated.",
  400: "That request was not accepted. Check the fields and try again.",
  401: "Sign in to use RonnaScanner.",
  402: "RonnaScanner is a paid tool. A Pro or Team plan is required. No results were generated.",
  403: "You can only act on your own account.",
  404: "Not found.",
  409: "This account already has an active plan. Use Manage plan to change it.",
  413: "That request is too large.",
  429: "Too many requests. Please wait a moment and try again.",
  501: "This tool isn't open yet. No results were generated.",
  502: "The data provider is unavailable right now. No results were generated.",
  503: "This service isn't connected yet. No results were generated."
};

/** Honest, user-facing text for any error thrown by apiFetch (or anything else). */
export function apiErrorMessage(err) {
  if (!(err instanceof ApiError)) return STATUS_MESSAGES[0];
  // 501 / 402 always use our own wording so every tool says the same thing.
  if (err.status === 501 || err.status === 402) return STATUS_MESSAGES[err.status];
  // The API's own message is written for users and never carries internals.
  if (err.status !== 0 && err.serverMessage) return err.serverMessage;
  return STATUS_MESSAGES[err.status] || "Something went wrong on our side. No results were generated.";
}

// ─── Fetch wrapper (same-origin /api/* + Firebase ID token) ───────────────────
// Every scanner and payment route requires `Authorization: Bearer <Firebase ID
// token>`; the API takes the uid from the verified token, never from the body.
// No user signed in -> ApiError 401 without a network call.
import { auth } from "./firebase.js";

export async function apiFetch(path, body, options = {}) {
  const url = API_URL ? `${API_URL}${path}` : path;
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "unauthorized", STATUS_MESSAGES[401]);
  let token;
  try {
    token = await user.getIdToken();
  } catch {
    throw new ApiError(401, "invalid_token", "Your session has expired. Sign in again.");
  }

  let res;
  try {
    res = await fetch(url, {
      method: options.method || "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, "network_error", STATUS_MESSAGES[0]);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Error shape: { error: code, message } — except 429, which sends { error: text }.
    const hasMessage = typeof data.message === "string" && data.message;
    const code = hasMessage ? data.error : (res.status === 429 ? "rate_limited" : data.error);
    const err = new ApiError(res.status, typeof code === "string" ? code : null,
      hasMessage ? data.message : (STATUS_MESSAGES[res.status] || `Request failed (${res.status})`));
    err.serverMessage = hasMessage ? data.message : (res.status === 429 && typeof data.error === "string" ? data.error : null);
    throw err;
  }
  // Returns the parsed JSON body. Callers must NOT call .json() again.
  return res.json();
}

// ─── Checkout gate ────────────────────────────────────────────────────────────
// Paid checkout stays closed until a real Stripe publishable key + price IDs are configured
// and this is deliberately switched on (VITE_PRO_CHECKOUT_ENABLED / window.__ENV__). Fails closed.
export const PRO_CHECKOUT_ENABLED = env("VITE_PRO_CHECKOUT_ENABLED", "false") === "true";
