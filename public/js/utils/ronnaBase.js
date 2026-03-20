/**
 * utils/ronnaBase.js
 * Shared auth + paywall initialization for all ronnascanner tools.
 * Import and call initRonna(config) from each project's app.js.
 */

import { authService } from "../services/authService.js";
import { initPaywall, showPricingModal, renderUsageMeter } from "../services/paywallUI.js";
import { initAuthModal } from "./helpers.js";

export async function initRonna({ usageAction = "scans" } = {}) {
  // Wire up auth modal
  initAuthModal(authService);

  // Nav login toggle
  const navLogin = document.getElementById("nav-login");
  const navSignup = document.getElementById("nav-signup");
  const navUpgrade = document.getElementById("nav-upgrade");
  const navManage = document.getElementById("nav-manage");

  navLogin?.addEventListener("click", e => {
    e.preventDefault();
    if (authService.currentUser()) {
      authService.signOut();
    } else {
      document.getElementById("auth-modal")?.classList.remove("hidden");
    }
  });
  navSignup?.addEventListener("click", e => {
    e.preventDefault();
    document.getElementById("auth-modal")?.classList.remove("hidden");
  });
  navUpgrade?.addEventListener("click", () => showPricingModal("pro"));
  navManage?.addEventListener("click", () => showPricingModal("pro"));

  // Auth state listener
  return new Promise(resolve => {
    authService.onAuthChanged(async user => {
      if (navLogin) navLogin.textContent = user ? "Sign Out" : "Sign In";
      navSignup?.classList.toggle("nav-signup-hidden", !!user);

      await initPaywall(user ? user.uid : null);

      if (user) {
        renderUsageMeter("usage-meter-container", usageAction);
      }

      resolve(user);
    });
  });
}
