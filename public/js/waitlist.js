/* waitlist.js: classic script, CSP-safe. Coming-soon waitlist (RONNA-S8).
 * Method: mailto: to hello@mdo3d.com, the MDO3 inbox already published on these pages and on mdo3d.com.
 * Same pattern as the LayoffLeads waitlist fallback (projects/mdo3d/layoffleads/src/assets/site.js).
 * No backend, no keys, no third-party requests: the visitor's own email app sends the message, and
 * nothing is sent until they press send. The form's data-source names the tool (source=<tool>). */
(function () {
  "use strict";
  var INBOX = "hello@mdo3d.com";
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function open(url) {
    // QA seam: browser tests stub this to capture the URL instead of launching a mail client.
    if (typeof window.__ronnaWaitlistOpen === "function") { window.__ronnaWaitlistOpen(url); return; }
    window.location.href = url;
  }

  function plain(s) {
    var d = document.createElement("textarea");
    d.innerHTML = s || "";
    return d.value;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("waitlist-form");
    if (!form) return;
    var input = document.getElementById("waitlist-email");
    var msg = document.getElementById("waitlist-msg");
    var source = form.getAttribute("data-source") || "ronna";
    var tool = plain(form.getAttribute("data-tool-name")) || "RonnaScanner";

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = (input.value || "").trim();
      if (!EMAIL_RE.test(email)) {
        input.setAttribute("aria-invalid", "true");
        msg.classList.add("is-error");
        msg.textContent = "Please enter a valid email address.";
        input.focus();
        return;
      }
      input.removeAttribute("aria-invalid");
      msg.classList.remove("is-error");
      var subject = "RonnaScanner waitlist: " + tool;
      var body = "Please add " + email + " to the RonnaScanner waitlist for the " + tool + ".\n\n" +
        "source=" + source + "\n" +
        "page=" + window.location.origin + window.location.pathname;
      open("mailto:" + INBOX + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body));
      msg.textContent = "Your email app should open with a short message to " + INBOX + ". Send it to join the waitlist.";
    });
  });
})();
