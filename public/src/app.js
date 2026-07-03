import { checkAuthState, logoutUser } from "./auth.js";
import { isOfflineMode, auth } from "../firebase-config.js";
import { showConfirm, showDeleteConfirm, showToast, showLoading, hideLoading } from "./ui-notifications.js";
import { 
  getClasses, 
  addClass, 
  deleteClass, 
  getStudents, 
  addStudent, 
  updateStudent, 
  deleteStudent, 
  uploadStudentPhoto, 
  saveDailyReport, 
  getStudentReports, 
  getTodayReports,
  verifyMadrasaExists
} from "./db.js";

// Helper to resolve the active Madrasa ID for online/offline modes
const getMadrasaId = () => {
  if (isOfflineMode) {
    return currentUser?.madrasaId || "madrasa_active_123";
  } else {
    return auth.currentUser?.uid || currentUser?.madrasaId;
  }
};

// State Management
let currentUser = null;
let currentMadrasa = null;
let classes = [];
let students = [];
let todayReports = {};
let currentTab = "dashboard";

// Get today's local date string (YYYY-MM-DD)
const getTodayDateString = () => {
  const d = new Date();
  return d.toISOString().split('T')[0];
};

// Bootstrap modal references
let addClassModalObj, addStudentModalObj, prevLessonModalObj, newLessonModalObj, dawrahModalObj, extraTrackersModalObj;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // Setup modal instances
  addClassModalObj = new bootstrap.Modal(document.getElementById('addClassModal'));
  addStudentModalObj = new bootstrap.Modal(document.getElementById('addStudentModal'));
  prevLessonModalObj = new bootstrap.Modal(document.getElementById('prevLessonModal'));
  newLessonModalObj = new bootstrap.Modal(document.getElementById('newLessonModal'));
  dawrahModalObj = new bootstrap.Modal(document.getElementById('dawrahModal'));
  extraTrackersModalObj = new bootstrap.Modal(document.getElementById('extraTrackersModal'));

  // Run Auth Check
  checkAuthState("madrasa_admin", async (user, madrasa) => {
    currentUser = user;
    currentMadrasa = madrasa;
    
    // Set Madrasa details in UI
    document.getElementById("headerMadrasaName").textContent = madrasa.name;
    document.getElementById("dashboardUsthadName").textContent = "Usthad " + (madrasa.usthadName || "");
    
    // Expiry check
    if (madrasa.subscriptionExpiry) {
      const expiryDate = new Date(madrasa.subscriptionExpiry);
      document.getElementById("expiryAlertDate").textContent = expiryDate.toLocaleDateString();
      
      const diffTime = expiryDate.getTime() - Date.now();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 30 && diffDays > 0) {
        document.getElementById("subscriptionExpiryAlert").classList.remove("d-none");
      }
    }

    // Set today's date in UI
    const today = new Date();
    document.getElementById("todayDateStr").textContent = today.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Initial load
    await loadDatabaseData();
    switchTab("dashboard");
  });

  // Attach event listeners
  setupEventListeners();
});

function triggerUIRender(tabId) {
  if (tabId === "dashboard") {
    renderDashboardView();
  } else if (tabId === "classes") {
    renderClassesView();
  } else if (tabId === "students") {
    renderStudentsView();
  } else if (tabId === "daily") {
    renderDailyView();
  } else if (tabId === "reports") {
    renderReportsConfig();
  }
}

let lastSyncTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds Cache TTL

async function loadDatabaseData(force = false) {
  if (!currentUser) return;
  const madrasaId = getMadrasaId();
  if (!madrasaId) return;

  // Try to load from Local Storage cache first to show UI instantly
  const cacheKeyClasses = `cache_classes_${madrasaId}`;
  const cacheKeyStudents = `cache_students_${madrasaId}`;
  const cacheKeyReports = `cache_today_reports_${madrasaId}`;

  const cachedClasses = localStorage.getItem(cacheKeyClasses);
  const cachedStudents = localStorage.getItem(cacheKeyStudents);
  const cachedReports = localStorage.getItem(cacheKeyReports);

  if (cachedClasses && cachedStudents) {
    classes = JSON.parse(cachedClasses);
    students = JSON.parse(cachedStudents);
    if (cachedReports) {
      todayReports = JSON.parse(cachedReports);
    }
    // Update active view instantly
    triggerUIRender(currentTab);
  }

  // Skip background sync if the cache is still fresh, unless 'force' is requested
  const now = Date.now();
  if (!force && (now - lastSyncTime < CACHE_TTL_MS)) {
    console.log("Using fresh cached data for background sync bypass");
    return;
  }

  // Fetch fresh data from Firestore in the background to update cache
  try {
    const freshClasses = await getClasses(madrasaId);
    const freshStudents = await getStudents(madrasaId);
    const freshReports = await getTodayReports(madrasaId, getTodayDateString());

    const classesChanged = JSON.stringify(freshClasses) !== JSON.stringify(classes);
    const studentsChanged = JSON.stringify(freshStudents) !== JSON.stringify(students);
    const reportsChanged = JSON.stringify(freshReports) !== JSON.stringify(todayReports);

    classes = freshClasses;
    students = freshStudents;
    todayReports = freshReports;

    localStorage.setItem(cacheKeyClasses, JSON.stringify(freshClasses));
    localStorage.setItem(cacheKeyStudents, JSON.stringify(freshStudents));
    localStorage.setItem(cacheKeyReports, JSON.stringify(freshReports));

    lastSyncTime = Date.now(); // update successful sync timestamp

    if (classesChanged || studentsChanged || reportsChanged) {
      triggerUIRender(currentTab);
    }
  } catch (error) {
    console.error("Error background sync:", error);
    // Only alert if we don't have any cached data to display
    if (classes.length === 0) {
      showAlert("Failed to load records from database.", "danger");
    }
  }
}

// ==========================================
// ALERT UTILITY
// ==========================================
function showAlert(message, type = "success") {
  showToast(message, type);
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  // Handle logouts
  document.getElementById("logoutBtn").addEventListener("click", () => {
    showConfirm({
      title: "Sign Out",
      message: "Are you sure you want to sign out?",
      type: "warning",
      confirmText: "Sign Out",
      onConfirm: async () => {
        await logoutUser();
      }
    });
  });

  // Inline Switch tab listening
  window.addEventListener('tabchange', (e) => {
    switchTab(e.detail);
  });

  // Parent Portal URL builder
  const getPortalUrl = (madrasaId) => {
    const origin = window.location.origin;
    const path = window.location.pathname;
    
    let basePath = "/";
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
      basePath = path.substring(0, lastSlashIndex + 1);
    }
    
    // Explicit filename and strictly use madrasaId
    const filename = "parent-portal.html";
    return `${origin}${basePath}${filename}?madrasaId=${madrasaId}`;
  };

  // Parent Portal Quick Actions
  document.getElementById("openParentPortalBtn").addEventListener("click", async () => {
    const madrasaId = getMadrasaId();
    if (!madrasaId) {
      showAlert("No active Madrasa ID found.", "danger");
      return;
    }
    
    showLoading();
    try {
      const exists = await verifyMadrasaExists(madrasaId);
      hideLoading();
      if (exists) {
        const portalUrl = getPortalUrl(madrasaId);
        window.open(portalUrl, "_blank");
      } else {
        showAlert("Madrasa profile does not exist in the database.", "danger");
      }
    } catch (err) {
      hideLoading();
      console.error("Verification failed:", err);
      showAlert("Verification failed. Please check your network connection.", "danger");
    }
  });

  document.getElementById("copyParentPortalBtn").addEventListener("click", () => {
    const madrasaId = getMadrasaId();
    if (!madrasaId) {
      showAlert("No active Madrasa ID found.", "danger");
      return;
    }
    const portalUrl = getPortalUrl(madrasaId);
    navigator.clipboard.writeText(portalUrl)
      .then(() => showAlert("Parent Portal link copied to clipboard!"))
      .catch(err => {
        console.error("Could not copy text: ", err);
        showAlert("Failed to copy link.", "danger");
      });
  });

  document.getElementById("shareParentPortalBtn").addEventListener("click", () => {
    const madrasaId = getMadrasaId();
    if (!madrasaId) {
      showAlert("No active Madrasa ID found.", "danger");
      return;
    }
    const portalUrl = getPortalUrl(madrasaId);
    if (navigator.share) {
      navigator.share({
        title: `${currentMadrasa?.name || "Hifz Progress Portal"} - Parent Portal`,
        text: `Track your child's Quran memorization progress online:`,
        url: portalUrl
      }).catch(err => {
        console.log("Error sharing:", err);
        // Fallback on user cancel or share failure
        navigator.clipboard.writeText(portalUrl);
        showAlert("Link copied to clipboard.");
      });
    } else {
      navigator.clipboard.writeText(portalUrl);
      showAlert("Sharing not supported on this device. Link copied to clipboard!");
    }
  });

  // Modal forms
  document.getElementById("addClassForm").addEventListener("submit", handleAddClass);
  document.getElementById("studentForm").addEventListener("submit", handleStudentSave);
  document.getElementById("prevLessonForm").addEventListener("submit", handlePrevLessonSave);
  document.getElementById("newLessonForm").addEventListener("submit", handleNewLessonSave);
  document.getElementById("dawrahForm").addEventListener("submit", handleDawrahSave);
  document.getElementById("extraTrackersForm").addEventListener("submit", handleExtraTrackersSave);

  // Search & Filter listeners
  document.getElementById("studentSearchInput").addEventListener("input", filterStudents);
  document.getElementById("studentClassFilter").addEventListener("change", filterStudents);
  document.getElementById("dailyClassFilter").addEventListener("change", filterDailyEntry);

  // Report filters
  document.getElementById("generateReportBtn").addEventListener("click", renderPerformanceReport);
  document.getElementById("printReportBtn").addEventListener("click", () => window.print());

  // Student Photo Upload Trigger
  const photoInput = document.getElementById("studentPhotoInput");
  const photoPreview = document.getElementById("studentPhotoPreview");
  photoInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        photoPreview.src = event.target.result;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });
}

// ==========================================
// SPA TAB NAVIGATION
// ==========================================
async function switchTab(tabId) {
  currentTab = tabId;
  
  // Update nav UI highlight
  document.querySelectorAll(".bottom-nav-item").forEach(item => {
    item.classList.remove("active");
  });
  const navItem = document.getElementById(`nav-${tabId}`);
  if (navItem) navItem.classList.add("active");

  // Switch visible views
  document.querySelectorAll(".dashboard-view").forEach(view => {
    view.classList.add("d-none");
    view.classList.remove("d-block");
  });
  const viewEl = document.getElementById(`view-${tabId}`);
  if (viewEl) {
    viewEl.classList.remove("d-none");
    viewEl.classList.add("d-block");
  }

  // Reload data context on tab switches to verify live syncing
  if (!currentUser) return;
  
  await loadDatabaseData();

  // Load specific tab UI renders
  if (tabId === "dashboard") {
    renderDashboardView();
  } else if (tabId === "classes") {
    renderClassesView();
  } else if (tabId === "students") {
    renderStudentsView();
  } else if (tabId === "daily") {
    renderDailyView();
  } else if (tabId === "reports") {
    renderReportsConfig();
  }
}

// ==========================================
// VIEW RENDERING: 1. DASHBOARD
// ==========================================
function renderDashboardView() {
  const total = students.length;
  let present = 0;
  let absent = 0;
  let completed = 0;

  students.forEach(student => {
    const report = todayReports[student.id];
    if (report) {
      if (report.attendance === "present") present++;
      else if (report.attendance === "absent") absent++;
      else if (report.attendance === "leave") present++; // Present/On leave count

      // A report entry is considered completed if it has either attendance marked as absent,
      // or lessons filled out (meaning the Usthad graded them for the day).
      if (report.attendance === "absent" || report.attendance === "leave" || report.newLesson || report.previousLesson || report.dawrah) {
        completed++;
      }
    }
  });

  const pending = total - completed;

  document.getElementById("statTotalStudents").textContent = total;
  document.getElementById("statPresentToday").textContent = present;
  document.getElementById("statAbsentToday").textContent = absent;
  document.getElementById("statPendingEntries").textContent = pending >= 0 ? pending : 0;
}

// ==========================================
// VIEW RENDERING: 2. CLASSES
// ==========================================
function renderClassesView() {
  const container = document.getElementById("classesListContainer");
  container.innerHTML = "";

  if (classes.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <i class="bi bi-folder-plus fs-1 opacity-25 d-block mb-2"></i>
        <p class="small">No classes registered. Click **New Class** to create one.</p>
      </div>
    `;
    return;
  }

  // Populate students count, attendance percentage and completion percentage for each class
  classes.forEach(cls => {
    const classStudents = students.filter(s => s.classId === cls.id);
    const totalCount = classStudents.length;

    // Daily metrics
    let presentCount = 0;
    let loggedCount = 0;
    classStudents.forEach(s => {
      const rep = todayReports[s.id];
      if (rep) {
        if (rep.attendance === "present") presentCount++;
        if (rep.attendance === "absent" || rep.attendance === "leave" || rep.newLesson || rep.previousLesson) loggedCount++;
      }
    });

    const attPct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
    const compPct = totalCount > 0 ? Math.round((loggedCount / totalCount) * 100) : 0;

    const col = document.createElement("div");
    col.className = "col-12 col-md-6";
    col.innerHTML = `
      <div class="glass-card mb-0 position-relative">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div>
            <h5 class="fw-bold mb-1">${cls.name}</h5>
            <span class="badge bg-success-subtle text-success small rounded-pill">${totalCount} Students</span>
          </div>
          <button class="btn btn-sm btn-outline-danger border-0 p-1" onclick="handleClassDelete('${cls.id}', '${cls.name}')">
            <i class="bi bi-trash"></i>
          </button>
        </div>
        
        <div class="row g-2 pt-2 border-top border-light-subtle">
          <div class="col-6">
            <span class="small text-muted d-block">Today's Attendance</span>
            <span class="fw-bold text-success">${attPct}%</span>
          </div>
          <div class="col-6 text-end">
            <span class="small text-muted d-block">Daily Progress Done</span>
            <span class="fw-bold text-gradient">${compPct}%</span>
          </div>
        </div>
      </div>
    `;
    container.appendChild(col);
  });
}

async function handleAddClass(e) {
  e.preventDefault();
  const nameInput = document.getElementById("newClassName");
  const name = nameInput.value.trim();
  if (!name) return;

  const madrasaId = getMadrasaId();
  const tempId = "class_temp_" + Date.now();
  const newClassObj = { id: tempId, name, createdAt: new Date().toISOString() };
  
  // Save original state for potential rollback
  const originalClasses = [...classes];
  
  // Optimistic Update
  classes.push(newClassObj);
  localStorage.setItem(`cache_classes_${madrasaId}`, JSON.stringify(classes));
  renderClassesView();
  
  nameInput.value = "";
  addClassModalObj.hide();
  showAlert(`Class "${name}" created successfully.`);

  try {
    const saved = await addClass(madrasaId, name);
    // Replace temp ID with actual ID from Firestore
    classes = classes.map(c => c.id === tempId ? { ...c, id: saved.id } : c);
    localStorage.setItem(`cache_classes_${madrasaId}`, JSON.stringify(classes));
  } catch (error) {
    console.error("Error creating class:", error);
    // Rollback on failure
    classes = originalClasses;
    localStorage.setItem(`cache_classes_${madrasaId}`, JSON.stringify(classes));
    renderClassesView();
    showAlert("Error creating class on server. Rolled back.", "danger");
  }
}

window.handleClassDelete = function(classId, name) {
  showDeleteConfirm(
    `Are you sure you want to delete the class "${name}"? All associated student mappings will remain but the class context will be removed.`,
    `Delete Class`,
    async () => {
      try {
        await deleteClass(getMadrasaId(), classId);
        showAlert(`Class "${name}" deleted.`);
        await loadDatabaseData(true);
        renderClassesView();
      } catch (error) {
        showAlert("Error deleting class.", "danger");
      }
    }
  );
};

// ==========================================
// VIEW RENDERING: 3. STUDENTS
// ==========================================
window.toggleStudentDetails = function(studentId) {
  const detailsDiv = document.getElementById(`details-${studentId}`);
  const chevron = document.getElementById(`chevron-${studentId}`);
  if (detailsDiv) {
    if (detailsDiv.classList.contains("d-none")) {
      detailsDiv.classList.remove("d-none");
      chevron.classList.replace("bi-chevron-down", "bi-chevron-up");
    } else {
      detailsDiv.classList.add("d-none");
      chevron.classList.replace("bi-chevron-up", "bi-chevron-down");
    }
  }
};

function renderStudentsView() {
  // Populate dropdown lists
  populateClassDropdowns();

  const container = document.getElementById("studentsListContainer");
  container.innerHTML = "";

  const filtered = getFilteredStudents();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <i class="bi bi-people fs-1 opacity-25 d-block mb-2"></i>
        <p class="small">No students found matching current filters.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(student => {
    const className = classes.find(c => c.id === student.classId)?.name || "Unassigned";
    const avatar = student.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}&backgroundColor=10b981`;

    const col = document.createElement("div");
    col.className = "col-12";
    col.innerHTML = `
      <div class="glass-card mb-2 p-3" style="cursor: pointer;" onclick="toggleStudentDetails('${student.id}')">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h6 class="fw-bold mb-0 text-dark">${student.name}</h6>
            <span class="text-muted small" style="font-size: 11px;">Admission No: <strong>${student.admissionNumber}</strong></span>
          </div>
          <div>
            <i class="bi bi-chevron-down text-muted" id="chevron-${student.id}"></i>
          </div>
        </div>

        <!-- Collapsible Details Container -->
        <div id="details-${student.id}" class="d-none mt-3 pt-3 border-top border-light-subtle" onclick="event.stopPropagation()">
          <div class="d-flex align-items-center gap-3">
            <img src="${avatar}" class="student-avatar" style="width: 50px; height: 50px;" alt="${student.name}" onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}'">
            <div class="flex-grow-1 min-w-0">
              <div class="student-card-meta">
                Class: <strong class="text-success">${className}</strong>
              </div>
              <div class="student-card-meta mt-1" style="font-size: 12px;">
                <i class="bi bi-telephone text-muted me-1"></i>${student.parentPhone} (${student.parentName})
              </div>
            </div>
            <div class="d-flex flex-column gap-1">
              <button class="btn btn-sm btn-outline-success border-0 py-1" onclick="openEditStudentModal('${student.id}'); event.stopPropagation();">
                <i class="bi bi-pencil-square me-1"></i>Edit
              </button>
              <button class="btn btn-sm btn-outline-danger border-0 py-1" onclick="handleStudentDelete('${student.id}', '${student.name}'); event.stopPropagation();">
                <i class="bi bi-trash me-1"></i>Delete
              </button>
            </div>
          </div>

          <!-- Position Tracker Ribbon -->
          <div class="position-tracker mt-3">
            <div class="position-tracker-item">
              <span class="text-success">${student.currentJuz || 1}</span>
              Juz
            </div>
            <div class="position-tracker-item">
              <span class="text-success">${student.currentSurah || 'Al-Baqarah'}</span>
              Surah
            </div>
            <div class="position-tracker-item">
              <span class="text-success">${student.currentPage || 1}</span>
              Page
            </div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(col);
  });
}

function getFilteredStudents() {
  const searchQuery = document.getElementById("studentSearchInput").value.toLowerCase().trim();
  const classFilter = document.getElementById("studentClassFilter").value;

  return students.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(searchQuery) || student.admissionNumber.includes(searchQuery);
    const matchesClass = classFilter === "all" || student.classId === classFilter;
    return matchesSearch && matchesClass;
  });
}

function filterStudents() {
  renderStudentsView();
}

function populateClassDropdowns() {
  const filter1 = document.getElementById("studentClassFilter");
  const filter2 = document.getElementById("dailyClassFilter");
  const filter3 = document.getElementById("reportClassFilter");
  const studentFormSelect = document.getElementById("studentClassSelect");

  const activeFilter1 = filter1.value;
  const activeFilter2 = filter2.value;
  const activeFilter3 = filter3.value;
  const activeStudentFormSelect = studentFormSelect.value;

  // Clear existing items but retain defaults
  filter1.innerHTML = `<option value="all">All Classes</option>`;
  filter2.innerHTML = `<option value="all">All Students</option>`;
  filter3.innerHTML = `<option value="all">All Classes</option>`;
  studentFormSelect.innerHTML = `<option value="">Select Class...</option>`;

  classes.forEach(c => {
    filter1.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    filter2.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    filter3.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    studentFormSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
  });

  // Restore selections
  filter1.value = activeFilter1 || "all";
  filter2.value = activeFilter2 || "all";
  filter3.value = activeFilter3 || "all";
  studentFormSelect.value = activeStudentFormSelect;
}

// Student form trigger configurations
window.openEditStudentModal = function(studentId) {
  const s = students.find(x => x.id === studentId);
  if (!s) return;

  document.getElementById("studentModalTitle").innerHTML = `<i class="bi bi-pencil-square me-2"></i>Edit Student Details`;
  document.getElementById("studentEditId").value = s.id;
  document.getElementById("studentName").value = s.name;
  document.getElementById("studentAdmNumber").value = s.admissionNumber;
  document.getElementById("studentClassSelect").value = s.classId;
  document.getElementById("studentParentName").value = s.parentName;
  document.getElementById("studentParentPhone").value = s.parentPhone;
  document.getElementById("studentJoiningDate").value = s.joiningDate;
  document.getElementById("studentJuz").value = s.currentJuz || 1;
  document.getElementById("studentSurah").value = s.currentSurah || "Al-Baqarah";
  document.getElementById("studentPage").value = s.currentPage || 1;
  
  const avatar = s.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(s.name)}&backgroundColor=10b981`;
  document.getElementById("studentPhotoPreview").src = avatar;

  addStudentModalObj.show();
};

// Reset form on clicking add
document.getElementById("addStudentModal").addEventListener("show.bs.modal", (e) => {
  const button = e.relatedTarget;
  if (button) {
    document.getElementById("studentModalTitle").innerHTML = `<i class="bi bi-person-plus-fill me-2"></i>Add New Student`;
    document.getElementById("studentEditId").value = "";
    document.getElementById("studentForm").reset();
    document.getElementById("studentPhotoPreview").src = "https://images.unsplash.com/photo-1544717305-2782549b5136?w=150";
    document.getElementById("studentJoiningDate").value = getTodayDateString();
  }
});

async function handleStudentSave(e) {
  e.preventDefault();
  
  const studentId = document.getElementById("studentEditId").value;
  const name = document.getElementById("studentName").value.trim();
  const admNum = document.getElementById("studentAdmNumber").value.trim();
  const classId = document.getElementById("studentClassSelect").value;
  const parentName = document.getElementById("studentParentName").value.trim();
  const parentPhone = document.getElementById("studentParentPhone").value.trim();
  const joiningDate = document.getElementById("studentJoiningDate").value;
  const juz = parseInt(document.getElementById("studentJuz").value) || 1;
  const surah = document.getElementById("studentSurah").value.trim();
  const page = parseInt(document.getElementById("studentPage").value) || 1;

  const studentData = {
    name,
    admissionNumber: admNum,
    classId,
    parentName,
    parentPhone,
    joiningDate,
    currentJuz: juz,
    currentSurah: surah,
    currentPage: page
  };

  const submitBtn = document.getElementById("studentSubmitBtn");
  submitBtn.disabled = true;

  const madrasaId = getMadrasaId();
  const originalStudents = [...students];

  // Optimistic update
  let tempStudentId = studentId || "student_temp_" + Date.now();
  const optimisticStudent = { id: tempStudentId, ...studentData };
  
  if (studentId) {
    students = students.map(s => s.id === studentId ? { ...s, ...studentData } : s);
  } else {
    students.push(optimisticStudent);
  }
  
  localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
  renderStudentsView();
  addStudentModalObj.hide();
  showAlert(studentId ? `Student details for "${name}" updated.` : `Student "${name}" added successfully.`);

  try {
    let savedStudent = null;
    if (studentId) {
      await updateStudent(madrasaId, studentId, studentData);
      savedStudent = { id: studentId, ...studentData };
    } else {
      savedStudent = await addStudent(madrasaId, studentData);
      // Replace temp ID with actual ID from database
      students = students.map(s => s.id === tempStudentId ? { ...s, id: savedStudent.id } : s);
      localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
      // Re-render to ensure onclick triggers point to correct ID
      renderStudentsView();
    }

    // Photo uploading if selected
    const photoInput = document.getElementById("studentPhotoInput");
    if (photoInput.files && photoInput.files[0]) {
      try {
        showAlert("Uploading student photo...", "info");
        const downloadUrl = await uploadStudentPhoto(madrasaId, savedStudent.id, photoInput.files[0]);
        // Update local student object photoUrl
        students = students.map(s => s.id === savedStudent.id ? { ...s, photoUrl: downloadUrl } : s);
        localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
        renderStudentsView();
        showAlert("Student photo updated successfully!");
      } catch (photoError) {
        console.error("Photo upload error:", photoError);
        showAlert("Student saved, but photo upload failed.", "warning");
      }
    }
  } catch (error) {
    console.error("Error saving student data:", error);
    students = originalStudents;
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
    renderStudentsView();
    showAlert("Error saving student on server. Rolled back.", "danger");
  } finally {
    submitBtn.disabled = false;
  }
}

window.handleStudentDelete = function(studentId, name) {
  showDeleteConfirm(
    `Are you sure you want to remove student "${name}"? This action deletes their records permanently.`,
    `Remove Student`,
    async () => {
      try {
        await deleteStudent(getMadrasaId(), studentId);
        showAlert(`Student "${name}" deleted.`);
        await loadDatabaseData(true);
        renderStudentsView();
      } catch (error) {
        showAlert("Error deleting student.", "danger");
      }
    }
  );
};

// ==========================================
// VIEW RENDERING: 4. DAILY ENTRY
// ==========================================
function renderDailyView() {
  populateClassDropdowns();
  
  const container = document.getElementById("dailyEntryContainer");
  container.innerHTML = "";

  const filterClass = document.getElementById("dailyClassFilter").value;
  const filtered = filterClass === "all" ? students : students.filter(s => s.classId === filterClass);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center text-muted py-5">
        <i class="bi bi-pencil-square fs-1 opacity-25 d-block mb-2"></i>
        <p class="small">No students enrolled in this class segment.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(student => {
    const report = todayReports[student.id] || { attendance: "" };
    const avatar = student.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}&backgroundColor=10b981`;
    const className = classes.find(c => c.id === student.classId)?.name || "Unassigned";

    const card = document.createElement("div");
    card.className = "glass-card mb-3 p-3";
    card.innerHTML = `
      <div class="d-flex align-items-center gap-3 mb-3">
        <img src="${avatar}" class="student-avatar" style="width: 48px; height: 48px;" alt="${student.name}" onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}'">
        <div class="flex-grow-1 min-w-0">
          <h6 class="fw-bold mb-0 text-truncate">${student.name}</h6>
          <span class="small text-muted">Adm: ${student.admissionNumber} | ${className}</span>
        </div>
      </div>

      <!-- Segmented Attendance Button -->
      <div class="mb-3">
        <div class="attendance-segmented">
          <input type="radio" name="attendance_${student.id}" id="att_present_${student.id}" value="present" ${report.attendance === "present" ? "checked" : ""}>
          <label class="lbl-present" for="att_present_${student.id}" onclick="saveAttendanceStatus('${student.id}', 'present')">Present</label>

          <input type="radio" name="attendance_${student.id}" id="att_leave_${student.id}" value="leave" ${report.attendance === "leave" ? "checked" : ""}>
          <label class="lbl-leave" for="att_leave_${student.id}" onclick="saveAttendanceStatus('${student.id}', 'leave')">Leave</label>

          <input type="radio" name="attendance_${student.id}" id="att_absent_${student.id}" value="absent" ${report.attendance === "absent" ? "checked" : ""}>
          <label class="lbl-absent" for="att_absent_${student.id}" onclick="saveAttendanceStatus('${student.id}', 'absent')">Absent</label>
        </div>
      </div>

      <!-- Quick Progress Ribbon Tracker -->
      <div class="position-tracker py-1 px-2 my-2 justify-content-start gap-3" style="font-size: 11px;">
        <div>Juz: <strong class="text-success">${student.currentJuz || 1}</strong></div>
        <div>Surah: <strong class="text-success">${student.currentSurah || 'Al-Baqarah'}</strong></div>
        <div>Page: <strong class="text-success">${student.currentPage || 1}</strong></div>
      </div>

      <!-- Actions Buttons -->
      <div class="d-flex flex-wrap gap-2 pt-2 border-top border-light-subtle">
        <button class="btn btn-sm btn-primary-premium flex-grow-1 px-1 py-1" style="font-size: 11px;" onclick="openNewLessonModal('${student.id}')" ${report.attendance === 'absent' ? 'disabled' : ''}>
          <i class="bi bi-journal-plus me-1"></i>Sabak (New)
        </button>
        <button class="btn btn-sm btn-outline-success flex-grow-1" style="font-size: 11px;" onclick="openPrevLessonModal('${student.id}')" ${report.attendance === 'absent' ? 'disabled' : ''}>
          <i class="bi bi-clock-history me-1"></i>Sabqi (Prev)
        </button>
        <button class="btn btn-sm btn-outline-warning flex-grow-1" style="font-size: 11px;" onclick="openDawrahModal('${student.id}')" ${report.attendance === 'absent' ? 'disabled' : ''}>
          <i class="bi bi-bookmark-star me-1"></i>Dawrah (Juz)
        </button>
        <button class="btn btn-sm btn-outline-secondary" onclick="openExtraTrackersModal('${student.id}')" title="Salah tracker, behaviors & achievements">
          <i class="bi bi-award"></i>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function filterDailyEntry() {
  renderDailyView();
}

window.saveAttendanceStatus = async function(studentId, status) {
  const madrasaId = getMadrasaId();
  const dateStr = getTodayDateString();
  const existingReport = todayReports[studentId] || { date: dateStr };
  
  const updatedReport = {
    ...existingReport,
    date: dateStr,
    attendance: status
  };

  const originalReports = { ...todayReports };

  // Optimistic update
  todayReports[studentId] = updatedReport;
  localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
  renderDailyView();
  showAlert("Attendance updated.");

  try {
    await saveDailyReport(madrasaId, studentId, updatedReport);
  } catch (error) {
    console.error("Error logging attendance:", error);
    // Rollback
    todayReports = originalReports;
    localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
    renderDailyView();
    showAlert("Error logging attendance: " + error.message, "danger");
  }
};

// PREVIOUS LESSON MODAL COORDINATION
window.openPrevLessonModal = function(studentId) {
  const report = todayReports[studentId] || {};
  document.getElementById("prevLessonStudentId").value = studentId;
  
  if (report.previousLesson) {
    document.getElementById("prevSurah").value = report.previousLesson.surah || "";
    document.getElementById("prevFromAyah").value = report.previousLesson.fromAyah || "";
    document.getElementById("prevToAyah").value = report.previousLesson.toAyah || "";
    
    const grade = report.previousLesson.grade;
    if (grade) {
      document.querySelector(`input[name="prevGrade"][value="${grade}"]`).checked = true;
    }
    document.getElementById("prevRemarks").value = report.previousLesson.remarks || "";
  } else {
    // Fill with current positioning to help the Usthad
    const student = students.find(s => s.id === studentId);
    document.getElementById("prevSurah").value = student?.currentSurah || "";
    document.getElementById("prevFromAyah").value = "";
    document.getElementById("prevToAyah").value = "";
    document.getElementById("prevRemarks").value = "";
    document.getElementById("prevGradeEx").checked = true;
  }
  
  prevLessonModalObj.show();
};

async function handlePrevLessonSave(e) {
  e.preventDefault();
  const studentId = document.getElementById("prevLessonStudentId").value;
  const surah = document.getElementById("prevSurah").value.trim();
  const fromAyah = parseInt(document.getElementById("prevFromAyah").value);
  const toAyah = parseInt(document.getElementById("prevToAyah").value);
  const grade = document.querySelector('input[name="prevGrade"]:checked')?.value || "Excellent";
  const remarks = document.getElementById("prevRemarks").value.trim();

  const prevLesson = surah ? {
    surah,
    fromAyah: isNaN(fromAyah) ? null : fromAyah,
    toAyah: isNaN(toAyah) ? null : toAyah,
    grade,
    remarks: remarks || null
  } : null;

  const dateStr = getTodayDateString();
  const report = todayReports[studentId] || { date: dateStr, attendance: "present" };
  const updatedReport = { ...report, date: dateStr, previousLesson: prevLesson };

  const madrasaId = getMadrasaId();
  const originalReports = { ...todayReports };

  // Optimistic update
  todayReports[studentId] = updatedReport;
  localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
  
  prevLessonModalObj.hide();
  renderDailyView();
  showAlert("Sabqi (Previous Lesson) logged successfully.");

  try {
    await saveDailyReport(madrasaId, studentId, updatedReport);
  } catch (error) {
    console.error("Error saving prev lesson details:", error);
    // Rollback
    todayReports = originalReports;
    localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
    renderDailyView();
    showAlert("Error saving lesson details: " + error.message, "danger");
  }
}

// NEW LESSON MODAL COORDINATION
window.openNewLessonModal = function(studentId) {
  const report = todayReports[studentId] || {};
  document.getElementById("newLessonStudentId").value = studentId;
  const student = students.find(s => s.id === studentId);
  
  if (report.newLesson) {
    document.getElementById("newSurah").value = report.newLesson.surah || "";
    document.getElementById("newFromAyah").value = report.newLesson.fromAyah || "";
    document.getElementById("newToAyah").value = report.newLesson.toAyah || "";
    document.getElementById("newPageNumber").value = report.newLesson.pageNumber || "";
    
    const grade = report.newLesson.grade;
    if (grade) {
      document.querySelector(`input[name="newGrade"][value="${grade}"]`).checked = true;
    }
    document.getElementById("newRemarks").value = report.newLesson.remarks || "";
  } else {
    // Prefill helper
    document.getElementById("newSurah").value = student?.currentSurah || "";
    document.getElementById("newFromAyah").value = "";
    document.getElementById("newToAyah").value = "";
    document.getElementById("newPageNumber").value = student?.currentPage || "";
    document.getElementById("newRemarks").value = "";
    document.getElementById("newGradeEx").checked = true;
  }
  
  newLessonModalObj.show();
};

async function handleNewLessonSave(e) {
  e.preventDefault();
  const studentId = document.getElementById("newLessonStudentId").value;
  const surah = document.getElementById("newSurah").value.trim();
  const fromAyah = parseInt(document.getElementById("newFromAyah").value);
  const toAyah = parseInt(document.getElementById("newToAyah").value);
  const pageNumber = parseInt(document.getElementById("newPageNumber").value);
  const grade = document.querySelector('input[name="newGrade"]:checked')?.value || "Excellent";
  const remarks = document.getElementById("newRemarks").value.trim();

  const newLesson = surah ? {
    surah,
    fromAyah: isNaN(fromAyah) ? null : fromAyah,
    toAyah: isNaN(toAyah) ? null : toAyah,
    pageNumber: isNaN(pageNumber) ? null : pageNumber,
    grade,
    remarks: remarks || null
  } : null;

  const dateStr = getTodayDateString();
  const report = todayReports[studentId] || { date: dateStr, attendance: "present" };
  const updatedReport = { ...report, date: dateStr, newLesson };

  const madrasaId = getMadrasaId();
  const originalReports = { ...todayReports };
  const originalStudents = [...students];

  // Optimistic update todayReports
  todayReports[studentId] = updatedReport;
  localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
  
  // Optimistic update student position (only if logged)
  const studentIdx = students.findIndex(s => s.id === studentId);
  if (studentIdx !== -1 && newLesson && newLesson.pageNumber) {
    students[studentIdx] = {
      ...students[studentIdx],
      currentPage: newLesson.pageNumber,
      currentSurah: newLesson.surah || students[studentIdx].currentSurah
    };
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
  }

  newLessonModalObj.hide();
  renderDailyView();
  showAlert("Sabak (New Lesson) logged and position updated.");

  try {
    await saveDailyReport(madrasaId, studentId, updatedReport);
  } catch (error) {
    console.error("Error saving new lesson details:", error);
    // Rollback
    todayReports = originalReports;
    students = originalStudents;
    localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
    renderDailyView();
    showAlert("Error saving lesson details: " + error.message, "danger");
  }
}

// DAWRAH MODAL COORDINATION
window.openDawrahModal = function(studentId) {
  const report = todayReports[studentId] || {};
  document.getElementById("dawrahStudentId").value = studentId;
  const student = students.find(s => s.id === studentId);

  if (report.dawrah) {
    document.getElementById("dawrahJuz").value = report.dawrah.juzNumber || "";
    document.getElementById("dawrahSurah").value = report.dawrah.surah || "";
    document.getElementById("dawrahFromAyah").value = report.dawrah.fromAyah || "";
    document.getElementById("dawrahToAyah").value = report.dawrah.toAyah || "";
    
    const grade = report.dawrah.grade;
    if (grade) {
      document.querySelector(`input[name="dawrahGrade"][value="${grade}"]`).checked = true;
    }
    document.getElementById("dawrahRemarks").value = report.dawrah.remarks || "";
  } else {
    // Prefill with current student Juz
    document.getElementById("dawrahJuz").value = student?.currentJuz || 1;
    document.getElementById("dawrahSurah").value = "";
    document.getElementById("dawrahFromAyah").value = "";
    document.getElementById("dawrahToAyah").value = "";
    document.getElementById("dawrahRemarks").value = "";
    document.getElementById("dawrahGradeEx").checked = true;
  }

  dawrahModalObj.show();
};

async function handleDawrahSave(e) {
  e.preventDefault();
  const studentId = document.getElementById("dawrahStudentId").value;
  const juzNumber = parseInt(document.getElementById("dawrahJuz").value);
  const surah = document.getElementById("dawrahSurah").value.trim();
  const fromAyah = parseInt(document.getElementById("dawrahFromAyah").value);
  const toAyah = parseInt(document.getElementById("dawrahToAyah").value);
  const grade = document.querySelector('input[name="dawrahGrade"]:checked')?.value || "Excellent";
  const remarks = document.getElementById("dawrahRemarks").value.trim();

  const dawrah = (!isNaN(juzNumber) || surah) ? {
    juzNumber: isNaN(juzNumber) ? null : juzNumber,
    surah: surah || null,
    fromAyah: isNaN(fromAyah) ? null : fromAyah,
    toAyah: isNaN(toAyah) ? null : toAyah,
    grade,
    remarks: remarks || null
  } : null;

  const dateStr = getTodayDateString();
  const report = todayReports[studentId] || { date: dateStr, attendance: "present" };
  const updatedReport = { ...report, date: dateStr, dawrah };

  const madrasaId = getMadrasaId();
  const originalReports = { ...todayReports };
  const originalStudents = [...students];

  // Optimistic update report
  todayReports[studentId] = updatedReport;
  localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));

  // Optimistic update student currentJuz (only if logged)
  const studentIdx = students.findIndex(s => s.id === studentId);
  if (studentIdx !== -1 && dawrah && dawrah.juzNumber) {
    students[studentIdx] = {
      ...students[studentIdx],
      currentJuz: dawrah.juzNumber
    };
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
  }

  dawrahModalObj.hide();
  renderDailyView();
  showAlert("Dawrah log saved.");

  try {
    await saveDailyReport(madrasaId, studentId, updatedReport);
  } catch (error) {
    console.error("Error saving dawrah log:", error);
    // Rollback
    todayReports = originalReports;
    students = originalStudents;
    localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
    renderDailyView();
    showAlert("Error saving dawrah log: " + error.message, "danger");
  }
}

// EXTRA TRACKERS MODAL COORDINATION (Akhlaq, Salah, Badges)
window.openExtraTrackersModal = function(studentId) {
  const report = todayReports[studentId] || {};
  const student = students.find(s => s.id === studentId);
  document.getElementById("trackersStudentId").value = studentId;

  // Set Akhlaq
  document.getElementById("trackerAkhlaq").value = report.akhlaq || "Good";

  // Set Salah
  const salah = report.salah || { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };
  document.getElementById("salahFajr").checked = salah.fajr;
  document.getElementById("salahDhuhr").checked = salah.dhuhr;
  document.getElementById("salahAsr").checked = salah.asr;
  document.getElementById("salahMaghrib").checked = salah.maghrib;
  document.getElementById("salahIsha").checked = salah.isha;

  // Set Badges
  const activeBadges = student?.achievements || [];
  document.getElementById("badgeAttendance").checked = activeBadges.includes("Perfect Attendance");
  document.getElementById("badgeStreak").checked = activeBadges.includes("Continuous Sabak");
  document.getElementById("badgeJuz").checked = activeBadges.includes("Juz Completion");
  document.getElementById("badgeStar").checked = activeBadges.includes("Monthly Star Student");
  document.getElementById("badgeExcellent").checked = activeBadges.includes("Excellent Performance");

  extraTrackersModalObj.show();
};

async function handleExtraTrackersSave(e) {
  e.preventDefault();
  const studentId = document.getElementById("trackersStudentId").value;
  const akhlaq = document.getElementById("trackerAkhlaq").value;
  
  const salah = {
    fajr: document.getElementById("salahFajr").checked,
    dhuhr: document.getElementById("salahDhuhr").checked,
    asr: document.getElementById("salahAsr").checked,
    maghrib: document.getElementById("salahMaghrib").checked,
    isha: document.getElementById("salahIsha").checked
  };

  // Collect checked badges
  const achievements = [];
  if (document.getElementById("badgeAttendance").checked) achievements.push("Perfect Attendance");
  if (document.getElementById("badgeStreak").checked) achievements.push("Continuous Sabak");
  if (document.getElementById("badgeJuz").checked) achievements.push("Juz Completion");
  if (document.getElementById("badgeStar").checked) achievements.push("Monthly Star Student");
  if (document.getElementById("badgeExcellent").checked) achievements.push("Excellent Performance");

  const dateStr = getTodayDateString();
  const report = todayReports[studentId] || { date: dateStr, attendance: "present" };
  const updatedReport = { ...report, date: dateStr, akhlaq, salah };

  const madrasaId = getMadrasaId();
  const originalReports = { ...todayReports };
  const originalStudents = [...students];

  // Optimistic update report
  todayReports[studentId] = updatedReport;
  localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));

  // Optimistic update student achievements
  const sIdx = students.findIndex(s => s.id === studentId);
  if (sIdx !== -1) {
    students[sIdx] = {
      ...students[sIdx],
      achievements: achievements
    };
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
  }

  extraTrackersModalObj.hide();
  renderDailyView();
  showAlert("Trackers and badges updated successfully.");

  try {
    // 1. Update report document
    await saveDailyReport(madrasaId, studentId, updatedReport);
    // 2. Update achievements on the student document
    await updateStudent(madrasaId, studentId, { achievements });
  } catch (error) {
    console.error("Error saving extra trackers:", error);
    // Rollback
    todayReports = originalReports;
    students = originalStudents;
    localStorage.setItem(`cache_today_reports_${madrasaId}`, JSON.stringify(todayReports));
    localStorage.setItem(`cache_students_${madrasaId}`, JSON.stringify(students));
    renderDailyView();
    showAlert("Error saving extra trackers: " + error.message, "danger");
  }
}

// ==========================================
// VIEW RENDERING: 5. REPORTS
// ==========================================
function renderReportsConfig() {
  populateClassDropdowns();
  
  const studentSelect = document.getElementById("reportStudentSelect");
  studentSelect.innerHTML = `<option value="">Choose Student...</option>`;
  
  students.forEach(s => {
    studentSelect.innerHTML += `<option value="${s.id}">${s.name} (Adm: ${s.admissionNumber})</option>`;
  });

  document.getElementById("printReportBtn").disabled = true;
  document.getElementById("reportOutputArea").innerHTML = `
    <div class="text-center text-muted py-5" id="reportPlaceholder">
      <i class="bi bi-file-earmark-bar-graph fs-1 text-success opacity-25 d-block mb-3"></i>
      <p class="mb-0 small">Configure inputs above and click **Generate** to load reports.</p>
    </div>
  `;
}

async function renderPerformanceReport() {
  const studentId = document.getElementById("reportStudentSelect").value;
  const reportType = document.getElementById("reportTypeSelect").value;
  const classFilter = document.getElementById("reportClassFilter").value;
  const outputArea = document.getElementById("reportOutputArea");
  
  if (!studentId) {
    showAlert("Please select a student first.", "warning");
    return;
  }

  const student = students.find(s => s.id === studentId);
  const className = classes.find(c => c.id === student.classId)?.name || "Unassigned";

  outputArea.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-success" role="status"></div>
      <p class="small text-muted mt-2">Compiling records...</p>
    </div>
  `;

  try {
    const logs = await getStudentReports(getMadrasaId(), studentId);
    
    // Filter limits based on type
    let filteredLogs = [...logs];
    if (reportType === "weekly") {
      filteredLogs = logs.slice(0, 15);
    } else if (reportType === "monthly") {
      filteredLogs = logs.slice(0, 30);
    }

    if (filteredLogs.length === 0) {
      outputArea.innerHTML = `
        <div class="text-center py-5">
          <i class="bi bi-clipboard-x fs-1 text-danger opacity-50 d-block mb-2"></i>
          <p class="fw-bold mb-1">No Entries Found</p>
          <span class="small text-muted">There are no progress logs recorded yet for ${student.name}.</span>
        </div>
      `;
      document.getElementById("printReportBtn").disabled = true;
      return;
    }

    // Build Printable HTML layout
    let rowsHtml = "";
    filteredLogs.forEach(log => {
      const attBadge = log.attendance === "present" ? '<span class="badge bg-success">Present</span>' :
                       log.attendance === "leave" ? '<span class="badge bg-warning text-dark">Leave</span>' :
                       '<span class="badge bg-danger">Absent</span>';

      const formatLessonText = (l) => {
        if (!l) return "—";
        let parts = [];
        if (l.surah) parts.push(l.surah);
        if (l.fromAyah !== undefined && l.fromAyah !== null && !isNaN(l.fromAyah)) {
          parts.push(`(${l.fromAyah}-${l.toAyah || '—'})`);
        }
        if (l.pageNumber !== undefined && l.pageNumber !== null && !isNaN(l.pageNumber)) {
          parts.push(`Pg: ${l.pageNumber}`);
        }
        if (l.grade) {
          parts.push(`- <span class="grade-pill grade-${l.grade.toLowerCase()}">${l.grade}</span>`);
        }
        return parts.join(" ") || "—";
      };

      const formatDawrahText = (d) => {
        if (!d) return "—";
        let parts = [];
        if (d.juzNumber !== undefined && d.juzNumber !== null && !isNaN(d.juzNumber)) {
          parts.push(`Juz ${d.juzNumber}`);
        }
        if (d.surah) {
          parts.push(`(${d.surah}`);
          if (d.fromAyah !== undefined && d.fromAyah !== null && !isNaN(d.fromAyah)) {
            parts.push(`${d.fromAyah}-${d.toAyah || '—'}`);
          }
          parts.push(`)`);
        }
        if (d.grade) {
          parts.push(`- <span class="grade-pill grade-${d.grade.toLowerCase()}">${d.grade}</span>`);
        }
        return parts.join(" ") || "—";
      };

      const prevText = formatLessonText(log.previousLesson);
      const newText = formatLessonText(log.newLesson);
      const dawrahText = formatDawrahText(log.dawrah);

      rowsHtml += `
        <tr>
          <td class="small fw-semibold text-nowrap">${log.date}</td>
          <td>${attBadge}</td>
          <td class="small">${newText}</td>
          <td class="small">${prevText}</td>
          <td class="small">${dawrahText}</td>
          <td class="small text-muted">${log.newLesson?.remarks || log.previousLesson?.remarks || log.dawrah?.remarks || '—'}</td>
        </tr>
      `;
    });

    const isLiveSymbol = isOfflineMode ? '<span class="badge bg-warning text-dark float-end">Offline Demo Database</span>' : '';

    outputArea.innerHTML = `
      <div class="report-header pb-3 mb-3 border-bottom d-flex justify-content-between align-items-start">
        <div>
          <h4 class="fw-bold mb-0 text-success">${currentMadrasa.name}</h4>
          <span class="small text-muted">Location: ${currentMadrasa.location} | Head: ${currentMadrasa.usthadName}</span>
        </div>
        <div class="text-end">
          <h5 class="fw-bold mb-0">HIFZ PROGRESS REPORT</h5>
          <span class="small text-muted">Generated on: ${new Date().toLocaleDateString()}</span>
          ${isLiveSymbol}
        </div>
      </div>

      <div class="row g-2 mb-4">
        <div class="col-6 col-md-3">
          <span class="small text-muted d-block">Student Name</span>
          <strong class="text-success">${student.name}</strong>
        </div>
        <div class="col-6 col-md-3">
          <span class="small text-muted d-block">Admission No</span>
          <strong>${student.admissionNumber}</strong>
        </div>
        <div class="col-6 col-md-3">
          <span class="small text-muted d-block">Class Section</span>
          <strong>${className}</strong>
        </div>
        <div class="col-6 col-md-3">
          <span class="small text-muted d-block">Current Tracker Position</span>
          <span class="badge bg-success">Juz ${student.currentJuz || 1}</span>
          <span class="badge bg-info">Surah ${student.currentSurah || 'Al-Baqarah'}</span>
        </div>
        <div class="col-12 mt-2">
          <span class="small text-muted d-block">Achievements Unlocked</span>
          <div class="d-flex flex-wrap gap-1 mt-1">
            ${(student.achievements || []).map(b => `<span class="badge bg-warning text-dark">${b}</span>`).join('') || '<span class="text-muted small">No achievements unlocked yet.</span>'}
          </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-bordered table-striped table-hover align-middle mb-0" style="font-size: 13px;">
          <thead class="table-light">
            <tr>
              <th>Date</th>
              <th>Attendance</th>
              <th>New Lesson (Sabak)</th>
              <th>Previous Lesson (Sabqi)</th>
              <th>Dawrah / Revision</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div class="report-footer mt-4 pt-3 border-top d-none d-print-flex justify-content-between text-muted" style="font-size: 11px;">
        <span>Powered by Hifz Progress Portal</span>
        <span>Signature of Usthad: _________________________</span>
        <span>Parent Signature: _________________________</span>
      </div>
    `;

    document.getElementById("printReportBtn").disabled = false;
  } catch (error) {
    console.error(error);
    outputArea.innerHTML = `<div class="text-center py-5 text-danger">Failed to gather logs. Check connection.</div>`;
    document.getElementById("printReportBtn").disabled = true;
  }
}
