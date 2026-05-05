import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyDLpYDxVtc6VtFhpz93i4xlAXkMT7Xkqq0",
    authDomain: "chatroom-109006229.firebaseapp.com",
    projectId: "chatroom-109006229",
    storageBucket: "chatroom-109006229.firebasestorage.app",
    messagingSenderId: "289124076544",
    appId: "1:289124076544:web:a0fdcc4760c13308f05ce5",
    measurementId: "G-33XHHSEMKK"
  };

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);