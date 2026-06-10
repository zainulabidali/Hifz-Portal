// Service worker for Firebase Cloud Messaging background notifications
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
  projectId: "hifz-progress-portal",
  apiKey: "AIzaSyFakeKeyPlaceholder123456789",
  authDomain: "hifz-progress-portal.firebaseapp.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
});

try {
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Background message received: ', payload);
    
    const notificationTitle = payload.notification?.title || "Hifz Progress Portal";
    const notificationOptions = {
      body: payload.notification?.body || "New update available.",
      icon: payload.notification?.icon || "/css/icons/icon-192.png",
      badge: "/css/icons/badge.png"
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (e) {
  console.warn("FCM background messaging not initialized in service worker:", e);
}
