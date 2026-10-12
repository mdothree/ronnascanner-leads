/* boot.js — classic (non-module) script, CSP-safe (script-src 'self').
 * HEADERS-CSP (F3): service-worker registration moved here from an inline <script> the CSP blocked.
 * RONNA-SUB-SIGNIN-DEAD: header Sign In / Free Trial are real #signin / #signup links; this opens the
 * auth modal on click or when the page is loaded with that hash, even if the Firebase-dependent
 * app module has not loaded. app.js keeps its own handlers (sign-out when signed in). */
(function () {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
  function modal() { return document.getElementById("auth-modal"); }
  function showTab(tab) {
    var btns = document.querySelectorAll(".tab-btn");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].getAttribute("data-tab") === tab);
    var panes = document.querySelectorAll(".tab-content");
    for (var j = 0; j < panes.length; j++) panes[j].classList.toggle("hidden", panes[j].id !== "tab-" + tab);
  }
  function open(tab) {
    var m = modal();
    if (!m) return;
    showTab(tab);
    m.classList.remove("hidden");
    var first = m.querySelector("#tab-" + tab + " input");
    if (first) first.focus();
  }
  function close() { var m = modal(); if (m) m.classList.add("hidden"); }
  function fromHash() {
    if (location.hash === "#signin") open("login");
    else if (location.hash === "#signup") open("signup");
  }
  document.addEventListener("DOMContentLoaded", function () {
    var login = document.getElementById("nav-login");
    var signup = document.getElementById("nav-signup");
    if (login) login.addEventListener("click", function (e) {
      e.preventDefault();
      if (/sign out/i.test(login.textContent || "")) return; // app.js handles sign-out
      open("login");
    });
    if (signup) signup.addEventListener("click", function (e) { e.preventDefault(); open("signup"); });
    var x = document.getElementById("modal-close");
    if (x) x.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    fromHash();
  });
  window.addEventListener("hashchange", fromHash);
})();
