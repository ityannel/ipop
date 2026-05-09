import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/services/firebase';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import StudyScreen from './src/screens/StudyScreen';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // 現在の画面を管理するステートを追加したぞ（初期値は'home'だ）
  const [currentScreen, setCurrentScreen] = useState('home');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#6c47ff" size="large" />
      </View>
    );
  }

  // ログインしていない場合はログイン画面を表示
  if (!user) {
    return <LoginScreen />;
  }

  // ログイン済みの場合、currentScreen の値に応じて画面を切り替える
  if (currentScreen === 'home') {
    return (
      <HomeScreen 
        idToken={user.uid} // FirebaseがQuotaオーバーでダミー運用中だが一応渡しとく
        onStartStudy={() => setCurrentScreen('study')} // HomeScreenのボタンを押したらstudy画面に切り替える
      />
    );
  }

  if (currentScreen === 'study') {
    return (
      <StudyScreen 
        // もしStudyScreen側で「ホームに戻る」ボタンを作った時のために、戻る用の関数も渡しておく
        onFinish={() => setCurrentScreen('home')} 
      />
    );
  }
}