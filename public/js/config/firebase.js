import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Firebase *web* config for project mdo3d-leads. Public by design (shipped to every browser);
// access is enforced by Firestore security rules and the API key's HTTP-referrer restriction.
const firebaseConfig = {
  apiKey: "AIzaSyBiiwVaxvzcGb7Vgpk2m_H-KMm0ZB8nJIU",
  authDomain: "mdo3d-leads.firebaseapp.com",
  projectId: "mdo3d-leads",
  storageBucket: "mdo3d-leads.firebasestorage.app",
  messagingSenderId: "862220604451",
  appId: "1:862220604451:web:cd2eb7605238e19ba10d96"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
