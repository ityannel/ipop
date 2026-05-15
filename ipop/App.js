import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './src/services/firebase';
import { useFonts } from 'expo-font';

import { StatusBar } from 'expo-status-bar';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import StudyScreen from './src/screens/StudyScreen';

import Chara from './src/chara.svg';
import IpopLogo from './src/ipop.svg';
import { COLORS, FONT } from './src/constants/theme';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [fontsLoaded, fontError] = useFonts({
    'Fredoka': require('./assets/fonts/Fredoka_Expanded-SemiBold.ttf'),
    'LINESeedJP_400Regular': require('./assets/fonts/LINESeedJP-Regular.ttf'),
    'LINESeedJP_700Bold': require('./assets/fonts/LINESeedJP-Bold.ttf'),
    'LINESeedJP_800ExtraBold': require('./assets/fonts/LINESeedJP-ExtraBold.ttf'),
    'DotGothic16': require('./assets/fonts/DotGothic16-Regular.ttf'),
  });

  const [currentScreen, setCurrentScreen] = useState('home');
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authLoading || (!fontsLoaded && !fontError)) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(spinValue, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
          Animated.timing(spinValue, {
            toValue: 0,
            duration: 800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: false,
          }),
        ])
      ).start();
    }
  }, [authLoading, fontsLoaded, fontError]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['-15deg', '15deg'],
  });

  if (authLoading || (!fontsLoaded && !fontError)) {
    return (
      <View style={styles.loadingRoot}>
        <StatusBar style="dark" backgroundColor={COLORS.green} />
        {fontsLoaded && <IpopLogo width={200} height={80} />}
        <Animated.View style={{ transform: [{ translateY: -90 }, { rotate: spin }, { translateY: 90 }] }}>
          <Chara width={180} height={180} />
        </Animated.View>
      </View>
    );
  }

  let screen;
  if (!user) {
    screen = <LoginScreen />;
  } else if (currentScreen === 'home') {
    screen = <HomeScreen onStartStudy={() => setCurrentScreen('study')} />;
  } else if (currentScreen === 'study') {
    screen = <StudyScreen onFinish={() => setCurrentScreen('home')} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={COLORS.green} />
      {screen}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    backgroundColor: '#4A1C53',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    color: COLORS.green,
    fontSize: 72,
    ...FONT.enVar,
    marginBottom: 40,
  },
  errorContainer: {
    position: 'absolute',
    bottom: 50,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  errorText: {
    color: '#ffaaaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: 'LINESeedJP_400Regular',
  },
  retryBtn: {
    backgroundColor: COLORS.green,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryText: {
    color: COLORS.bg,
    fontSize: 14,
    fontWeight: 'bold',
  },
});