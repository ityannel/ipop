import { initializeApp, getApps } from 'firebase/app';
import { 
  initializeAuth, 
  getAuth, 
  getReactNativePersistence, 
  browserLocalPersistence, 
  GoogleAuthProvider 
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyDXsyhPMGPDQ-lahJy-0vQvq10WKOSR468",
  authDomain: "i-tya-dictionary.firebaseapp.com",
  projectId: "i-tya-dictionary",
  storageBucket: "i-tya-dictionary.firebasestorage.app",
  messagingSenderId: "432805758863",
  appId: "1:432805758863:web:b05d542e7362b25383adfa",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// すでに初期化済みの場合は getAuth で取得（二重初期化エラーを防ぐ）
let auth;
try {
  const persistence = Platform.OS === 'web' 
    ? browserLocalPersistence 
    : getReactNativePersistence(AsyncStorage);
    
  auth = initializeAuth(app, {
    persistence: persistence,
  });
} catch (e) {
  auth = getAuth(app);
}

export { auth };
export const googleProvider = new GoogleAuthProvider();