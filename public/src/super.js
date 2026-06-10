import { checkAuthState, logoutUser } from "./auth.js";
import { isOfflineMode, db } from "../firebase-config.js";
import { 
  collection, 
  doc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  collectionGroup 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Page state
let madrasas = [];
let allStudentsCount = 0;
let expiryModalObj;

document.addEventListener("DOMContentLoaded", () => {
  expiryModalObj = new bootstrap.Modal(document.getElementById('editExpiryModal'));

  // Enforce super_admin check
  checkAuthState("super_admin", async (user, profile) => {
    await loadPlatformData();
    renderSuperDashboard();
  });

  setupEventListeners();
});

async function loadPlatformData() {
  if (isOfflineMode) {
    const mockMadrasasMap = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
    
    // Seed default mock madrasas if empty
    if (Object.keys(mockMadrasasMap).length === 0) {
      const defaultMadrasas = {
        "madrasa_active_123": {
          name: "Al-Huda Quran Academy",
          location: "Kochi, Kerala",
          usthadName: "Usthad Omar",
          mobile: "9207846064",
          email: "usthad@madrasa.com",
          status: "active",
          createdAt: new Date().toISOString(),
          subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        },
        "madrasa_pending_123": {
          name: "Markaz Hifz Academy",
          location: "Calicut, Kerala",
          usthadName: "Usthad Faisal",
          mobile: "9876543210",
          email: "faisal@markaz.com",
          status: "pending",
          createdAt: new Date().toISOString(),
          subscriptionExpiry: null
        },
        "madrasa_suspended_123": {
          name: "Noor Quran Center",
          location: "Malappuram, Kerala",
          usthadName: "Usthad Rafeeque",
          mobile: "9944332211",
          email: "rafeeque@noor.com",
          status: "suspended",
          createdAt: new Date().toISOString(),
          subscriptionExpiry: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
        }
      };
      
      // Seed student lists as well
      localStorage.setItem("mock_madrasas", JSON.stringify(defaultMadrasas));
      madrasas = Object.entries(defaultMadrasas).map(([id, data]) => ({ id, ...data }));
    } else {
      madrasas = Object.entries(mockMadrasasMap).map(([id, data]) => ({ id, ...data }));
    }

    // Count students from all classes in localStorage
    allStudentsCount = 0;
    const keys = Object.keys(localStorage);
    keys.forEach(k => {
      if (k.startsWith("mock_students_")) {
        const studList = JSON.parse(localStorage.getItem(k)) || {};
        allStudentsCount += Object.keys(studList).length;
      }
    });
  } else {
    try {
      // Fetch madrasas
      const mSnapshot = await getDocs(collection(db, "madrasas"));
      madrasas = mSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Fetch global student counts
      const sSnapshot = await getDocs(collectionGroup(db, "students"));
      allStudentsCount = sSnapshot.size;
    } catch (e) {
      console.error(e);
      showAlert("Error loading live data from Firestore.", "danger");
    }
  }
}

function showAlert(message, type = "success") {
  const container = document.getElementById("alertContainer");
  const alertEl = document.createElement("div");
  alertEl.className = `alert alert-${type} alert-dismissible fade show shadow-md rounded-pill px-4 py-2 border-0`;
  alertEl.innerHTML = `
    <span class="small"><i class="bi bi-shield-check me-2"></i>${message}</span>
    <button type="button" class="btn-close py-2" data-bs-alert="close" aria-label="Close" onclick="this.parentElement.remove()"></button>
  `;
  container.appendChild(alertEl);
  setTimeout(() => alertEl.remove(), 4000);
}

function setupEventListeners() {
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await logoutUser();
  });

  document.getElementById("madrasaSearch").addEventListener("input", filterMadrasas);
  document.getElementById("statusFilter").addEventListener("change", filterMadrasas);
  
  // Custom Expiry Modal
  document.getElementById("editExpiryForm").addEventListener("submit", handleExpirySave);
}

// ==========================================
// RENDER VIEWS
// ==========================================
function renderSuperDashboard() {
  let activeCount = 0;
  let pendingCount = 0;
  let suspendedCount = 0;
  let expiredCount = 0;

  // Process and render stats
  madrasas.forEach(m => {
    // Check if subscription is expired
    if (m.status === "active" && m.subscriptionExpiry) {
      const exp = new Date(m.subscriptionExpiry);
      if (exp.getTime() < Date.now()) {
        m.status = "expired"; // Auto-flag client-side expired status
      }
    }

    if (m.status === "active") activeCount++;
    else if (m.status === "pending") pendingCount++;
    else if (m.status === "suspended") suspendedCount++;
    else if (m.status === "expired") expiredCount++;
  });

  document.getElementById("statTotalMadrasas").textContent = madrasas.length;
  document.getElementById("statActiveMadrasas").textContent = activeCount;
  document.getElementById("statPendingMadrasas").textContent = pendingCount;
  document.getElementById("statSuspendedMadrasas").textContent = suspendedCount;
  document.getElementById("statExpiredMadrasas").textContent = expiredCount;
  document.getElementById("statTotalStudents").textContent = allStudentsCount;

  renderMadrasaCards();
}

function renderMadrasaCards() {
  const container = document.getElementById("madrasaListContainer");
  container.innerHTML = "";

  const filtered = getFilteredMadrasas();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <i class="bi bi-x-circle fs-1 opacity-25 d-block mb-2"></i>
        <p class="small">No madrasas matching selection rules.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(m => {
    let statusBadge = "";
    if (m.status === "active") statusBadge = `<span class="badge bg-success">Active</span>`;
    else if (m.status === "pending") statusBadge = `<span class="badge bg-warning text-dark">Pending Approval</span>`;
    else if (m.status === "suspended") statusBadge = `<span class="badge bg-danger">Suspended</span>`;
    else if (m.status === "expired") statusBadge = `<span class="badge bg-secondary">Expired</span>`;

    const expText = m.subscriptionExpiry 
      ? new Date(m.subscriptionExpiry).toLocaleDateString()
      : "Not Configured";

    // Setup action buttons based on status
    let actionButtons = "";
    if (m.status === "pending") {
      actionButtons = `
        <button class="btn btn-sm btn-success me-1 rounded-pill px-3" onclick="updateStatus('${m.id}', 'active', 365)">
          <i class="bi bi-check-lg me-1"></i>Approve (1 Year)
        </button>
        <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="deleteMadrasa('${m.id}', '${m.name}')">
          Reject
        </button>
      `;
    } else if (m.status === "active") {
      actionButtons = `
        <button class="btn btn-sm btn-outline-warning me-1 rounded-pill" onclick="updateStatus('${m.id}', 'suspended')">
          Suspend
        </button>
        <button class="btn btn-sm btn-outline-success me-1 rounded-pill" onclick="openExpiryModal('${m.id}', '${m.subscriptionExpiry || ''}')">
          Set Expiry
        </button>
        <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="deleteMadrasa('${m.id}', '${m.name}')">
          Delete
        </button>
      `;
    } else if (m.status === "suspended") {
      actionButtons = `
        <button class="btn btn-sm btn-success me-1 rounded-pill" onclick="updateStatus('${m.id}', 'active')">
          Activate
        </button>
        <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="deleteMadrasa('${m.id}', '${m.name}')">
          Delete
        </button>
      `;
    } else if (m.status === "expired") {
      actionButtons = `
        <button class="btn btn-sm btn-success me-1 rounded-pill" onclick="renewSubscriptionAction('${m.id}')">
          <i class="bi bi-arrow-clockwise me-1"></i>Renew (1 Year)
        </button>
        <button class="btn btn-sm btn-outline-success me-1 rounded-pill" onclick="openExpiryModal('${m.id}', '${m.subscriptionExpiry || ''}')">
          Set Expiry
        </button>
        <button class="btn btn-sm btn-outline-danger rounded-pill" onclick="deleteMadrasa('${m.id}', '${m.name}')">
          Delete
        </button>
      `;
    }

    const card = document.createElement("div");
    card.className = "col-12 col-md-6";
    card.innerHTML = `
      <div class="glass-card mb-0">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <h5 class="fw-bold mb-0">${m.name}</h5>
            <span class="small text-muted"><i class="bi bi-geo-alt me-1"></i>${m.location}</span>
          </div>
          ${statusBadge}
        </div>

        <div class="small text-muted mt-2 border-top pt-2">
          <div>Usthad: <strong>${m.usthadName || '—'}</strong></div>
          <div>Email: <strong>${m.email}</strong></div>
          <div>Mobile: <strong>${m.mobile}</strong></div>
          <div class="mt-1">Expiry: <strong class="text-success">${expText}</strong></div>
        </div>

        <div class="d-flex justify-content-end gap-1 mt-3 border-top pt-2">
          ${actionButtons}
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function getFilteredMadrasas() {
  const query = document.getElementById("madrasaSearch").value.toLowerCase().trim();
  const filter = document.getElementById("statusFilter").value;

  return madrasas.filter(m => {
    const matchesQuery = m.name.toLowerCase().includes(query) || 
                         m.location.toLowerCase().includes(query) || 
                         (m.usthadName && m.usthadName.toLowerCase().includes(query));
    const matchesStatus = filter === "all" || m.status === filter;
    return matchesQuery && matchesStatus;
  });
}

function filterMadrasas() {
  renderMadrasaCards();
}

// ==========================================
// SUPER OPERATIONS
// ==========================================
window.updateStatus = async function(madrasaId, status, addDays = 0) {
  let expiryDate = null;
  if (addDays > 0) {
    expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + addDays);
  }

  try {
    if (isOfflineMode) {
      const mock = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
      if (mock[madrasaId]) {
        mock[madrasaId].status = status;
        if (expiryDate) mock[madrasaId].subscriptionExpiry = expiryDate.toISOString();
        localStorage.setItem("mock_madrasas", JSON.stringify(mock));
      }
    } else {
      const docRef = doc(db, "madrasas", madrasaId);
      const updateData = { status };
      if (expiryDate) updateData.subscriptionExpiry = expiryDate.toISOString();
      await updateDoc(docRef, updateData);
    }
    
    showAlert(`Madrasa status updated to ${status.toUpperCase()}.`);
    await loadPlatformData();
    renderSuperDashboard();
  } catch (e) {
    showAlert("Error saving updates.", "danger");
  }
};

window.renewSubscriptionAction = async function(madrasaId) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 365); // Add 1 year

  try {
    if (isOfflineMode) {
      const mock = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
      if (mock[madrasaId]) {
        mock[madrasaId].status = "active";
        mock[madrasaId].subscriptionExpiry = expiryDate.toISOString();
        localStorage.setItem("mock_madrasas", JSON.stringify(mock));
      }
    } else {
      const docRef = doc(db, "madrasas", madrasaId);
      await updateDoc(docRef, {
        status: "active",
        subscriptionExpiry: expiryDate.toISOString()
      });
    }

    showAlert("Subscription renewed for 1 year.");
    await loadPlatformData();
    renderSuperDashboard();
  } catch (e) {
    showAlert("Error renewing subscription.", "danger");
  }
};

window.deleteMadrasa = async function(madrasaId, name) {
  if (!confirm(`CAUTION: Are you sure you want to delete the Madrasa "${name}" and all associated records? This cannot be undone.`)) {
    return;
  }

  try {
    if (isOfflineMode) {
      const mock = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
      delete mock[madrasaId];
      localStorage.setItem("mock_madrasas", JSON.stringify(mock));
      
      // Also clean up mock students and classes
      localStorage.removeItem(`mock_students_${madrasaId}`);
      localStorage.removeItem(`mock_classes_${madrasaId}`);
      localStorage.removeItem(`mock_reports_${madrasaId}`);
    } else {
      // In live Firebase: Delete main madrasa doc. 
      // Note: Subcollections need to be deleted manually or using admin tools. 
      // To satisfy simple sandbox delete:
      await deleteDoc(doc(db, "madrasas", madrasaId));
      await deleteDoc(doc(db, "users", madrasaId));
    }

    showAlert(`Madrasa "${name}" deleted.`);
    await loadPlatformData();
    renderSuperDashboard();
  } catch (e) {
    showAlert("Error deleting record.", "danger");
  }
};

// Custom Expiry Modal helpers
window.openExpiryModal = function(madrasaId, currentExpiry) {
  document.getElementById("expiryMadrasaId").value = madrasaId;
  const dateInput = document.getElementById("expiryDateInput");
  
  if (currentExpiry) {
    const curDate = new Date(currentExpiry);
    dateInput.value = curDate.toISOString().split("T")[0];
  } else {
    // Default 1 year from today
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 365);
    dateInput.value = defaultDate.toISOString().split("T")[0];
  }

  expiryModalObj.show();
};

async function handleExpirySave(e) {
  e.preventDefault();
  const id = document.getElementById("expiryMadrasaId").value;
  const dateStr = document.getElementById("expiryDateInput").value;
  const expDate = new Date(dateStr);

  try {
    if (isOfflineMode) {
      const mock = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
      if (mock[id]) {
        mock[id].subscriptionExpiry = expDate.toISOString();
        localStorage.setItem("mock_madrasas", JSON.stringify(mock));
      }
    } else {
      const docRef = doc(db, "madrasas", id);
      await updateDoc(docRef, { subscriptionExpiry: expDate.toISOString() });
    }

    expiryModalObj.hide();
    showAlert("Subscription expiry date updated successfully.");
    await loadPlatformData();
    renderSuperDashboard();
  } catch (error) {
    showAlert("Error setting expiry date.", "danger");
  }
}
