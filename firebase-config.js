// 1. Firebase console -> Project settings -> Your apps -> Web app -> copy the config here.
// 2. While apiKey is empty the app runs in DEMO MODE (no server, fake driver) so you can try the screens.

export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

export const BUSINESS = {
  name: "Vellore Taxi",          // shown in header
  supportPhone: "",              // your call-centre number, e.g. "9XXXXXXXXX"
  upiId: "",                     // your UPI ID for fare payment, e.g. "name@okbank"
  upiName: "Vellore Taxi",       // name shown in the UPI app
  city: "Vellore",
  center: { lat: 12.9165, lng: 79.1325 }, // map centre when GPS is unavailable
};
