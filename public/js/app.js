import { authService } from "./services/authService.js";
import { saveDoc, getUserDocs, getDoc_, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import { showSkeleton, escapeHtml } from "./utils/helpers.js";

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentResults = [];

// ─── Auth ─────────────────────────────────────────────────────────────────────
authService.onAuthChanged(async user => {
  currentUser = user;
  const navLoginEl = document.getElementById("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  await initPaywall(user ? user.uid : null);
  if (user) {
    renderUsageMeter("usage-meter-container", "scans");
    loadSavedLists();
    document.getElementById("saved-lists-section").classList.remove("hidden");
  }
});

document.getElementById("nav-upgrade")?.addEventListener("click", () => showPricingModal("pro"));
document.getElementById("nav-manage")?.addEventListener("click", () => showPricingModal("pro"));

// Auth modal
const authModal = document.getElementById("auth-modal");
document.getElementById("nav-login").addEventListener("click", e => {
  e.preventDefault();
  currentUser ? authService.signOut() : authModal.classList.remove("hidden");
});
document.getElementById("nav-signup").addEventListener("click", e => { e.preventDefault(); authModal.classList.remove("hidden"); });
document.getElementById("modal-close").addEventListener("click", () => authModal.classList.add("hidden"));
authModal.addEventListener("click", e => { if (e.target === authModal) authModal.classList.add("hidden"); });

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    document.getElementById("auth-error").classList.add("hidden");
  });
});

document.getElementById("btn-login").addEventListener("click", async () => {
  try {
    await authService.signIn(document.getElementById("login-email").value, document.getElementById("login-password").value);
    authModal.classList.add("hidden");
  } catch (e) {
    document.getElementById("auth-error").textContent = e.message;
    document.getElementById("auth-error").classList.remove("hidden");
  }
});

document.getElementById("btn-signup").addEventListener("click", async () => {
  try {
    await authService.signUp(
      document.getElementById("signup-email").value,
      document.getElementById("signup-password").value,
      document.getElementById("signup-name").value
    );
    authModal.classList.add("hidden");
  } catch (e) {
    document.getElementById("auth-error").textContent = e.message;
    document.getElementById("auth-error").classList.remove("hidden");
  }
});

// ─── Scan ─────────────────────────────────────────────────────────────────────
document.getElementById("btn-scan").addEventListener("click", () => {
  const industry = document.getElementById("industry").value.trim();
  if (!industry) return toast.warning("Please enter an industry to scan.");

  gate("scans",
    () => runScan(),
    () => { /* blocked — gate shows upgrade prompt */ }
  );
});

async function runScan() {
  const industry    = document.getElementById("industry").value.trim();
  const location    = document.getElementById("location").value.trim();
  const companySize = document.getElementById("company-size").value;
  const revenue     = document.getElementById("revenue-range").value;
  const keywords    = document.getElementById("keywords").value.trim();
  const count       = parseInt(document.getElementById("lead-count").value);

  // Show progress
  document.querySelector(".btn-text").classList.add("hidden");
  document.querySelector(".btn-loader").classList.remove("hidden");
  document.getElementById("btn-scan").disabled = true;
  document.getElementById("scan-progress").classList.remove("hidden");
  document.getElementById("results-section").classList.add("hidden");

  await animateScan([
    `Searching...`,
    `Searching ${industry} companies in ${location || "all locations"}...`,
    `Applying filters: size=${companySize || "any"}, revenue=${revenue || "any"}...`,
    `Scoring leads by match quality...`,
    `Finalizing ${count} results...`
  ]);

  // Show skeleton table while scanning
  document.getElementById("results-section").classList.remove("hidden");
  showSkeleton("results-tbody", 8, "row");
  try {
    const data = await apiFetch("/api/leads/scan", { industry, location, companySize, revenue, keywords, count });
    currentResults = data?.leads || null;
  } catch {
    currentResults = null;
  }

  if (currentResults) renderResults(currentResults); else showUnavailable();
  renderUsageMeter("usage-meter-container", "scans");
  document.getElementById("scan-progress").classList.add("hidden");
  document.querySelector(".btn-text").classList.remove("hidden");
  document.querySelector(".btn-loader").classList.add("hidden");
  document.getElementById("btn-scan").disabled = false;
}

// ─── Animated scan log ────────────────────────────────────────────────────────
function animateScan(steps) {
  return new Promise(resolve => {
    const log = document.getElementById("scan-log");
    const fill = document.getElementById("scan-fill");
    const pct  = document.getElementById("scan-pct");
    let i = 0;
    const interval = setInterval(() => {
      if (i >= steps.length) { clearInterval(interval); resolve(); return; }
      const p = Math.round(((i + 1) / steps.length) * 100);
      fill.style.width = p + "%";
      pct.textContent  = p + "%";
      const line = document.createElement("div");
      line.className = "scan-log-line";
      line.textContent = `→ ${steps[i]}`;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
      i++;
    }, 420);
  });
}

// ─── Render results ───────────────────────────────────────────────────────────
function renderResults(leads) {
  document.getElementById("result-count").textContent = leads.length;
  const tbody = document.getElementById("results-tbody");
  tbody.innerHTML = leads.map((l, i) => `
    <tr>
      <td><input type="checkbox" class="row-check" data-i="${i}" /></td>
      <td>
        <strong>${escapeHtml(l.company)}</strong><br />
        <span class="tag tag-gray">${escapeHtml(l.website)}</span>
      </td>
      <td>${escapeHtml(l.industry)}</td>
      <td>${escapeHtml(l.location)}</td>
      <td>${escapeHtml(l.size || "—")}</td>
      <td>
        ${l.contactName ? `<strong>${escapeHtml(l.contactName)}</strong><br /><small>${escapeHtml(l.contactTitle)}</small>` : "—"}
      </td>
      <td>
        <span class="tag ${l.score >= 80 ? "tag-green" : l.score >= 60 ? "tag-orange" : "tag-gray"}">
          ${escapeHtml(l.score)}
        </span>
      </td>
      <td>
        <button class="btn-icon view-btn" data-i="${i}">View</button>
      </td>
    </tr>
  `).join("");

  document.getElementById("results-section").classList.remove("hidden");
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });

  document.getElementById("select-all").addEventListener("change", function () {
    document.querySelectorAll(".row-check").forEach(c => c.checked = this.checked);
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────
document.getElementById("btn-export-csv").addEventListener("click", () => {
  if (!currentResults.length) return;
  const headers = ["Company", "Industry", "Location", "Size", "Contact", "Title", "Score", "Website"];
  const rows = currentResults.map(l =>
    [l.company, l.industry, l.location, l.size, l.contactName, l.contactTitle, l.score, l.website]
      .map(v => `"${(v || "").toString().replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(csv, "leads.csv", "text/csv");
});

document.getElementById("btn-export-json").addEventListener("click", () => {
  if (!currentResults.length) return;
  downloadFile(JSON.stringify(currentResults, null, 2), "leads.json", "application/json");
});

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Save list ────────────────────────────────────────────────────────────────
document.getElementById("btn-save-list").addEventListener("click", async () => {
  if (!currentUser) { authModal.classList.remove("hidden"); return; }
  if (!currentResults.length) return;
  
  const name = prompt("Name this list:", `${document.getElementById("industry").value} Leads`) || "My List";
  // RONNA-LOADLIST-AWAIT-BUG: addDoc/collection/db/serverTimestamp were never imported here
  // (ReferenceError on Save List). saveDoc adds userId + createdAt/updatedAt itself.
  await saveDoc("lead-lists", currentUser.uid, {
    name,
    count: currentResults.length,
    leads: currentResults.slice(0, 100),
    query: {
      industry: document.getElementById("industry").value,
      location: document.getElementById("location").value
    }
  });
  loadSavedLists();
  toast.success("List saved!");
});

// ─── Load saved lists ─────────────────────────────────────────────────────────
async function loadSavedLists() {
  if (!currentUser) return;
  
  // RONNA-LOADLIST-AWAIT-BUG: query/collection/where/orderBy/getDocs/db were never imported here.
  let lists = [];
  try {
    lists = await getUserDocs("lead-lists", currentUser.uid);
  } catch (e) {
    console.warn("[leads] could not load saved lists", e);
  }
  const grid = document.getElementById("saved-lists-grid");
  if (!lists.length) {
    grid.innerHTML = "<p class='empty-state'>No saved lists yet. Run a scan and save your results.</p>";
    return;
  }
  grid.innerHTML = lists.map(data => {
    const d = data;
    return `
      <div class="result-card saved-list-card" data-id="${escapeHtml(d.id)}">
        <div class="result-count">${escapeHtml(data.count)}</div>
        <strong>${escapeHtml(data.name)}</strong>
        <p>${escapeHtml(data.query?.industry)} · ${escapeHtml(data.query?.location || "All locations")}</p>
        <small>${escapeHtml(data.createdAt?.toDate?.().toLocaleDateString?.() || "Recently")}</small>
        <button class="btn-primary load-list-btn" data-id="${escapeHtml(d.id)}">Load List</button>
      </div>`;
  }).join("");

  grid.querySelectorAll(".load-list-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.id;
      // RONNA-LOADLIST-AWAIT-BUG: was an awaited dynamic import chained with .then() → TypeError
      // (a module namespace has no .then). Use the shared Firestore service instead.
      try {
        const list = await getDoc_("lead-lists", docId);
        if (list) {
          currentResults = list.leads || [];
          renderResults(currentResults);
        } else {
          toast.error("That list could not be found.");
        }
      } catch (e) {
        toast.error("Could not load that list. Please try again.");
      }
    });
  });
}

// RONNA-MOCK-FALLBACK: never fabricate results when the scanner API is unavailable.
function showUnavailable() {
  // Keep the results table in the DOM so a later successful scan can render into it.
  currentResults = [];
  document.getElementById("results-section")?.classList.remove("hidden");
  const count = document.getElementById("result-count");
  if (count) count.textContent = "0";
  const tbody = document.getElementById("results-tbody");
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state" role="status"><p><strong>The scanner service is unavailable right now.</strong></p><p>No results were generated. Please try again later.</p></div></td></tr>';
  }
  toast.error("Scanner service unavailable. No results were generated.");
}
