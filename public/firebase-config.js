// Firebase configuration and central initialization using Modular SDK v10+
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getMessaging, isSupported as isMessagingSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { getAnalytics, isSupported as isAnalyticsSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// Central Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyDZ-SHxp47wtjX049vi0NeAu5L71Z-fiAk",
  authDomain: "hifz-progress-portal.firebaseapp.com",
  projectId: "hifz-progress-portal",
  storageBucket: "hifz-progress-portal.firebasestorage.app",
  messagingSenderId: "685613828135",
  appId: "1:685613828135:web:6d9346167374057579e602",
  measurementId: "G-G5YCLGNT2B"
};

let app, auth, db, storage, messaging, analytics;
let isOfflineMode = false;

try {
  // Check if API key is still placeholder or if we want to force offline simulation for testing
  if (firebaseConfig.apiKey.includes("Placeholder") || window.location.hostname === "localhost" && localStorage.getItem("force_offline") === "true") {
    console.warn("Using Offline Simulation mode because placeholder Firebase credentials are set.");
    isOfflineMode = true;
  } else {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    
    isMessagingSupported().then((supported) => {
      if (supported) {
        messaging = getMessaging(app);
      }
    });

    isAnalyticsSupported().then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    });
  }
} catch (error) {
  console.error("Firebase initialization failed. Falling back to Offline Simulation.", error);
  isOfflineMode = true;
}

export { app, auth, db, storage, messaging, analytics, isOfflineMode };
