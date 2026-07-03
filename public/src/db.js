import { db, storage, isOfflineMode } from "../firebase-config.js";
import { 
  collection, 
  doc, 
  addDoc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  collectionGroup, 
  limit, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Helper for generating IDs in offline mode
const generateId = () => Math.random().toString(36).substring(2, 11);

// Database Retry Logic with Exponential Backoff
async function withRetry(operation, maxRetries = 3, initialDelay = 800) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      const backoff = initialDelay * Math.pow(2, attempt - 1);
      console.warn(`Database operation failed. Retrying in ${backoff}ms (Attempt ${attempt}/${maxRetries}). Error:`, error);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}

// ==========================================
// MADRASA VERIFICATION
// ==========================================
export async function verifyMadrasaExists(madrasaId) {
  if (isOfflineMode) {
    const mockMadrasas = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
    return !!mockMadrasas[madrasaId];
  } else {
    return withRetry(async () => {
      const docRef = doc(db, "madrasas", madrasaId);
      const docSnap = await getDoc(docRef);
      return docSnap.exists();
    });
  }
}

// ==========================================
// CLASS MANAGEMENT
// ==========================================
export async function getClasses(madrasaId) {
  if (isOfflineMode) {
    const classes = JSON.parse(localStorage.getItem(`mock_classes_${madrasaId}`)) || {};
    // Seed default classes if none exist to make the app interactive immediately
    if (Object.keys(classes).length === 0) {
      const defaultClasses = {
        "class_1": { id: "class_1", name: "Hifz A (Senior)", createdAt: new Date().toISOString() },
        "class_2": { id: "class_2", name: "Hifz B (Junior)", createdAt: new Date().toISOString() },
        "class_3": { id: "class_3", name: "Nazira (Beginners)", createdAt: new Date().toISOString() }
      };
      localStorage.setItem(`mock_classes_${madrasaId}`, JSON.stringify(defaultClasses));
      return Object.values(defaultClasses);
    }
    return Object.values(classes);
  } else {
    return withRetry(async () => {
      const colRef = collection(db, "madrasas", madrasaId, "classes");
      const snapshot = await getDocs(colRef);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    });
  }
}

export async function addClass(madrasaId, name) {
  if (isOfflineMode) {
    const classes = JSON.parse(localStorage.getItem(`mock_classes_${madrasaId}`)) || {};
    const id = "class_" + generateId();
    classes[id] = { id, name, createdAt: new Date().toISOString() };
    localStorage.setItem(`mock_classes_${madrasaId}`, JSON.stringify(classes));
    return classes[id];
  } else {
    return withRetry(async () => {
      const colRef = collection(db, "madrasas", madrasaId, "classes");
      const docRef = await addDoc(colRef, {
        name,
        createdAt: serverTimestamp()
      });
      return { id: docRef.id, name };
    });
  }
}

export async function deleteClass(madrasaId, classId) {
  if (isOfflineMode) {
    const classes = JSON.parse(localStorage.getItem(`mock_classes_${madrasaId}`)) || {};
    delete classes[classId];
    localStorage.setItem(`mock_classes_${madrasaId}`, JSON.stringify(classes));
  } else {
    return withRetry(async () => {
      const docRef = doc(db, "madrasas", madrasaId, "classes", classId);
      await deleteDoc(docRef);
    });
  }
}

// ==========================================
// STUDENT MANAGEMENT
// ==========================================
export async function getStudents(madrasaId) {
  if (isOfflineMode) {
    const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    
    // Seed default students if empty
    if (Object.keys(students).length === 0) {
      const defaultStudents = {
        "student_1": {
          id: "student_1",
          name: "Zaid Yusuf",
          admissionNumber: "1001",
          photoUrl: "https://images.unsplash.com/photo-1544717305-2782549b5136?w=150",
          parentName: "Yusuf Khan",
          parentPhone: "9876543210",
          parentPhoneLast4: "3210",
          classId: "class_1",
          joiningDate: "2025-01-10",
          currentJuz: 12,
          currentSurah: "Yusuf",
          currentPage: 235,
          achievements: ["Perfect Attendance", "Juz Completion"]
        },
        "student_2": {
          id: "student_2",
          name: "Fatima Omar",
          admissionNumber: "1002",
          photoUrl: "https://images.unsplash.com/photo-1503919545889-aef636e10ad4?w=150",
          parentName: "Omar Abdullah",
          parentPhone: "9944332211",
          parentPhoneLast4: "2211",
          classId: "class_1",
          joiningDate: "2025-02-15",
          currentJuz: 5,
          currentSurah: "An-Nisa",
          currentPage: 90,
          achievements: ["Continuous Sabak"]
        },
        "student_3": {
          id: "student_3",
          name: "Bilal Ahmed",
          admissionNumber: "1003",
          photoUrl: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150",
          parentName: "Ahmed Ali",
          parentPhone: "9207846064",
          parentPhoneLast4: "6064",
          classId: "class_2",
          joiningDate: "2025-03-01",
          currentJuz: 1,
          currentSurah: "Al-Baqarah",
          currentPage: 15,
          achievements: ["Excellent Performance"]
        }
      };
      
      // Also seed some initial reports for parents charts demo
      const defaultReports = {
        "student_1": generateMockReports(),
        "student_2": generateMockReports(),
        "student_3": generateMockReports()
      };
      
      localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(defaultStudents));
      localStorage.setItem(`mock_reports_${madrasaId}`, JSON.stringify(defaultReports));
      return Object.values(defaultStudents);
    }
    return Object.values(students);
  } else {
    return withRetry(async () => {
      const colRef = collection(db, "madrasas", madrasaId, "students");
      const snapshot = await getDocs(colRef);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    });
  }
}

export async function addStudent(madrasaId, studentData) {
  const parentPhone = studentData.parentPhone;
  const last4 = parentPhone.substring(parentPhone.length - 4);
  const fullData = { ...studentData, parentPhoneLast4: last4, achievements: studentData.achievements || [] };

  if (isOfflineMode) {
    const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    const id = "student_" + generateId();
    students[id] = { id, ...fullData };
    localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(students));
    return students[id];
  } else {
    return withRetry(async () => {
      const colRef = collection(db, "madrasas", madrasaId, "students");
      const docRef = await addDoc(colRef, fullData);
      return { id: docRef.id, ...fullData };
    });
  }
}

export async function updateStudent(madrasaId, studentId, studentData) {
  const parentPhone = studentData.parentPhone;
  const last4 = parentPhone ? parentPhone.substring(parentPhone.length - 4) : undefined;
  const dataToUpdate = { ...studentData };
  if (last4) dataToUpdate.parentPhoneLast4 = last4;

  if (isOfflineMode) {
    const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    if (students[studentId]) {
      students[studentId] = { ...students[studentId], ...dataToUpdate };
      localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(students));
      return students[studentId];
    }
  } else {
    return withRetry(async () => {
      const docRef = doc(db, "madrasas", madrasaId, "students", studentId);
      await updateDoc(docRef, dataToUpdate);
    });
  }
}

export async function deleteStudent(madrasaId, studentId) {
  if (isOfflineMode) {
    const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    delete students[studentId];
    localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(students));
  } else {
    return withRetry(async () => {
      const docRef = doc(db, "madrasas", madrasaId, "students", studentId);
      await deleteDoc(docRef);
    });
  }
}

// Upload Student Photo (Support base64 local fallback)
export async function uploadStudentPhoto(madrasaId, studentId, file) {
  if (isOfflineMode) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64Url = reader.result;
        // Update mock student URL
        const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
        if (students[studentId]) {
          students[studentId].photoUrl = base64Url;
          localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(students));
        }
        resolve(base64Url);
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  } else {
    return withRetry(async () => {
      const storageRef = ref(storage, `madrasas/${madrasaId}/students/${studentId}/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(snapshot.ref);
      // Update student doc
      await updateStudent(madrasaId, studentId, { photoUrl: downloadUrl });
      return downloadUrl;
    });
  }
}

// ==========================================
// DAILY REPORTS & POSITION TRACKER
// ==========================================
// Centralized scoring logic helper for a single daily log
export function getReportScore(report) {
  if (!report) return 0;
  let score = 0;
  // 1 mark for attendance
  if (report.attendance === "present") {
    score += 1;
  }
  // 1 mark for Sabaq (new lesson) completed
  if (report.newLesson && report.newLesson.surah) {
    score += 1;
  }
  // 1 mark for Sabqi (previous lesson) completed
  if (report.previousLesson && report.previousLesson.surah) {
    score += 1;
  }
  // 1 mark for Dawrah (revision) completed
  if (report.dawrah && (report.dawrah.juzNumber || report.dawrah.surah)) {
    score += 1;
  }
  return score;
}

// Calculate scores for a list of daily logs
export function calculateStudentScoresFromReports(reports) {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localToday = new Date(today.getTime() - (offset * 60 * 1000));
  const todayStr = localToday.toISOString().split("T")[0];

  const oneDayMs = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  let dailyScore = 0;
  let weeklyScore = 0;
  let monthlyScore = 0;
  let totalScore = 0;

  reports.forEach(r => {
    const rScore = getReportScore(r);
    totalScore += rScore;

    // Daily score (matches today's date)
    if (r.date === todayStr) {
      dailyScore += rScore;
    }

    // Weekly score (last 7 days)
    const diffMs = nowMs - new Date(r.date).getTime();
    if (diffMs >= 0 && diffMs <= 7 * oneDayMs) {
      weeklyScore += rScore;
    }

    // Monthly score (last 30 days)
    if (diffMs >= 0 && diffMs <= 30 * oneDayMs) {
      monthlyScore += rScore;
    }
  });

  return {
    score: totalScore,
    dailyScore,
    weeklyScore,
    monthlyScore
  };
}

// Update student scores in storage and db
export async function updateStudentScores(madrasaId, studentId) {
  const reports = await getStudentReports(madrasaId, studentId, true);
  const scoreData = calculateStudentScoresFromReports(reports);

  if (isOfflineMode) {
    const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    if (students[studentId]) {
      students[studentId] = { ...students[studentId], ...scoreData };
      localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(students));
    }
  } else {
    const studentRef = doc(db, "madrasas", madrasaId, "students", studentId);
    await updateDoc(studentRef, scoreData);
  }
  return scoreData;
}

export async function saveDailyReport(madrasaId, studentId, reportData) {
  const dateStr = reportData.date; // YYYY-MM-DD
  
  // Update local reports cache for this student to keep it fresh
  const cacheKey = `cache_reports_${madrasaId}_${studentId}`;
  const cacheTimeKey = `cache_reports_time_${madrasaId}_${studentId}`;
  const cachedData = localStorage.getItem(cacheKey);
  if (cachedData) {
    try {
      let reports = JSON.parse(cachedData);
      // Remove any existing entry for the same date to avoid duplicates
      reports = reports.filter(r => r.date !== dateStr);
      reports.push({ id: dateStr, ...reportData });
      reports.sort((a, b) => b.date.localeCompare(a.date));
      localStorage.setItem(cacheKey, JSON.stringify(reports));
      localStorage.setItem(cacheTimeKey, Date.now().toString());
    } catch (e) {
      console.error("Failed to update student reports cache:", e);
    }
  }

  if (isOfflineMode) {
    const allReports = JSON.parse(localStorage.getItem(`mock_reports_${madrasaId}`)) || {};
    if (!allReports[studentId]) allReports[studentId] = {};
    allReports[studentId][dateStr] = reportData;
    localStorage.setItem(`mock_reports_${madrasaId}`, JSON.stringify(allReports));

    // Update Current Position Tracker if Present/Leave & values exist
    const students = JSON.parse(localStorage.getItem(`mock_students_${madrasaId}`)) || {};
    if (students[studentId] && reportData.attendance !== "absent") {
      if (reportData.newLesson && reportData.newLesson.pageNumber) {
        students[studentId].currentPage = parseInt(reportData.newLesson.pageNumber) || students[studentId].currentPage;
        students[studentId].currentSurah = reportData.newLesson.surah || students[studentId].currentSurah;
      }
      if (reportData.dawrah && reportData.dawrah.juzNumber) {
        students[studentId].currentJuz = parseInt(reportData.dawrah.juzNumber) || students[studentId].currentJuz;
      }
      localStorage.setItem(`mock_students_${madrasaId}`, JSON.stringify(students));
    }
    // Update student scores locally
    await updateStudentScores(madrasaId, studentId);
    return reportData;
  } else {
    return withRetry(async () => {
      // Write Report document with ID as YYYY-MM-DD to enforce single report per day
      const reportRef = doc(db, "madrasas", madrasaId, "students", studentId, "reports", dateStr);
      await setDoc(reportRef, reportData);

      // Update student current position in transaction/batch (or updateDoc)
      const updateData = {};
      if (reportData.attendance !== "absent") {
        if (reportData.newLesson && reportData.newLesson.pageNumber) {
          updateData.currentPage = parseInt(reportData.newLesson.pageNumber);
          updateData.currentSurah = reportData.newLesson.surah;
        }
        if (reportData.dawrah && reportData.dawrah.juzNumber) {
          updateData.currentJuz = parseInt(reportData.dawrah.juzNumber);
        }
      }
      
      // Calculate scores dynamically and write to student document
      const reports = await getStudentReports(madrasaId, studentId, true);
      const scores = calculateStudentScoresFromReports(reports);
      Object.assign(updateData, scores);

      const studentRef = doc(db, "madrasas", madrasaId, "students", studentId);
      await updateDoc(studentRef, updateData);
    });
  }
}

export async function getStudentReports(madrasaId, studentId, force = false) {
  if (isOfflineMode) {
    const allReports = JSON.parse(localStorage.getItem(`mock_reports_${madrasaId}`)) || {};
    const reportsMap = allReports[studentId] || {};
    return Object.values(reportsMap).sort((a, b) => b.date.localeCompare(a.date));
  } else {
    const cacheKey = `cache_reports_${madrasaId}_${studentId}`;
    const cacheTimeKey = `cache_reports_time_${madrasaId}_${studentId}`;
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);
    const now = Date.now();

    // If not forced and cache is less than 30 seconds old, use cache
    if (!force && cachedData && cachedTime && (now - parseInt(cachedTime) < 30000)) {
      console.log(`Using cached student reports for ${studentId}`);
      return JSON.parse(cachedData);
    }

    return withRetry(async () => {
      const colRef = collection(db, "madrasas", madrasaId, "students", studentId, "reports");
      const q = query(colRef, limit(50));
      const snapshot = await getDocs(q);
      const reports = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.date.localeCompare(a.date));
      
      localStorage.setItem(cacheKey, JSON.stringify(reports));
      localStorage.setItem(cacheTimeKey, now.toString());
      return reports;
    });
  }
}

// Fetch all entries saved for all students today
export async function getTodayReports(madrasaId, dateStr) {
  if (isOfflineMode) {
    const allReports = JSON.parse(localStorage.getItem(`mock_reports_${madrasaId}`)) || {};
    const todayReports = {};
    Object.keys(allReports).forEach(studentId => {
      if (allReports[studentId][dateStr]) {
        todayReports[studentId] = allReports[studentId][dateStr];
      }
    });
    return todayReports;
  } else {
    return withRetry(async () => {
      // Single Firestore query retrieving today's reports for ALL students across the collection group
      const reportsQuery = query(
        collectionGroup(db, "reports"),
        where("date", "==", dateStr)
      );
      const snapshot = await getDocs(reportsQuery);
      const todayReports = {};
      snapshot.docs.forEach(doc => {
        // Path format is: madrasas/{madrasaId}/students/{studentId}/reports/{dateStr}
        const pathParts = doc.ref.path.split("/");
        if (pathParts[1] === madrasaId) {
          const studentId = pathParts[3];
          todayReports[studentId] = doc.data();
        }
      });
      return todayReports;
    });
  }
}

// ==========================================
// PARENT PORTAL SEARCH & DETAILS
// ==========================================
export async function searchStudentForParent(admissionNumber, parentPhoneLast4) {
  if (isOfflineMode) {
    // Search across all mock madrasas in localStorage
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith("mock_students_")) {
        const madrasaId = key.replace("mock_students_", "");
        const students = JSON.parse(localStorage.getItem(key)) || {};
        const matched = Object.values(students).find(
          s => s.admissionNumber === admissionNumber && s.parentPhoneLast4 === parentPhoneLast4
        );
        if (matched) {
          // Fetch the madrasa name
          const mockMadrasas = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
          const madrasa = mockMadrasas[madrasaId] || { name: "Darul Quran Academy" };
          return { student: matched, madrasaId, madrasaName: madrasa.name };
        }
      }
    }
    throw new Error("No student found with the matching Admission Number and parent phone combination.");
  } else {
    return withRetry(async () => {
      // Use Firestore Collection Group query to search for the student globally
      const groupRef = collectionGroup(db, "students");
      const q = query(
        groupRef, 
        where("admissionNumber", "==", admissionNumber), 
        where("parentPhoneLast4", "==", parentPhoneLast4),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        throw new Error("No student found with the matching Admission Number and parent phone combination.");
      }
      
      const studentDoc = snapshot.docs[0];
      const studentData = studentDoc.data();
      
      // Extract madrasaId from student doc path: madrasas/{madrasaId}/students/{studentId}
      const pathParts = studentDoc.ref.path.split("/");
      const madrasaId = pathParts[1];
      
      // Fetch madrasa details
      const madrasaDoc = await getDoc(doc(db, "madrasas", madrasaId));
      const madrasaName = madrasaDoc.exists() ? madrasaDoc.data().name : "Hifz Madrasa";
      
      return {
        student: { id: studentDoc.id, ...studentData },
        madrasaId,
        madrasaName
      };
    });
  }
}

// ==========================================
// MOCK DATA GENERATOR (For charts demo)
// ==========================================
function generateMockReports() {
  const reports = {};
  const today = new Date();
  
  // Create 15 days of historical data for beautiful charts
  for (let i = 14; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    
    // Skip Fridays for attendance
    if (d.getDay() === 5) continue;
    
    const att = Math.random() > 0.1 ? "present" : (Math.random() > 0.5 ? "leave" : "absent");
    
    reports[dateStr] = {
      date: dateStr,
      attendance: att,
      previousLesson: att === "present" ? {
        surah: "Al-Kahf",
        fromAyah: 1 + (15 - i) * 5,
        toAyah: 5 + (15 - i) * 5,
        grade: ["Excellent", "Good", "Average"][Math.floor(Math.random() * 3)],
        remarks: "Completed memorization task"
      } : null,
      newLesson: att === "present" ? {
        surah: "Al-Kahf",
        fromAyah: 6 + (15 - i) * 5,
        toAyah: 10 + (15 - i) * 5,
        pageNumber: 293 + (15 - i),
        grade: ["Excellent", "Good", "Average", "Weak"][Math.floor(Math.random() * 4)],
        remarks: "Focused memorization work"
      } : null,
      dawrah: att === "present" ? {
        juzNumber: Math.floor((15 - i) / 3) + 1,
        surah: "Al-Baqarah",
        fromAyah: 1,
        toAyah: 100,
        grade: ["Excellent", "Good", "Average"][Math.floor(Math.random() * 3)],
        remarks: "Revision session"
      } : null,
      akhlaq: ["Excellent", "Good", "Average"][Math.floor(Math.random() * 3)],
      salah: {
        fajr: Math.random() > 0.2,
        dhuhr: Math.random() > 0.1,
        asr: Math.random() > 0.3,
        maghrib: Math.random() > 0.1,
        isha: Math.random() > 0.2
      }
    };
  }
  return reports;
}
