import { getStudentReports, getStudents, getClasses } from "./db.js";
import { isOfflineMode, db } from "../firebase-config.js";
import { 
  collection, 
  doc, 
  getDoc,
  getDocs,
  query,
  where,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// URL parameters
const urlParams = new URLSearchParams(window.location.search);
const madrasaId = urlParams.get("madrasaId");

// State caching
let madrasaDetails = null;
let students = [];
let classes = [];
let selectedStudent = null;
let selectedStudentLogs = [];
let leaderboardActiveTab = "daily";

// Chart.js instances
let chartGrades = null;
let chartGrowth = null;
let chartPerformance = null;
let chartAttendance = null;
let chartJuzProgress = null;
let chartMonthlyVolume = null;

const RING_CIRCUMFERENCE = 377; // 2 * PI * 60

document.addEventListener("DOMContentLoaded", async () => {
  if (!madrasaId) {
    showGatewayError();
    return;
  }

  await loadPortalData();
  setupSearchSystem();
  setupPrintTriggers();
  switchLeaderboardTab("daily");
});

function showGatewayError() {
  document.getElementById("parent-search-panel").classList.add("d-none");
  document.getElementById("parent-profile-panel").classList.add("d-none");
  document.getElementById("parent-error-panel").classList.remove("d-none");
}

async function loadPortalData() {
  try {
    if (isOfflineMode) {
      // Offline Simulation Data Fetch
      const mockMMap = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
      madrasaDetails = mockMMap[madrasaId];
      if (!madrasaDetails) {
        throw new Error("Madrasa profile not found locally.");
      }

      // Load classes
      const mockClasses = JSON.parse(localStorage.getItem(`mock_classes_${madrasaId}`)) || {};
      classes = Object.values(mockClasses);

      // Load students
      const mockStudents = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
      students = Object.values(mockStudents);

      // Ensure rankings and mock scores are set
      students.forEach(s => {
        s.score = s.score || ((s.currentPage || 1) * 10 + (s.achievements || []).length * 50);
        s.dailyScore = s.dailyScore || (Math.round(s.score * 0.1) + Math.floor(Math.random() * 20));
        s.weeklyScore = s.weeklyScore || (Math.round(s.score * 0.4) + Math.floor(Math.random() * 50));
        s.monthlyScore = s.monthlyScore || (Math.round(s.score * 0.8) + Math.floor(Math.random() * 100));
        s.currentRank = s.currentRank || (Math.floor(Math.random() * 8) + 1);
        s.previousRank = s.previousRank || (s.currentRank + (Math.random() > 0.5 ? 1 : -1));
      });

    } else {
      // Live Firebase Data Fetch
      const mDoc = await getDoc(doc(db, "madrasas", madrasaId));
      if (!mDoc.exists()) {
        throw new Error("Madrasa profile not found in cloud database.");
      }
      madrasaDetails = mDoc.data();

      // Classes
      const cSnapshot = await getDocs(collection(db, "madrasas", madrasaId, "classes"));
      classes = cSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Students - limited to 20 to conform to security rules
      const sSnapshot = await getDocs(query(collection(db, "madrasas", madrasaId, "students"), limit(20)));
      students = sSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Setup default mock rank fields for sorting if none exists on firestore
      students.forEach(s => {
        s.score = s.score || ((s.currentPage || 1) * 10);
        s.dailyScore = s.dailyScore || Math.round(s.score * 0.15);
        s.weeklyScore = s.weeklyScore || Math.round(s.score * 0.45);
        s.monthlyScore = s.monthlyScore || Math.round(s.score * 0.85);
        s.currentRank = s.currentRank || 1;
        s.previousRank = s.previousRank || 2;
      });
    }

    // Set portal header titles
    document.getElementById("portalBrandingTitle").textContent = madrasaDetails.name;
    document.getElementById("portalBrandingSubtitle").textContent = `Parent Access Portal — Location: ${madrasaDetails.location}`;

  } catch (error) {
    console.error(error);
    showGatewayError();
  }
}

// ==========================================
// SEARCH ENGINE: NAME OR ADMISSION NUMBER
// ==========================================
async function searchStudentsInFirestore(queryText) {
  const val = queryText.toLowerCase().trim();
  if (!val) return [];

  if (isOfflineMode) {
    const mockStudents = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    const studentsList = Object.values(mockStudents);
    return studentsList.filter(s => 
      s.name.toLowerCase().includes(val) || 
      s.admissionNumber.toLowerCase().includes(val)
    );
  } else {
    // Construct real-time prefix search queries
    const studentsCol = collection(db, "madrasas", madrasaId, "students");
    
    // We execute queries to cover name (Title Case, lower case, upper case) and admission number.
    const titleCaseVal = queryText.charAt(0).toUpperCase() + queryText.slice(1);
    const upperVal = queryText.toUpperCase();
    
    const queries = [];
    
    // Query 1: Name prefix (Title Case, e.g., "Ah" -> "Ahmed")
    queries.push(query(studentsCol, where("name", ">=", titleCaseVal), where("name", "<=", titleCaseVal + "\uf8ff"), limit(20)));
    
    // Query 2: Name prefix (original input case)
    if (titleCaseVal !== queryText) {
      queries.push(query(studentsCol, where("name", ">=", queryText), where("name", "<=", queryText + "\uf8ff"), limit(20)));
    }
    
    // Query 3: Name prefix (uppercase, e.g., "AHMED")
    if (upperVal !== titleCaseVal && upperVal !== queryText) {
      queries.push(query(studentsCol, where("name", ">=", upperVal), where("name", "<=", upperVal + "\uf8ff"), limit(20)));
    }

    // Query 4: Admission Number prefix
    queries.push(query(studentsCol, where("admissionNumber", ">=", queryText), where("admissionNumber", "<=", queryText + "\uf8ff"), limit(20)));
    
    // Execute queries in parallel
    const snapshots = await Promise.all(queries.map(q => getDocs(q)));
    
    // Merge unique results
    const resultsMap = new Map();
    snapshots.forEach(snapshot => {
      snapshot.docs.forEach(doc => {
        resultsMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
    });
    
    // Filter results locally to support partial match and case-insensitivity
    const allMerged = Array.from(resultsMap.values());
    return allMerged.filter(s => 
      s.name.toLowerCase().includes(val) || 
      s.admissionNumber.toLowerCase().includes(val)
    );
  }
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
  } else {
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
}

function setupSearchSystem() {
  const searchInput = document.getElementById("parentSearchInput");
  const resultsSection = document.getElementById("searchResultsSection");
  const resultsContainer = document.getElementById("searchResultsContainer");
  const leaderboardSection = document.getElementById("leaderboardSection");
  const searchMessage = document.getElementById("searchMessage");

  let searchTimeout = null;

  searchInput.addEventListener("input", () => {
    const val = searchInput.value.trim();
    searchMessage.classList.add("d-none");

    if (!val) {
      // Restore default leaderboard view
      resultsSection.classList.add("d-none");
      leaderboardSection.classList.remove("d-none");
      if (searchTimeout) clearTimeout(searchTimeout);
      return;
    }

    // Show loading spinner
    resultsContainer.innerHTML = `
      <div class="col-12 text-center text-muted py-5">
        <div class="spinner-border text-success spinner-border-sm mb-2" role="status"></div>
        <p class="small mb-0">Searching students...</p>
      </div>
    `;
    leaderboardSection.classList.add("d-none");
    resultsSection.classList.remove("d-none");

    if (searchTimeout) clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
      try {
        const matches = await searchStudentsInFirestore(val);

        // Merge matches into global students array so view profile can access them
        matches.forEach(m => {
          if (!students.find(s => s.id === m.id)) {
            students.push(m);
          }
        });

        renderSearchResults(matches);
      } catch (error) {
        console.error("Search system error:", error);
        resultsContainer.innerHTML = `
          <div class="col-12 text-center text-muted py-4">
            <i class="bi bi-exclamation-circle fs-2 text-danger opacity-25 d-block mb-2"></i>
            <span class="small text-danger">Search query failed. Please check network connection.</span>
          </div>
        `;
      }
    }, 250);
  });
}

// Expose click handler to inline onclicks
window.openProfileDirectly = async function(studentId) {
  const matched = students.find(s => s.id === studentId);
  if (!matched) return;

  selectedStudent = matched;
  
  // Load progress logs
  try {
    selectedStudentLogs = await getStudentReports(madrasaId, studentId);
    loadStudentProfileView();
  } catch (e) {
    console.error("Error loading profile logs:", e);
  }
};

// ==========================================
// LEADERBOARD MODULE
// ==========================================
window.switchLeaderboardTab = function(tabId) {
  leaderboardActiveTab = tabId;
  
  // Highlight tab
  document.querySelectorAll("#leaderboardTabs button").forEach(btn => {
    btn.classList.remove("active", "text-success");
  });
  const activeBtn = document.getElementById(`btn-ld-${tabId}`);
  if (activeBtn) activeBtn.classList.add("active", "text-success");

  renderLeaderboardList(tabId);
};

function renderLeaderboardList(tabId) {
  const container = document.getElementById("leaderboardList");
  container.innerHTML = "";

  // Sort local students
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
// PROFILE MODULE RENDERING
// ==========================================
function loadStudentProfileView() {
  const s = selectedStudent;
  const logs = selectedStudentLogs;

  // Set top profile cards
  document.getElementById("p-childName").textContent = s.name;
  const className = classes.find(c => c.id === s.classId)?.name || "Unassigned";
  document.getElementById("p-childMeta").textContent = `Adm: ${s.admissionNumber} | Class: ${className}`;
  document.getElementById("p-childParentName").textContent = s.parentName || "—";
  document.getElementById("p-childJoiningDate").textContent = s.joiningDate || "—";
  document.getElementById("p-childMadrasa").textContent = madrasaDetails.name;
  document.getElementById("p-childPhoto").src = s.photoUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(s.name)}&backgroundColor=10b981`;

  // Calculated Metrics
  const totalLogs = logs.length;
  const presentLogs = logs.filter(l => l.attendance === "present" || l.attendance === "leave").length;
  const attPct = totalLogs > 0 ? Math.round((presentLogs / totalLogs) * 100) : 0;
  const completionPct = Math.min(Math.round(((s.currentPage || 1) / 604) * 100), 100);
  
  const currentRank = s.currentRank || 3;
  const previousRank = s.previousRank || 4;
  const rankChange = previousRank - currentRank;

  document.getElementById("p-childAttendancePct").textContent = attPct + "%";
  document.getElementById("p-childCompletionPct").textContent = completionPct + "%";
  document.getElementById("p-childRank").textContent = `#${currentRank}`;
  document.getElementById("p-childBadgesCount").textContent = (s.achievements || []).length;

  // Standings update
  document.getElementById("p-rankString").textContent = `Rank #${currentRank}`;
  const rChangeBadge = document.getElementById("p-rankChangeBadge");
  if (rankChange > 0) {
    rChangeBadge.className = "badge bg-success-subtle text-success border border-success-subtle";
    rChangeBadge.textContent = `↑ ${rankChange} Positions`;
  } else if (rankChange < 0) {
    rChangeBadge.className = "badge bg-danger-subtle text-danger border border-danger-subtle";
    rChangeBadge.textContent = `↓ ${Math.abs(rankChange)} Positions`;
  } else {
    rChangeBadge.className = "badge bg-secondary-subtle text-secondary border border-secondary-subtle";
    rChangeBadge.textContent = "— No Change";
  }

  // Populate Today's Progress Box
  renderTodayProgressBox(logs);

  // Current Position Status
  document.getElementById("posJuz").textContent = s.currentJuz || 1;
  document.getElementById("posSurah").textContent = s.currentSurah || "Al-Baqarah";
  document.getElementById("posPage").textContent = s.currentPage || 1;
  document.getElementById("posPagesTotal").textContent = s.currentPage || 1;

  // Radial Completion Meter
  animateCompletionRing(completionPct, s.currentPage || 1);

  // History lists
  renderHistoryTable("full");

  // Chart layouts
  renderAnalyticsCharts(logs);

  // Timelines
  renderTimelineAchievements(s.achievements || []);

  // Set filter event
  const hFilter = document.getElementById("historyFilterSelect");
  hFilter.value = "full";
  hFilter.onchange = () => renderHistoryTable(hFilter.value);

  // Panel Transitions
  document.getElementById("parent-search-panel").classList.add("d-none");
  document.getElementById("parent-profile-panel").classList.remove("d-none");

  // Back trigger
  document.getElementById("closeProfileBtn").onclick = () => {
    document.getElementById("parent-profile-panel").classList.add("d-none");
    document.getElementById("parent-search-panel").classList.remove("d-none");
    
    // Reset search query
    document.getElementById("parentSearchInput").value = "";
    document.getElementById("searchResultsSection").classList.add("d-none");
    document.getElementById("leaderboardSection").classList.remove("d-none");
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

  // Attendance states
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

  // Sabak
  if (latest.newLesson) {
    sabakText.textContent = `${latest.newLesson.surah} (Ayah ${latest.newLesson.fromAyah}-${latest.newLesson.toAyah}) Pg: ${latest.newLesson.pageNumber}`;
    sabakRemarks.textContent = latest.newLesson.remarks || "No feedback logged.";
    sabakGrade.className = `grade-pill grade-${latest.newLesson.grade.toLowerCase()}`;
    sabakGrade.textContent = latest.newLesson.grade;
  } else {
    sabakText.textContent = "No new lesson logged today.";
    sabakRemarks.textContent = "";
    sabakGrade.className = "d-none";
  }

  // Sabqi
  if (latest.previousLesson) {
    sabqiText.textContent = `${latest.previousLesson.surah} (Ayah ${latest.previousLesson.fromAyah}-${latest.previousLesson.toAyah})`;
    sabqiRemarks.textContent = latest.previousLesson.remarks || "No feedback logged.";
    sabqiGrade.className = `grade-pill grade-${latest.previousLesson.grade.toLowerCase()}`;
    sabqiGrade.textContent = latest.previousLesson.grade;
  } else {
    sabqiText.textContent = "No previous lesson log today.";
    sabqiRemarks.textContent = "";
    sabqiGrade.className = "d-none";
  }

  // Dawrah
  if (latest.dawrah) {
    dawrahText.textContent = `Juz ${latest.dawrah.juzNumber} (${latest.dawrah.surah || 'All'} ${latest.dawrah.fromAyah || ''}-${latest.dawrah.toAyah || ''})`;
    dawrahRemarks.textContent = latest.dawrah.remarks || "No feedback logged.";
    dawrahGrade.className = `grade-pill grade-${latest.dawrah.grade.toLowerCase()}`;
    dawrahGrade.textContent = latest.dawrah.grade;
  } else {
    dawrahText.textContent = "No revision log today.";
    dawrahRemarks.textContent = "";
    dawrahGrade.className = "d-none";
  }

  // Trackers
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
  const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
  
  ring.style.strokeDashoffset = offset;
  document.getElementById("p-completionRingPct").textContent = pct + "%";
  document.getElementById("p-completionRingRatio").textContent = `${currentPage} of 604 pages`;
}

// ==========================================
// DRAW THE 6 REQUIRED CHARTS
// ==========================================
function renderAnalyticsCharts(logs) {
  // Clear charts context
  if (chartGrades) chartGrades.destroy();
  if (chartGrowth) chartGrowth.destroy();
  if (chartPerformance) chartPerformance.destroy();
  if (chartAttendance) chartAttendance.destroy();
  if (chartJuzProgress) chartJuzProgress.destroy();
  if (chartMonthlyVolume) chartMonthlyVolume.destroy();

  const chronological = [...logs].reverse();
  const recentLogs = logs.slice(0, 10).reverse();

  // 1. Grade Distribution (Doughnut)
  let ex = 0, gd = 0, av = 0, wk = 0;
  logs.forEach(l => {
    if (l.newLesson?.grade) {
      const g = l.newLesson.grade.toLowerCase();
      if (g === "excellent") ex++;
      else if (g === "good") gd++;
      else if (g === "average") av++;
      else if (g === "weak") wk++;
    }
  });

  chartGrades = new Chart(document.getElementById("c-gradeDistribution").getContext("2d"), {
    type: 'doughnut',
    data: {
      labels: ['Excellent', 'Good', 'Average', 'Weak'],
      datasets: [{
        data: [ex, gd, av, wk],
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
    }
  });

  // 2. Memorization Growth (Area Line Chart)
  const growthLabels = [];
  const growthData = [];
  chronological.forEach(l => {
    if (l.newLesson?.pageNumber) {
      growthLabels.push(l.date.substring(5)); // MM-DD
      growthData.push(l.newLesson.pageNumber);
    }
  });

  chartGrowth = new Chart(document.getElementById("c-memorizationGrowth").getContext("2d"), {
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

  // 3. Performance Trend (Rating Line Chart)
  const performanceLabels = [];
  const performanceData = [];
  recentLogs.forEach(l => {
    if (l.newLesson?.grade) {
      performanceLabels.push(l.date.substring(5));
      const g = l.newLesson.grade.toLowerCase();
      let r = 2; // Average
      if (g === "excellent") r = 4;
      else if (g === "good") r = 3;
      else if (g === "weak") r = 1;
      performanceData.push(r);
    }
  });

  chartPerformance = new Chart(document.getElementById("c-performanceTrend").getContext("2d"), {
    type: 'line',
    data: {
      labels: performanceLabels.length > 0 ? performanceLabels : ['No logs'],
      datasets: [{
        data: performanceData.length > 0 ? performanceData : [2],
        borderColor: '#10b981',
        pointBackgroundColor: '#059669',
        borderWidth: 2,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: 1, max: 4,
          ticks: {
            stepSize: 1,
            callback: value => ['Weak', 'Average', 'Good', 'Excellent'][value - 1]
          },
          grid: { color: 'rgba(0,0,0,0.02)' }
        },
        x: { grid: { display: false } }
      }
    }
  });

  // 4. Attendance Trend (Area Line Chart)
  const attLabels = recentLogs.map(l => l.date.substring(5));
  const attData = recentLogs.map(l => {
    if (l.attendance === "present") return 1;
    if (l.attendance === "leave") return 0.5;
    return 0;
  });

  chartAttendance = new Chart(document.getElementById("c-attendanceTrend").getContext("2d"), {
    type: 'line',
    data: {
      labels: attLabels.length > 0 ? attLabels : ['No logs'],
      datasets: [{
        data: attData.length > 0 ? attData : [0],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        fill: true,
        tension: 0.1,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: 0, max: 1,
          ticks: {
            stepSize: 0.5,
            callback: value => value === 1 ? 'Present' : (value === 0.5 ? 'Leave' : 'Absent')
          },
          grid: { color: 'rgba(0,0,0,0.02)' }
        },
        x: { grid: { display: false } }
      }
    }
  });

  // 5. Juz Completion Status (Horizontal Bar)
  const juzKeys = ['Juz 1', 'Juz 2', 'Juz 3', 'Juz 4', 'Juz 5', 'Juz 6', 'Juz 7', 'Juz 8', 'Juz 9', 'Juz 10'];
  const curJuz = selectedStudent.currentJuz || 1;
  const juzCompletionValues = juzKeys.map((j, i) => {
    const idx = i + 1;
    if (idx < curJuz) return 100;
    if (idx === curJuz) {
      const pageOffset = (selectedStudent.currentPage || 1) % 20;
      return Math.round((pageOffset / 20) * 100);
    }
    return 0;
  });

  chartJuzProgress = new Chart(document.getElementById("c-juzProgress").getContext("2d"), {
    type: 'bar',
    data: {
      labels: juzKeys,
      datasets: [{
        data: juzCompletionValues,
        backgroundColor: 'rgba(16, 185, 129, 0.75)',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.02)' } },
        y: { grid: { display: false } }
      }
    }
  });

  // 6. Monthly Progress Volume
  const monthlyLogsCount = {};
  logs.forEach(l => {
    const month = new Date(l.date).toLocaleString('default', { month: 'short' });
    monthlyLogsCount[month] = (monthlyLogsCount[month] || 0) + 1;
  });

  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthData = monthLabels.map(m => monthlyLogsCount[m] || 0);

  chartMonthlyVolume = new Chart(document.getElementById("c-monthlyVolume").getContext("2d"), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [{
        data: monthData,
        backgroundColor: '#3b82f6',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.02)' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// ==========================================
// TIMELINE & HISTORY LOGS
// ==========================================
function renderTimelineAchievements(badges) {
  const container = document.getElementById("p-timelineList");
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
// PDF PRINT COORD
// ==========================================
window.printSection = function(type) {
  const s = selectedStudent;
  const logs = selectedStudentLogs;
  const className = classes.find(c => c.id === s.classId)?.name || "Unassigned";

  if (logs.length === 0) {
    alert("No records logged to download.");
    return;
  }

  const latest = logs[0];

  // Populate Daily sheet
  document.getElementById("print-daily-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-daily-madrasa-loc").textContent = madrasaDetails.location;
  document.getElementById("print-daily-date").textContent = latest.date;
  document.getElementById("print-daily-name").textContent = s.name;
  document.getElementById("print-daily-adm").textContent = s.admissionNumber;
  document.getElementById("print-daily-class").textContent = className;
  document.getElementById("print-daily-pos").textContent = `Juz ${s.currentJuz || 1} | Surah ${s.currentSurah || 'Al-Baqarah'} | Pg ${s.currentPage || 1}`;

  document.getElementById("print-daily-sabak-det").textContent = latest.newLesson ? `${latest.newLesson.surah} (${latest.newLesson.fromAyah}-${latest.newLesson.toAyah}) Pg: ${latest.newLesson.pageNumber}` : "No new lesson logged.";
  document.getElementById("print-daily-sabak-grd").textContent = latest.newLesson?.grade || "—";
  document.getElementById("print-daily-sabak-rem").textContent = latest.newLesson?.remarks || "—";

  document.getElementById("print-daily-sabqi-det").textContent = latest.previousLesson ? `${latest.previousLesson.surah} (${latest.previousLesson.fromAyah}-${latest.previousLesson.toAyah})` : "No previous lesson log.";
  document.getElementById("print-daily-sabqi-grd").textContent = latest.previousLesson?.grade || "—";
  document.getElementById("print-daily-sabqi-rem").textContent = latest.previousLesson?.remarks || "—";

  document.getElementById("print-daily-dawrah-det").textContent = latest.dawrah ? `Juz ${latest.dawrah.juzNumber} (${latest.dawrah.surah || ''} ${latest.dawrah.fromAyah || ''}-${latest.dawrah.toAyah || ''})` : "No dawrah log.";
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

  // Populate Weekly sheet
  document.getElementById("print-weekly-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-weekly-name").textContent = s.name;
  document.getElementById("print-weekly-adm").textContent = s.admissionNumber;
  document.getElementById("print-weekly-pos").textContent = `Juz ${s.currentJuz || 1} | Page ${s.currentPage || 1}`;

  const weeklyTbody = document.getElementById("print-weekly-table-body");
  weeklyTbody.innerHTML = "";
  logs.slice(0, 15).forEach(log => {
    const sabak = log.newLesson ? `${log.newLesson.surah} (${log.newLesson.fromAyah}-${log.newLesson.toAyah})` : "—";
    const sabqi = log.previousLesson ? `${log.previousLesson.surah} (${log.previousLesson.fromAyah}-${log.previousLesson.toAyah})` : "—";
    weeklyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${log.attendance.toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${sabqi}</td>
        <td>${log.newLesson?.remarks || log.previousLesson?.remarks || '—'}</td>
      </tr>
    `;
  });

  // Populate Monthly sheet
  document.getElementById("print-monthly-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-monthly-name").textContent = s.name;
  document.getElementById("print-monthly-adm").textContent = s.admissionNumber;
  document.getElementById("print-monthly-pos").textContent = `Juz ${s.currentJuz || 1}`;

  const monthlyTbody = document.getElementById("print-monthly-table-body");
  monthlyTbody.innerHTML = "";
  logs.slice(0, 30).forEach(log => {
    const sabak = log.newLesson ? `${log.newLesson.surah} (${log.newLesson.fromAyah}-${log.newLesson.toAyah})` : "—";
    const sabqi = log.previousLesson ? `${log.previousLesson.surah} (${log.previousLesson.fromAyah}-${log.previousLesson.toAyah})` : "—";
    const dawrah = log.dawrah ? `Juz ${log.dawrah.juzNumber}` : "—";
    monthlyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${log.attendance.toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${sabqi}</td>
        <td>${dawrah}</td>
      </tr>
    `;
  });

  // Populate Yearly sheet
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
    const sabak = log.newLesson ? `${log.newLesson.surah} (Ayah ${log.newLesson.fromAyah}-${log.newLesson.toAyah}) Pg: ${log.newLesson.pageNumber}` : "—";
    yearlyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${log.attendance.toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${log.newLesson?.remarks || '—'}</td>
      </tr>
    `;
  });

  // Populate History ledger sheet
  document.getElementById("print-history-madrasa").textContent = madrasaDetails.name;
  document.getElementById("print-history-name").textContent = s.name;
  document.getElementById("print-history-adm").textContent = s.admissionNumber;
  document.getElementById("print-history-class").textContent = className;

  const historyTbody = document.getElementById("print-history-table-body");
  historyTbody.innerHTML = "";
  logs.forEach(log => {
    const sabak = log.newLesson ? `${log.newLesson.surah} (Ayah ${log.newLesson.fromAyah}-${log.newLesson.toAyah})` : "—";
    const sabqi = log.previousLesson ? `${log.previousLesson.surah} (Ayah ${log.previousLesson.fromAyah}-${log.previousLesson.toAyah})` : "—";
    const dawrah = log.dawrah ? `Juz ${log.dawrah.juzNumber}` : "—";
    historyTbody.innerHTML += `
      <tr>
        <td>${log.date}</td>
        <td>${log.attendance.toUpperCase()}</td>
        <td>${sabak}</td>
        <td>${sabqi}</td>
        <td>${dawrah}</td>
        <td>${log.newLesson?.remarks || log.previousLesson?.remarks || '—'}</td>
      </tr>
    `;
  });

  // Print
  const targetClass = `print-${type}-sheet`;
  document.body.classList.add(targetClass);
  window.print();
  
  // Clean up
  setTimeout(() => {
    document.body.classList.remove(targetClass);
  }, 1000);
};

function setupPrintTriggers() {
  window.onafterprint = () => {
    document.body.className = document.body.className.replace(/\bprint-\S+-sheet\b/g, '');
  };
}
