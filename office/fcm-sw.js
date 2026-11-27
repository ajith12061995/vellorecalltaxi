// Office (owner) alerts by push (Firebase Cloud Messaging): ride waiting with no driver, no driver ready, drivers
// switched OFF by the server. Shown even when the Office is closed; a tap opens the Office. Registered only after the owner allows it.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyDdO6xnD1hmakweVjJw52p3Wj1wP-jMB9g", authDomain: "vellore-taxi23.firebaseapp.com", projectId: "vellore-taxi23",
  storageBucket: "vellore-taxi23.firebasestorage.app", messagingSenderId: "764188040315", appId: "1:764188040315:web:54bf2a9b3c806b71a696de"
});
firebase.messaging(); // the webpush notification in the message is shown by the browser
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.includes('/office/')); return w ? w.focus() : clients.openWindow('./');
  }));
});
