import { auth, db, isOfflineMode } from "../firebase-config.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
  doc, 
  setDoc, 
  getDoc, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Check authentication state and redirect appropriately
export function checkAuthState(requiredRole = "madrasa_admin", onStatusChecked) {
  if (isOfflineMode) {
    const user = JSON.parse(localStorage.getItem("mock_current_user"));
    if (!user) {
      redirectToLogin();
      return;
    }
    
    // Check if it's the super admin
    if (user.role === "super_admin") {
      if (requiredRole !== "super_admin") {
        window.location.href = "super-admin.html";
      } else if (onStatusChecked) {
        onStatusChecked(user, { status: "active" });
      }
      return;
    }

    // Madrasa Admin checks
    const madrasas = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
    const madrasa = madrasas[user.madrasaId] || { name: "Mock Madrasa", location: "Local", status: "pending" };
    
    if (requiredRole === "super_admin" && user.role !== "super_admin") {
      window.location.href = "login.html";
      return;
    }

    handleStatusRouting(user, madrasa, onStatusChecked);
  } else {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        redirectToLogin();
        return;
      }

      try {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (!userDoc.exists()) {
          console.error("User document not found");
          await firebaseSignOut(auth);
          redirectToLogin();
          return;
        }

        const userData = userDoc.data();
        
        if (userData.role === "super_admin") {
          if (requiredRole !== "super_admin") {
            window.location.href = "super-admin.html";
          } else if (onStatusChecked) {
            onStatusChecked(firebaseUser, { status: "active" });
          }
          return;
        }

        if (requiredRole === "super_admin" && userData.role !== "super_admin") {
          window.location.href = "login.html";
          return;
        }

        // Fetch Madrasa status
        const madrasaDocRef = doc(db, "madrasas", userData.madrasaId);
        const madrasaDoc = await getDoc(madrasaDocRef);
        const madrasaData = madrasaDoc.exists() ? madrasaDoc.data() : { status: "pending" };

        handleStatusRouting(userData, madrasaData, onStatusChecked);
      } catch (error) {
        console.error("Error checking auth status:", error);
        redirectToLogin();
      }
    });
  }
}

function handleStatusRouting(user, madrasa, callback) {
  const currentPath = window.location.pathname;
  
  if (madrasa.status === "pending" && !currentPath.includes("payment.html")) {
    window.location.href = "payment.html";
  } else if (madrasa.status === "active" && (currentPath.includes("payment.html") || currentPath.includes("login.html") || currentPath.includes("signup.html") || currentPath.includes("index.html"))) {
    window.location.href = "dashboard.html";
  } else if ((madrasa.status === "suspended" || madrasa.status === "expired") && !currentPath.includes("payment.html")) {
    window.location.href = "payment.html?status=" + madrasa.status;
  } else {
    if (callback) callback(user, madrasa);
  }
}

function redirectToLogin() {
  const currentPath = window.location.pathname;
  if (!currentPath.includes("login.html") && !currentPath.includes("signup.html") && !currentPath.includes("parent-portal.html")) {
    window.location.href = "login.html";
  }
}

// User registration
export async function registerMadrasa(fields) {
  const { email, password, madrasaName, location, usthadName, mobile } = fields;

  if (isOfflineMode) {
    const mockUid = "madrasa_" + Date.now();
    
    // Check if user already exists
    const mockUsers = JSON.parse(localStorage.getItem("mock_users")) || {};
    if (mockUsers[email]) {
      throw new Error("Email already registered.");
    }
    
    // Add to mock users
    mockUsers[email] = {
      uid: mockUid,
      email: email,
      role: "madrasa_admin",
      madrasaId: mockUid
    };
    localStorage.setItem("mock_users", JSON.stringify(mockUsers));

    // Add to mock madrasas
    const mockMadrasas = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
    mockMadrasas[mockUid] = {
      name: madrasaName,
      location: location,
      usthadName: usthadName,
      mobile: mobile,
      email: email,
      status: "pending", // Payment required initially
      createdAt: new Date().toISOString(),
      subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };
    localStorage.setItem("mock_madrasas", JSON.stringify(mockMadrasas));

    // Login user
    localStorage.setItem("mock_current_user", JSON.stringify(mockUsers[email]));
    return mockUsers[email];
  } else {
    // 1. Create auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // 2. Create user profile in 'users'
    await setDoc(doc(db, "users", uid), {
      email: email,
      role: "madrasa_admin",
      madrasaId: uid,
      createdAt: serverTimestamp()
    });

    // 3. Create madrasa document
    await setDoc(doc(db, "madrasas", uid), {
      name: madrasaName,
      location: location,
      usthadName: usthadName,
      mobile: mobile,
      email: email,
      status: "pending",
      createdAt: serverTimestamp(),
      subscriptionExpiry: null
    });

    return userCredential.user;
  }
}

// User login
export async function loginUser(email, password) {
  // Pre-seed super admin account if we are in offline mode
  if (isOfflineMode) {
    const mockUsers = JSON.parse(localStorage.getItem("mock_users")) || {};
    
    // Autoseed local Super Admin & Madrasa Admin if empty
    if (Object.keys(mockUsers).length === 0) {
      mockUsers["admin@hifzportal.com"] = {
        uid: "super_admin_123",
        email: "admin@hifzportal.com",
        role: "super_admin",
        madrasaId: "super"
      };
      
      // Seed a mock active madrasa admin too
      mockUsers["usthad@madrasa.com"] = {
        uid: "madrasa_active_123",
        email: "usthad@madrasa.com",
        role: "madrasa_admin",
        madrasaId: "madrasa_active_123"
      };
      
      const mockMadrasas = JSON.parse(localStorage.getItem("mock_madrasas")) || {};
      mockMadrasas["madrasa_active_123"] = {
        name: "Al-Huda Quran Academy",
        location: "Kochi, Kerala",
        usthadName: "Usthad Omar",
        mobile: "9207846064",
        email: "usthad@madrasa.com",
        status: "active",
        createdAt: new Date().toISOString(),
        subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
      
      localStorage.setItem("mock_users", JSON.stringify(mockUsers));
      localStorage.setItem("mock_madrasas", JSON.stringify(mockMadrasas));
    }

    const matchedUser = mockUsers[email];
    if (!matchedUser) {
      throw new Error("User not found or invalid credentials.");
    }
    
    // Simulating password validation
    localStorage.setItem("mock_current_user", JSON.stringify(matchedUser));
    return matchedUser;
  } else {
    // Check if it's the target admin account to seed it as super_admin
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;
    
    // Seed Super Admin if the email is admin@hifzportal.com
    if (email === "admin@hifzportal.com") {
      await setDoc(doc(db, "users", uid), {
        email: email,
        role: "super_admin",
        madrasaId: "super",
        createdAt: serverTimestamp()
      }, { merge: true });
    }
    
    return userCredential.user;
  }
}

// User logout
export async function logoutUser() {
  if (isOfflineMode) {
    localStorage.removeItem("mock_current_user");
    window.location.href = "login.html";
  } else {
    await firebaseSignOut(auth);
    window.location.href = "login.html";
  }
}
