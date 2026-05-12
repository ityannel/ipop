import { useState, useEffect } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/services/firebase';
import { useFonts } from 'expo-font';

import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import StudyScreen from './src/screens/StudyScreen';

import Chara from './src/chara.svg';
import { COLORS, FONT } from './src/constants/theme';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [fontsLoaded, fontError] = useFonts({
    'Fredoka': require('./assets/fonts/Fredoka_Expanded-SemiBold.ttf'),
    'LINESeedJP_400Regular': require('./assets/fonts/LINESeedJP-Regular.ttf'),
    'LINESeedJP_700Bold': require('./assets/fonts/LINESeedJP-Bold.ttf'),
    'LINESeedJP_800ExtraBold': require('./assets/fonts/LINESeedJP-ExtraBold.ttf'),
  });

  const [currentScreen, setCurrentScreen] = useState('home');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // 統一されたローディング表示
  if (authLoading || (!fontsLoaded && !fontError)) {
    return (
      <View style={styles.loadingRoot}>
        <StatusBar style="dark" backgroundColor={COLORS.green} translucent={false} />
        <Text style={styles.loadingLogo}>ipop</Text>
        <View style={styles.loadingChara}>
          <Chara width={160} height={160} />
        </View>
        <ActivityIndicator color={COLORS.green} size="small" style={{ marginTop: 40, opacity: 0.5 }} />
      </View>
    );
  }

  let screen;
  if (!user) {
    screen = <LoginScreen />;
  } else if (currentScreen === 'home') {
    screen = (
      <HomeScreen 
        onStartStudy={() => setCurrentScreen('study')}
      />
    );
  } else if (currentScreen === 'study') {
    screen = (
      <StudyScreen 
        onFinish={() => setCurrentScreen('home')} 
      />
    );
  }

  return (
    <>
      <StatusBar style="dark" backgroundColor={COLORS.green} translucent={false} />
      {screen}
    </>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    color: COLORS.green,
    fontSize: 72,
    ...FONT.enVar, // フォント読み込み前は標準、読み込み後はFredokaになる
    marginBottom: 20,
  },
  loadingChara: {
    transform: [{ scale: 1.1 }],
  }
});