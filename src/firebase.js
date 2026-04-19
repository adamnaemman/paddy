import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD2UlFbLtkZQu1HmY7drVY8jv7_gSTClx4",
  authDomain: "gen-lang-client-0188479107.firebaseapp.com",
  projectId: "gen-lang-client-0188479107",
  storageBucket: "gen-lang-client-0188479107.firebasestorage.app",
  messagingSenderId: "807599021815",
  appId: "1:807599021815:web:869f73299affc798babdf2"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export default app;
