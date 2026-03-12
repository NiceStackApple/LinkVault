import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, getDoc, writeBatch, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB8Uy-Xd7IWy-3EpcS6py4xc9ahURnshRg",
  authDomain: "linkvaultpro.firebaseapp.com",
  projectId: "linkvaultpro",
  storageBucket: "linkvaultpro.firebasestorage.app",
  messagingSenderId: "35343516155",
  appId: "1:35343516155:web:067dd8b0c6e69c209a0b5e",
  measurementId: "G-H90LMNQRXR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
