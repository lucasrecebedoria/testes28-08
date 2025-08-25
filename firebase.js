// Firebase init (v10 modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged,
         createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, getDocs, collection, query, where, serverTimestamp, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAxQliXm59BRg9zsVpK5qthB0nowqU0GEg",
  authDomain: "lancamentomanual-6cac4.firebaseapp.com",
  projectId: "lancamentomanual-6cac4",
  storageBucket: "lancamentomanual-6cac4.firebasestorage.app",
  messagingSenderId: "710102934933",
  appId: "1:710102934933:web:a5dc954d01d40518a5c29c",
  measurementId: "G-MLLXPXR7EC"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
setPersistence(auth, browserLocalPersistence);

export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword,
  doc, setDoc, getDoc, updateDoc, addDoc, getDocs, collection, query, where, serverTimestamp, orderBy
};
