import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, GoogleAuthProvider } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyDXsyhPMGPDQ-lahJy-0vQvq10WKOSR468",
  authDomain: "i-tya-dictionary.firebaseapp.com",
  projectId: "i-tya-dictionary",
  storageBucket: "i-tya-dictionary.firebasestorage.app",
  messagingSenderId: "432805758863",
  appId: "1:432805758863:web:b05d542e7362b25383adfa",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const googleProvider = new GoogleAuthProvider();