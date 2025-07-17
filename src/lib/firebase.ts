
// Import the functions you need from the SDKs you need
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// These values will be filled in by Firebase Studio
const firebaseConfig = {
  apiKey: "### GCloud API Key ###",
  authDomain: "### Auth Domain ###",
  projectId: "### Project ID ###",
  storageBucket: "### Storage Bucket ###",
  messagingSenderId: "### Messaging Sender ID ###",
  appId: "### App ID ###"
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

export { app, db };
