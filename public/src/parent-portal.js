import { getStudentReports, calculateStudentScoresFromReports, updateStudentScores } from "./db.js";
import { isOfflineMode, db } from "../firebase-config.js";
import { showToast } from "./ui-notifications.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ==========================================
// STATE MANAGEMENT (Clean & Non-Corruptible)
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const madrasaId = urlParams.get("madrasaId");

let madrasaDetails = null;
let students = [];
let classes = [];
let selectedStudent = null;
let selectedStudentLogs = [];
let leaderboardActiveTab = "daily";

// In-memory cache for student reports (to avoid duplicate Firestore reads)
const studentReportsCache = {};

// Chart.js instances
let chartGrowth = null;

const RING_CIRCUMFERENCE = 377; // 2 * PI * 60

// Retry backoff configurations
let initialLoadRetries = 0;
const backoffDelays = [1000, 2000, 4000, 8000];
let retryTimeoutId = null;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  // Clean up legacy portal cache from localStorage
  cleanupLegacyCache();

  // Validate parameter layout
  if (!madrasaId || !/^[a-zA-Z0-9_-]+$/.test(madrasaId)) {
    switchScreen('invalid-link');
    return;
  }

  // Start the loading flow
  startInitialLoad();
});

// Clean up old cached entries to prevent state contamination
function cleanupLegacyCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("cache_parent_")) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.error("Failed to clean legacy cache:", e);
  }
}

// ==========================================
// SCREEN SWITCHER (Prevent screen leakages)
// ==========================================
function switchScreen(screenName) {
  const panels = {
    'loading': 'parent-loading-panel',
    'network-error': 'parent-network-error-panel',
    'permission-error': 'parent-permission-error-panel',
    'invalid-link': 'parent-invalid-link-panel',
    'not-found': 'parent-not-found-panel',
    'search': 'parent-search-panel',
    'profile': 'parent-profile-panel'
  };

  // Hide all screens
  Object.values(panels).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('d-none');
      el.classList.remove('d-block');
    }
  });

  // Show selected screen
  const activeId = panels[screenName];
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.classList.remove('d-none');
      el.classList.add('d-block');
    }
  }
}

// ==========================================
// INITIAL LOADING & RETRY SYSTEM
// ==========================================
async function startInitialLoad() {
  switchScreen('loading');
  document.getElementById("parent-loading-title").textContent = "Connecting to Portal...";
  document.getElementById("parent-loading-message").textContent = "Verifying database connections and gathering reports.";

  try {
    const exists = await fetchInitialData();
    if (!exists) {
      switchScreen('not-found');
      return;
    }

    // Success! Transition to search panel
    switchScreen('search');
    setupSearchSystem();
    setupPrintTriggers();
    switchLeaderboardTab("daily");

    // Initialize real-time listeners (only after initial load succeeds)
    setupLiveListeners();

  } catch (error) {
    console.error("Portal initial load failed:", error);
    if (error.code === "permission-denied" || error.message?.toLowerCase().includes("permission")) {
      switchScreen('permission-error');
    } else {
      handleInitialLoadNetworkError(error);
    }
  }
}

// Fetch all required data once using getDoc/getDocs (no listeners)
async function fetchInitialData() {
  if (isOfflineMode) {
    const mockMMap = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
    const localMadrasa = mockMMap[madrasaId];
    if (!localMadrasa) return false;

    const mockClasses = JSON.parse(localStorage.getItem(`mock_classes_${madrasaId}`)) || {};
    const freshClasses = Object.values(mockClasses);

    const mockStudents = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    const freshStudents = Object.values(mockStudents);

    // Seed mock scores
    seedRanksAndScores(freshStudents);

    // Save to state
    madrasaDetails = localMadrasa;
    classes = freshClasses;
    students = freshStudents;

    updatePortalUI();
    return true;
  } else {
    // Read Madrasa doc
    const mDocRef = doc(db, "madrasas", madrasaId);
    const mDoc = await getDoc(mDocRef);
    if (!mDoc.exists()) return false;

    // Read Classes list
    const classesCol = collection(db, "madrasas", madrasaId, "classes");
    const classesSnap = await getDocs(classesCol);
    const freshClasses = classesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Read Students list (fetch all once so we can search locally in-memory)
    const studentsCol = collection(db, "madrasas", madrasaId, "students");
    const studentsSnap = await getDocs(studentsCol);
    const freshStudents = studentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    seedRanksAndScores(freshStudents);

    // Save to state
    madrasaDetails = mDoc.data();
    classes = freshClasses;
    students = freshStudents;

    updatePortalUI();
    return true;
  }
}

// Exponential backoff retry handler
function handleInitialLoadNetworkError(error) {
  switchScreen('network-error');
  document.getElementById("parent-network-error-message").textContent = `A database connection error occurred: ${error.message || error}.`;

  const delay = backoffDelays[Math.min(initialLoadRetries, backoffDelays.length - 1)];
  initialLoadRetries++;

  let secondsLeft = Math.round(delay / 1000);
  const retryTextEl = document.getElementById("parent-network-error-retry-text");

  if (retryTextEl) {
    retryTextEl.textContent = `Retrying automatically in ${secondsLeft} second${secondsLeft > 1 ? 's' : ''}...`;
  }

  if (retryTimeoutId) clearTimeout(retryTimeoutId);

  const intervalId = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(intervalId);
      startInitialLoad();
    } else {
      if (retryTextEl) {
        retryTextEl.textContent = `Retrying automatically in ${secondsLeft} second${secondsLeft > 1 ? 's' : ''}...`;
      }
    }
  }, 1000);
}

// Helper to seed scores/ranks if missing
function seedRanksAndScores(studentList) {
  studentList.forEach(s => {
    s.score = s.score || 0;
    s.dailyScore = s.dailyScore || 0;
    s.weeklyScore = s.weeklyScore || 0;
    s.monthlyScore = s.monthlyScore || 0;
  });

  // Assign ranks dynamically based on total score descending
  const sorted = [...studentList].sort((a, b) => (b.score || 0) - (a.score || 0));
  sorted.forEach((student, index) => {
    const s = studentList.find(x => x.id === student.id);
    if (s) {
      s.currentRank = index + 1;
      s.previousRank = s.previousRank || (index + 1);
    }
  });
}

// ==========================================
// REAL-TIME FIRESTORE LISTENERS (Safe Update)
// ==========================================
let activeListeners = [];

function setupLiveListeners() {
  if (isOfflineMode) return;

  // Clear existing
  activeListeners.forEach(unsub => unsub());
  activeListeners = [];

  // Listen to classes updates
  const classesCol = collection(db, "madrasas", madrasaId, "classes");
  const unsubClasses = onSnapshot(classesCol, (snapshot) => {
    classes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    updatePortalUI();
    if (selectedStudent) {
      loadStudentProfileView();
    }
  }, (error) => {
    console.warn("Classes live sync connection lost:", error);
    showToast("Connection lost. Retrying...", "warning");
  });
  activeListeners.push(unsubClasses);

  // Listen to students updates
  const studentsCol = collection(db, "madrasas", madrasaId, "students");
  const unsubStudents = onSnapshot(studentsCol, (snapshot) => {
    const freshStudents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    seedRanksAndScores(freshStudents);
    students = freshStudents;

    // Refresh UI counts
    updatePortalUI();

    // Refresh Leaderboard
    if (leaderboardActiveTab) {
      renderLeaderboardList(leaderboardActiveTab);
    }

    // Refresh active student profile live
    if (selectedStudent) {
      const updated = students.find(s => s.id === selectedStudent.id);
      if (updated) {
        selectedStudent = updated;
        loadStudentProfileView();
      }
    }
  }, (error) => {
    console.warn("Students live sync connection lost:", error);
    showToast("Connection lost. Retrying...", "warning");
  });
  activeListeners.push(unsubStudents);
}

// ==========================================
// PORTAL UI RENDER (Top Header Details)
// ==========================================
function updatePortalUI() {
  if (!madrasaDetails) return;

  document.getElementById("portalBrandingTitle").textContent = madrasaDetails.name;
  document.getElementById("portalBrandingLocation").textContent = madrasaDetails.location || "Location not set";
  document.getElementById("portalBrandingContact").textContent = madrasaDetails.mobile || madrasaDetails.phone || "No Contact info";
  document.getElementById("portalBrandingEmail").textContent = madrasaDetails.email || "No Email info";

  const logoEl = document.getElementById("portalBrandingLogo");
  if (logoEl) {
    logoEl.src = madrasaDetails.logoUrl || "assets/madrasa_logo.png";
  }

  const heroEl = document.getElementById("portalBrandingHero");
  if (heroEl) {
    if (madrasaDetails.bannerUrl) {
      heroEl.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 100%), url('${madrasaDetails.bannerUrl}')`;
    } else {
      heroEl.style.backgroundImage = `linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 100%), url('assets/madrasa_banner.jpg')`;
    }
  }

  document.getElementById("statsStudentCount").textContent = students.length;
  document.getElementById("statsClassCount").textContent = classes.length;
}

// ==========================================
// IN-MEMORY LOCAL SEARCH ENGINE
// ==========================================
function setupSearchSystem() {
  const searchInput = document.getElementById("parentSearchInput");
  const resultsSection = document.getElementById("searchResultsSection");
  const resultsContainer = document.getElementById("searchResultsContainer");
  const leaderboardSection = document.getElementById("leaderboardSection");
  const searchMessage = document.getElementById("searchMessage");

  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim();
    if (searchMessage) searchMessage.classList.add("d-none");

    if (!val) {
      resultsSection.classList.add("d-none");
      leaderboardSection.classList.remove("d-none");
      return;
    }

    leaderboardSection.classList.add("d-none");
    resultsSection.classList.remove("d-none");

    // Perform local in-memory filtering (ZERO firestore reads!)
    const queryLower = val.toLowerCase();
    const matches = students.filter(s =>
      s.name.toLowerCase().includes(queryLower) ||
      s.admissionNumber.toLowerCase().includes(queryLower)
    );

    renderSearchResults(matches);
  });
}

function renderSearchResults(matches) {
  const resultsContainer = document.getElementById("searchResultsContainer");
  resultsContainer.innerHTML = "";

  if (matches.length === 0) {
    resultsContainer.innerHTML = `
      <div class="col-12 text-center text-muted py-4">
        <i class="bi bi-x-circle fs-2 opacity-25 d-block mb-2"></i>
        <span class="small">No matching students found in this Madrasa.</span>
      </div>
    `;
    return;
  }

  matches.forEach(student => {
    const className = classes.find(c => c.id === student.classId)?.name || "Unassigned";
    const avatar = student.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}&backgroundColor=10b981`;

    const cardCol = document.createElement("div");
    cardCol.className = "col-12 col-md-6";
    cardCol.innerHTML = `
      <div class="glass-card mb-0 p-3 h-100 d-flex align-items-center gap-3">
        <img src="${avatar}" class="student-avatar" style="width: 48px; height: 48px;" alt="${student.name}" onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}'">
        <div class="flex-grow-1 min-w-0">
          <h6 class="fw-bold mb-0 text-truncate text-success">${student.name}</h6>
          <div class="small text-muted" style="font-size: 11px;">
            <span>Adm: <strong>${student.admissionNumber}</strong></span> | 
            <span>Juz: <strong class="text-success">${student.currentJuz || 1}</strong></span>
          </div>
          <div class="small text-muted" style="font-size: 11px;">Class: ${className}</div>
        </div>
        <button class="btn btn-sm btn-primary-premium rounded-pill px-3 py-1" style="font-size: 11px;" onclick="openProfileDirectly('${student.id}')">
          View Profile
        </button>
      </div>
    `;
    resultsContainer.appendChild(cardCol);
  });
}

// Expose click handler to global/inline onclick
window.openProfileDirectly = async function (studentId) {
  const matched = students.find(s => s.id === studentId);
  if (!matched) return;

  selectedStudent = matched;

  // Use cached reports if available to optimize reads
  if (studentReportsCache[studentId]) {
    selectedStudentLogs = studentReportsCache[studentId];
    loadStudentProfileView();
    return;
  }

  // Fetch reports from Firestore and store in memory cache
  try {
    selectedStudentLogs = await getStudentReports(madrasaId, studentId);
    studentReportsCache[studentId] = selectedStudentLogs;
    loadStudentProfileView();
  } catch (err) {
    console.error("Failed to load reports for student:", studentId, err);
    showToast("Failed to retrieve progress logs.", "danger");
  }
};

// ==========================================
// LEADERBOARD MODULE
// ==========================================
window.switchLeaderboardTab = function (tabId) {
  leaderboardActiveTab = tabId;

  // Highlight tab
  document.querySelectorAll("#leaderboardTabs button").forEach(btn => {
    btn.classList.remove("active", "text-success");
  });
  const activeBtn = document.getElementById(`btn-ld-${tabId}`);
  if (activeBtn) activeBtn.classList.add("active", "text-success");

  renderLeaderboardList(tabId);
};

// Sorted list caching helper
const leaderboardSortCache = {};

function renderLeaderboardList(tabId) {
  const container = document.getElementById("leaderboardList");
  container.innerHTML = "";

  // Sort and slice top 10 locally
  const sorted = [...students].sort((a, b) => {
    if (tabId === "daily") return (b.dailyScore || 0) - (a.dailyScore || 0);
    if (tabId === "weekly") return (b.weeklyScore || 0) - (a.weeklyScore || 0);
    if (tabId === "monthly") return (b.monthlyScore || 0) - (a.monthlyScore || 0);
    return (b.score || 0) - (a.score || 0);
  });

  const topTen = sorted.slice(0, 10);

  if (topTen.length === 0) {
    container.innerHTML = `<div class="text-center py-4 text-muted small">No student rankings recorded yet.</div>`;
    return;
  }

  topTen.forEach((student, index) => {
    const rank = index + 1;
    let cardClass = "";
    let rankBadgeClass = "rank-badge-other";
    let trophyIcon = "";

    if (rank === 1) {
      cardClass = "rank-card-1";
      rankBadgeClass = "rank-badge-1";
      trophyIcon = `<i class="bi bi-crown-fill text-warning me-1"></i>`;
    } else if (rank === 2) {
      cardClass = "rank-card-2";
      rankBadgeClass = "rank-badge-2";
      trophyIcon = `<i class="bi bi-award-fill text-secondary me-1"></i>`;
    } else if (rank === 3) {
      cardClass = "rank-card-3";
      rankBadgeClass = "rank-badge-3";
      trophyIcon = `<i class="bi bi-award-fill text-danger me-1"></i>`;
    }

    const score = tabId === "daily" ? student.dailyScore :
      tabId === "weekly" ? student.weeklyScore :
        tabId === "monthly" ? student.monthlyScore : student.score;

    const badge = student.achievements && student.achievements.length > 0
      ? `<span class="badge bg-success-subtle text-success small rounded-pill" style="font-size: 9px;">${student.achievements[0]}</span>`
      : "";

    const avatar = student.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}&backgroundColor=10b981`;

    const row = document.createElement("div");
    row.className = `glass-card py-2 px-3 mb-0 d-flex align-items-center gap-3 ${cardClass}`;
    row.style.cursor = "pointer";
    row.innerHTML = `
      <div class="d-flex align-items-center justify-content-center rounded-circle ${rankBadgeClass}" style="width: 28px; height: 28px; font-size: 13px;">
        ${rank}
      </div>
      <img src="${avatar}" class="rounded-circle border" style="width: 38px; height: 38px; object-fit: cover;" alt="${student.name}" onerror="this.src='https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(student.name)}'">
      <div class="flex-grow-1 min-w-0">
        <h6 class="fw-bold mb-0 text-truncate">${trophyIcon}${student.name}</h6>
        <span class="text-muted small" style="font-size: 11px;">Juz ${student.currentJuz || 1} | Score: <strong>${score}</strong></span>
      </div>
      <div>
        ${badge}
      </div>
    `;

    row.addEventListener("click", () => {
      openProfileDirectly(student.id);
    });

    container.appendChild(row);
  });
}

// ==========================================
// STUDENT PROFILE PAGE MODULE
// ==========================================
function loadStudentProfileView() {
  const s = selectedStudent;
  const logs = selectedStudentLogs;

  if (!s) return;

  // Set identity
  document.getElementById("p-childName").textContent = s.name;
  const className = classes.find(c => c.id === s.classId)?.name || "Unassigned";
  document.getElementById("p-childMeta").textContent = `Adm: ${s.admissionNumber} | Class: ${className}`;
  document.getElementById("p-childParentName").textContent = s.parentName || "—";
  document.getElementById("p-childJoiningDate").textContent = s.joiningDate || "—";
  document.getElementById("p-childMadrasa").textContent = madrasaDetails.name;
  document.getElementById("p-childPhoto").src = s.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(s.name)}&backgroundColor=10b981`;

  // Statistics calculations
  const totalLogs = logs.length;
  const presentLogs = logs.filter(l => l.attendance === "present" || l.attendance === "leave").length;
  const attPct = totalLogs > 0 ? Math.round((presentLogs / totalLogs) * 100) : 0;
  const completionPct = Math.min(Math.round(((s.currentPage || 1) / 604) * 100), 100);

  const currentRank = s.currentRank || 1;

  document.getElementById("p-childAttendancePct").textContent = attPct + "%";
  document.getElementById("p-childCompletionPct").textContent = completionPct + "%";
  document.getElementById("p-childRank").textContent = `#${currentRank}`;
  document.getElementById("p-childBadgesCount").textContent = (s.achievements || []).length;

  // Position metrics
  document.getElementById("posJuz").textContent = s.currentJuz || 1;
  document.getElementById("posSurah").textContent = s.currentSurah || "Al-Baqarah";
  document.getElementById("posPage").textContent = s.currentPage || 1;
  document.getElementById("posPagesTotal").textContent = s.currentPage || 1;

  // Animate Completion Ring
  animateCompletionRing(completionPct, s.currentPage || 1);

  // Today's progress logs
  renderTodayProgressBox(logs);

  // Render list elements
  renderHistoryTable("full");
  renderTimelineAchievements(s.achievements || []);

  // Set filter trigger
  const hFilter = document.getElementById("historyFilterSelect");
  hFilter.value = "full";
  hFilter.onchange = () => renderHistoryTable(hFilter.value);

  // Render Charts
  renderAnalyticsCharts(logs);

  // Background self-healing score update using real reports data
  if (logs.length > 0) {
    const freshScores = calculateStudentScoresFromReports(logs);
    const scoresChanged = freshScores.score !== s.score || freshScores.dailyScore !== s.dailyScore || freshScores.weeklyScore !== s.weeklyScore || freshScores.monthlyScore !== s.monthlyScore;
    if (scoresChanged) {
      // Update local state
      s.score = freshScores.score;
      s.dailyScore = freshScores.dailyScore;
      s.weeklyScore = freshScores.weeklyScore;
      s.monthlyScore = freshScores.monthlyScore;
      // Re-assign ranks and update DB
      seedRanksAndScores(students);
      updateStudentScores(madrasaId, s.id).catch(err => console.error("Error healing student scores:", err));
      // Refresh rankings UI
      if (leaderboardActiveTab) renderLeaderboardList(leaderboardActiveTab);
      // Refresh top rank metric on card
      document.getElementById("p-childRank").textContent = `#${s.currentRank || 1}`;
    }
  }

  // Switch to profile layout
  switchScreen('profile');

  // Back button event setup
  document.getElementById("closeProfileBtn").onclick = () => {
    switchScreen('search');

    // Clear search
    document.getElementById("parentSearchInput").value = "";
    document.getElementById("searchResultsSection").classList.add("d-none");
    document.getElementById("leaderboardSection").classList.remove("d-none");

    selectedStudent = null;
    selectedStudentLogs = [];
  };
}

function renderTodayProgressBox(logs) {
  const badge = document.getElementById("p-todayAttendanceBadge");
  const sabakText = document.getElementById("p-sabakText");
  const sabakRemarks = document.getElementById("p-sabakRemarks");
  const sabakGrade = document.getElementById("p-sabakGrade");

  const sabqiText = document.getElementById("p-sabqiText");
  const sabqiRemarks = document.getElementById("p-sabqiRemarks");
  const sabqiGrade = document.getElementById("p-sabqiGrade");

  const dawrahText = document.getElementById("p-dawrahText");
  const dawrahRemarks = document.getElementById("p-dawrahRemarks");
  const dawrahGrade = document.getElementById("p-dawrahGrade");

  const akhlaq = document.getElementById("p-todayAkhlaq");
  const salah = document.getElementById("p-todaySalah");

  if (logs.length === 0) {
    badge.className = "badge bg-secondary";
    badge.textContent = "No Logs";
    document.getElementById("p-sabakBox").className = "p-2 rounded bg-light border-start border-3 border-secondary mb-1 opacity-50";
    document.getElementById("p-sabqiBox").className = "d-none";
    document.getElementById("p-dawrahBox").className = "d-none";
    return;
  }

  const latest = logs[0];

  if (latest.attendance === "present") {
    badge.className = "badge bg-success";
    badge.textContent = "Present Today";
    document.getElementById("p-sabakBox").className = "p-2 rounded bg-light border-start border-3 border-success mb-1";
    document.getElementById("p-sabqiBox").className = "p-2 rounded bg-light border-start border-3 border-primary mb-1";
    document.getElementById("p-dawrahBox").className = "p-2 rounded bg-light border-start border-3 border-warning mb-1";
  } else if (latest.attendance === "leave") {
    badge.className = "badge bg-warning text-dark";
    badge.textContent = "On Leave";
    document.getElementById("p-sabakBox").className = "p-2 rounded bg-light border-start border-3 border-secondary mb-1 opacity-50";
    document.getElementById("p-sabqiBox").className = "d-none";
    document.getElementById("p-dawrahBox").className = "d-none";
  } else {
    badge.className = "badge bg-danger";
    badge.textContent = "Absent";
    document.getElementById("p-sabakBox").className = "p-2 rounded bg-light border-start border-3 border-secondary mb-1 opacity-50";
    document.getElementById("p-sabqiBox").className = "d-none";
    document.getElementById("p-dawrahBox").className = "d-none";
  }

  // Sabak details
  if (latest.newLesson) {
    const lesson = latest.newLesson;
    let parts = [];
    if (lesson.surah) parts.push(lesson.surah);
    if (lesson.fromAyah !== undefined && lesson.fromAyah !== null && !isNaN(lesson.fromAyah)) {
      parts.push(`(Ayah ${lesson.fromAyah}-${lesson.toAyah || '—'})`);
    }
    if (lesson.pageNumber !== undefined && lesson.pageNumber !== null && !isNaN(lesson.pageNumber)) {
      parts.push(`Pg: ${lesson.pageNumber}`);
    }
    sabakText.textContent = parts.join(" ") || "Lesson details not logged.";
    sabakRemarks.textContent = lesson.remarks || "No feedback logged.";
    if (lesson.grade) {
      sabakGrade.className = `grade-pill grade-${lesson.grade.toLowerCase()}`;
      sabakGrade.textContent = lesson.grade;
      sabakGrade.classList.remove("d-none");
    } else {
      sabakGrade.classList.add("d-none");
    }
  } else {
    sabakText.textContent = "No new lesson logged today.";
    sabakRemarks.textContent = "";
    sabakGrade.classList.add("d-none");
  }

  // Sabqi details
  if (latest.previousLesson) {
    const lesson = latest.previousLesson;
    let parts = [];
    if (lesson.surah) parts.push(lesson.surah);
    if (lesson.fromAyah !== undefined && lesson.fromAyah !== null && !isNaN(lesson.fromAyah)) {
      parts.push(`(Ayah ${lesson.fromAyah}-${lesson.toAyah || '—'})`);
    }
    sabqiText.textContent = parts.join(" ") || "Revision details not logged.";
    sabqiRemarks.textContent = lesson.remarks || "No feedback logged.";
    if (lesson.grade) {
      sabqiGrade.className = `grade-pill grade-${lesson.grade.toLowerCase()}`;
      sabqiGrade.textContent = lesson.grade;
      sabqiGrade.classList.remove("d-none");
    } else {
      sabqiGrade.classList.add("d-none");
    }
  } else {
    sabqiText.textContent = "No previous lesson log today.";
    sabqiRemarks.textContent = "";
    sabqiGrade.classList.add("d-none");
  }

  // Dawrah details
  if (latest.dawrah) {
    const d = latest.dawrah;
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
    dawrahText.textContent = parts.join(" ") || "Revision details not logged.";
    dawrahRemarks.textContent = d.remarks || "No feedback logged.";
    if (d.grade) {
      dawrahGrade.className = `grade-pill grade-${d.grade.toLowerCase()}`;
      dawrahGrade.textContent = d.grade;
      dawrahGrade.classList.remove("d-none");
    } else {
      dawrahGrade.classList.add("d-none");
    }
  } else {
    dawrahText.textContent = "No revision log today.";
    dawrahRemarks.textContent = "";
    dawrahGrade.classList.add("d-none");
  }

  // Behaviour and prayers
  akhlaq.textContent = latest.akhlaq || "Good";
  if (latest.salah) {
    let cnt = 0;
    Object.values(latest.salah).forEach(v => { if (v) cnt++; });
    salah.textContent = `${cnt} / 5 Prayers`;
  } else {
    salah.textContent = "Not Tracked Today";
  }
}

function animateCompletionRing(pct, currentPage) {
  const ring = document.getElementById("p-completionRing");
  if (!ring) return;
  const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
  ring.style.strokeDashoffset = offset;
  document.getElementById("p-completionRingPct").textContent = pct + "%";
  document.getElementById("p-completionRingRatio").textContent = `${currentPage} of 604 pages`;
}

// ==========================================
// DRAW ANALYTICS CHARTS (Optimized)
// ==========================================
function renderAnalyticsCharts(logs) {
  // Destroy previous chart to avoid canvas overlap exceptions
  if (chartGrowth) chartGrowth.destroy();

  const chronological = [...logs].reverse();

  // Memorization Growth Area Chart
  const growthLabels = [];
  const growthData = [];
  chronological.forEach(l => {
    if (l.newLesson && l.newLesson.pageNumber && !isNaN(l.newLesson.pageNumber)) {
      growthLabels.push(l.date.substring(5)); // MM-DD
      growthData.push(l.newLesson.pageNumber);
    }
  });

  const growthCtx = document.getElementById("c-memorizationGrowth");
  if (growthCtx) {
    chartGrowth = new Chart(growthCtx.getContext("2d"), {
      type: 'line',
      data: {
        labels: growthLabels.length > 0 ? growthLabels : ['No logs'],
        datasets: [{
          label: 'Cumulative Pages',
          data: growthData.length > 0 ? growthData : [0],
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(0,0,0,0.02)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }
}

// ==========================================
// TIMELINE & LOGS POPULATION
// ==========================================
function renderTimelineAchievements(badges) {
  const container = document.getElementById("p-timelineList");
  if (!container) return;
  container.innerHTML = "";

  if (!badges || badges.length === 0) {
    container.innerHTML = `<div class="text-muted small">No badges unlocked yet.</div>`;
    return;
  }

  badges.forEach(b => {
    let badgeClass = "badge-excellent";
    let icon = "bi-award";
    let desc = "Earned for high diligence.";

    if (b === "Perfect Attendance") {
      badgeClass = "badge-attendance";
      icon = "bi-calendar-check";
      desc = "Logged 100% active attendance.";
    } else if (b === "Continuous Sabak") {
      badgeClass = "badge-streak";
      icon = "bi-lightning-fill";
      desc = "Consistent daily lesson logging.";
    } else if (b === "Juz Completion") {
      badgeClass = "badge-juz";
      icon = "bi-bookmark-check";
      desc = "Completed a Quran Juz segment.";
    } else if (b === "Monthly Star Student") {
      badgeClass = "badge-star";
      icon = "bi-star-fill";
      desc = "Awarded student of the month.";
    }

    const div = document.createElement("div");
    div.className = "timeline-vertical-item";
    div.innerHTML = `
      <div class="timeline-vertical-bullet bg-white border border-light-subtle d-flex align-items-center justify-content-center">
        <i class="bi ${icon} text-success" style="font-size: 8px;"></i>
      </div>
      <div class="ms-3">
        <span class="achievement-badge ${badgeClass} m-0 mb-1 d-inline-flex">${b}</span>
        <p class="small text-muted mb-0" style="font-size: 11px;">${desc}</p>
      </div>
    `;
    container.appendChild(div);
  });
}

function renderHistoryTable(filterType) {
  const tbody = document.getElementById("p-historyTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let filtered = [...selectedStudentLogs];
  if (filterType === "daily") {
    filtered = selectedStudentLogs.slice(0, 1);
  } else if (filterType === "weekly") {
    filtered = selectedStudentLogs.slice(0, 15);
  } else if (filterType === "monthly") {
    filtered = selectedStudentLogs.slice(0, 30);
  } else if (filterType === "yearly") {
    filtered = selectedStudentLogs.slice(0, 120);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">No logs found.</td></tr>`;
    return;
  }

  filtered.forEach(log => {
    const att = log.attendance === "present" ? '<span class="badge bg-success">Present</span>' :
      log.attendance === "leave" ? '<span class="badge bg-warning text-dark">Leave</span>' :
        '<span class="badge bg-danger">Absent</span>';

    const sabak = log.newLesson ? `${log.newLesson.surah} (${log.newLesson.fromAyah}-${log.newLesson.toAyah})` : "—";
    const sabqi = log.previousLesson ? `${log.previousLesson.surah} (${log.previousLesson.fromAyah}-${log.previousLesson.toAyah})` : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${log.date}</td>
      <td>${att}</td>
      <td>${sabak}</td>
      <td>${sabqi}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// PRINTING SYSTEM
// ==========================================
window.printSection = function (type) {
  const s = selectedStudent;
  const logs = selectedStudentLogs;
  const className = classes.find(c => c.id === s.classId)?.name || "Unassigned";

  if (logs.length === 0) {
    showToast("No records logged to download.", "warning");
    return;
  }

  const latest = logs[0];

  // Helper formatters
  const formatLesson = (l) => {
    if (!l) return "—";
    let parts = [];
    if (l.surah) parts.push(l.surah);
    if (l.fromAyah !== undefined && l.fromAyah !== null && !isNaN(l.fromAyah)) {
      parts.push(`(${l.fromAyah}-${l.toAyah || '—'})`);
    }
    if (l.pageNumber !== undefined && l.pageNumber !== null && !isNaN(l.pageNumber)) {
      parts.push(`Pg: ${l.pageNumber}`);
    }
    return parts.join(" ") || "—";
  };

  const formatDawrah = (d) => {
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
    return parts.join(" ") || "—";
  };

  // Daily sheet population
  document.getElementById("print-daily-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-daily-madrasa-loc").textContent = madrasaDetails.location;
  document.getElementById("print-daily-date").textContent = latest.date;
  document.getElementById("print-daily-name").textContent = s.name;
  document.getElementById("print-daily-adm").textContent = s.admissionNumber;
  document.getElementById("print-daily-class").textContent = className;
  document.getElementById("print-daily-pos").textContent = `Juz ${s.currentJuz || 1} | Surah ${s.currentSurah || 'Al-Baqarah'} | Pg ${s.currentPage || 1}`;

  document.getElementById("print-daily-sabak-det").textContent = formatLesson(latest.newLesson);
  document.getElementById("print-daily-sabak-grd").textContent = latest.newLesson?.grade || "—";
  document.getElementById("print-daily-sabak-rem").textContent = latest.newLesson?.remarks || "—";

  document.getElementById("print-daily-sabqi-det").textContent = formatLesson(latest.previousLesson);
  document.getElementById("print-daily-sabqi-grd").textContent = latest.previousLesson?.grade || "—";
  document.getElementById("print-daily-sabqi-rem").textContent = latest.previousLesson?.remarks || "—";

  document.getElementById("print-daily-dawrah-det").textContent = formatDawrah(latest.dawrah);
  document.getElementById("print-daily-dawrah-grd").textContent = latest.dawrah?.grade || "—";
  document.getElementById("print-daily-dawrah-rem").textContent = latest.dawrah?.remarks || "—";

  document.getElementById("print-daily-akhlaq").textContent = latest.akhlaq || "Good";

  if (latest.salah) {
    let count = 0;
    Object.values(latest.salah).forEach(val => { if (val) count++; });
    document.getElementById("print-daily-salah").textContent = `${count} of 5 prayers checked.`;
  } else {
    document.getElementById("print-daily-salah").textContent = "Not Tracked Today";
  }

  // Weekly sheet population
  document.getElementById("print-weekly-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-weekly-name").textContent = s.name;
  document.getElementById("print-weekly-adm").textContent = s.admissionNumber;
  document.getElementById("print-weekly-pos").textContent = `Juz ${s.currentJuz || 1} | Page ${s.currentPage || 1}`;

  const weeklyTbody = document.getElementById("print-weekly-table-body");
  weeklyTbody.innerHTML = "";
  logs.slice(0, 15).forEach(log => {
    const sabak = formatLesson(log.newLesson);
    const sabqi = formatLesson(log.previousLesson);
    weeklyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${(log.attendance || "").toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${sabqi}</td>
        <td>${log.newLesson?.remarks || log.previousLesson?.remarks || '—'}</td>
      </tr>
    `;
  });

  // Monthly sheet population
  document.getElementById("print-monthly-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-monthly-name").textContent = s.name;
  document.getElementById("print-monthly-adm").textContent = s.admissionNumber;
  document.getElementById("print-monthly-pos").textContent = `Juz ${s.currentJuz || 1}`;
  document.getElementById("print-monthly-achievements").textContent = (s.achievements || []).join(", ") || "None";

  const monthlyTbody = document.getElementById("print-monthly-table-body");
  monthlyTbody.innerHTML = "";
  logs.slice(0, 30).forEach(log => {
    const sabak = formatLesson(log.newLesson);
    const sabqi = formatLesson(log.previousLesson);
    const dawrah = formatDawrah(log.dawrah);
    monthlyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${(log.attendance || "").toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${sabqi}</td>
        <td>${dawrah}</td>
      </tr>
    `;
  });

  // Yearly sheet population
  document.getElementById("print-yearly-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-yearly-date").textContent = new Date().toLocaleDateString();
  document.getElementById("print-yearly-name").textContent = s.name;
  document.getElementById("print-yearly-adm").textContent = s.admissionNumber;
  document.getElementById("print-yearly-join").textContent = s.joiningDate || "—";
  document.getElementById("print-yearly-pos").textContent = `Juz ${s.currentJuz || 1} | Surah ${s.currentSurah || 'Al-Baqarah'} | Pg ${s.currentPage || 1}`;
  document.getElementById("print-yearly-badges").textContent = `${(s.achievements || []).length} Badges`;

  const yearlyTbody = document.getElementById("print-yearly-table-body");
  yearlyTbody.innerHTML = "";
  logs.slice(0, 100).forEach(log => {
    const sabak = formatLesson(log.newLesson);
    yearlyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${(log.attendance || "").toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${log.newLesson?.remarks || '—'}</td>
      </tr>
    `;
  });

  // History statement population
  document.getElementById("print-history-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-history-name").textContent = s.name;
  document.getElementById("print-history-adm").textContent = s.admissionNumber;
  document.getElementById("print-history-class").textContent = className;

  const historyTbody = document.getElementById("print-history-table-body");
  historyTbody.innerHTML = "";
  logs.forEach(log => {
    const sabak = formatLesson(log.newLesson);
    const sabqi = formatLesson(log.previousLesson);
    const dawrah = formatDawrah(log.dawrah);
    historyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${(log.attendance || "").toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${sabqi}</td>
        <td>${dawrah}</td>
        <td>${log.newLesson?.remarks || log.previousLesson?.remarks || '—'}</td>
      </tr>
    `;
  });

  const targetClass = `print-${type}-sheet`;
  document.body.classList.add(targetClass);
  window.print();

  setTimeout(() => {
    document.body.classList.remove(targetClass);
  }, 1000);
};

function setupPrintTriggers() {
  window.onafterprint = () => {
    document.body.className = document.body.className.replace(/\bprint-\S+-sheet\b/g, '');
  };
}
