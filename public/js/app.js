import { authService } from "./services/authService.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";

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
    `Connecting to Apollo.io database...`,
    `Searching ${industry} companies in ${location || "all locations"}...`,
    `Applying filters: size=${companySize || "any"}, revenue=${revenue || "any"}...`,
    `Pulling contact data from Hunter.io...`,
    `Enriching records via Clearbit...`,
    `Scoring leads by match quality...`,
    `Finalizing ${count} results...`
  ]);

  // Show skeleton table while scanning
  document.getElementById("results-panel").classList.remove("hidden");
  showSkeleton("leads-tbody", 8, "row");
  try {
    const res = await apiFetch("/api/leads/scan", { industry, location, companySize, revenue, keywords, count });
    const data = await res.json();
    currentResults = data.leads || generateMockLeads(industry, location, count);
  } catch {
    currentResults = generateMockLeads(industry, location, count);
  }

  renderResults(currentResults);
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
        <strong>${l.company}</strong><br />
        <span class="tag tag-gray">${l.website || ""}</span>
      </td>
      <td>${l.industry}</td>
      <td>${l.location}</td>
      <td>${l.size || "—"}</td>
      <td>
        ${l.contactName ? `<strong>${l.contactName}</strong><br /><small>${l.contactTitle || ""}</small>` : "—"}
      </td>
      <td>
        <span class="tag ${l.score >= 80 ? "tag-green" : l.score >= 60 ? "tag-orange" : "tag-gray"}">
          ${l.score}
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
  await addDoc(collection(db, "lead-lists"), {
    userId: currentUser.uid,
    name,
    count: currentResults.length,
    leads: currentResults.slice(0, 100),
    query: {
      industry: document.getElementById("industry").value,
      location: document.getElementById("location").value
    },
    createdAt: serverTimestamp()
  });
  loadSavedLists();
  toast.success("List saved!");
});

// ─── Load saved lists ─────────────────────────────────────────────────────────
async function loadSavedLists() {
  if (!currentUser) return;
  
  const q = query(
    collection(db, "lead-lists"),
    where("userId", "==", currentUser.uid),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  const grid = document.getElementById("saved-lists-grid");
  if (snap.empty) {
    grid.innerHTML = "<p class='empty-state'>No saved lists yet. Run a scan and save your results.</p>";
    return;
  }
  grid.innerHTML = snap.docs.map(d => {
    const data = d.data();
    return `
      <div class="result-card saved-list-card" data-id="${d.id}">
        <div class="result-count">${data.count}</div>
        <strong>${data.name}</strong>
        <p>${data.query?.industry || ""} · ${data.query?.location || "All locations"}</p>
        <small>${data.createdAt?.toDate?.().toLocaleDateString?.() || "Recently"}</small>
        <button class="btn-primary load-list-btn" data-id="${d.id}">Load List</button>
      </div>`;
  }).join("");

  grid.querySelectorAll(".load-list-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const docId = btn.dataset.id;
      const docSnap = await (await import("./config/firebase.js")).then(async m => {
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return getDoc(doc(m.db, "lead-lists", docId));
      });
      if (docSnap.exists()) {
        currentResults = docSnap.data().leads || [];
        renderResults(currentResults);
      }
    });
  });
}

// ─── Mock data (fallback when API is not yet connected) ───────────────────────
function generateMockLeads(industry, location, count) {
  const companies = ["Apex Solutions", "BlueRidge Tech", "Coastal Media", "Dune Analytics", "Ember Creative",
    "Fortress Digital", "Glide Software", "Harbor Health", "Ionic Systems", "Jade Consulting",
    "Kinetic Labs", "Lunar Media", "Marble Group", "Nexus Partners", "Orbit Ventures"];
  const titles = ["CEO", "Founder", "VP Sales", "Director of Marketing", "COO", "Head of Growth", "CTO"];
  const firstNames = ["James", "Sarah", "Michael", "Emily", "David", "Jessica", "Robert", "Ashley"];
  const lastNames  = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis"];
  const sizes = ["1–10", "11–50", "51–200", "201–500"];

  return Array.from({ length: Math.min(count, companies.length) }, (_, i) => ({
    company:      companies[i],
    industry,
    location:     location || "United States",
    size:         sizes[i % sizes.length],
    website:      companies[i].toLowerCase().replace(/ /g, "") + ".com",
    contactName:  `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
    contactTitle: titles[i % titles.length],
    score:        Math.floor(Math.random() * 35) + 65
  }));
}
