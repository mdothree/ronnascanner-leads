/* config/flags.js: classic script, loaded first in <head> (CSP script-src 'self').
 * RONNA_LIVE is the single launch flag for this tool (Bridge decision MDO-S8, option c, 2026-10-13).
 *   false: the page shows "coming soon" + the waitlist. The scanner form, sign-in, the Pro/upgrade
 *          buttons and the paywall are hidden, and js/app.js (Firebase, paywall, Stripe checkout) is
 *          never loaded, so no path to checkout exists.
 *   true:  restores the scanner UI and loads js/app.js. Flip only after the API routes, the paid
 *          gate and the payment endpoints pass audit (staged/ronna_api/AUDIT.md).
 * Elements marked data-ronna-live / data-ronna-soon are shown or hidden by css/styles.css from the
 * html[data-ronna] attribute set here (no flash, works before any module loads). */
(function () {
  "use strict";
  var RONNA_LIVE = false;
  window.RONNA_LIVE = RONNA_LIVE;
  document.documentElement.setAttribute("data-ronna", RONNA_LIVE ? "live" : "soon");
  // Live-only UI also carries the HTML hidden attribute, so sign-in / upgrade controls stay out of
  // no-CSS views (crawlers, reader modes) while closed. Launch removes it once the DOM is parsed.
  if (RONNA_LIVE) {
    document.addEventListener("DOMContentLoaded", function () {
      var els = document.querySelectorAll("[data-ronna-live][hidden]");
      for (var i = 0; i < els.length; i++) els[i].removeAttribute("hidden");
    });
  }
})();
