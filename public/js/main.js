// main.js: entry module. The scanner app (Firebase sign-in, paywall, checkout) loads only when
// RONNA_LIVE is true (js/config/flags.js). While it is false nothing here touches Firebase or Stripe.
if (window.RONNA_LIVE === true) {
  import("./app.js");
}
