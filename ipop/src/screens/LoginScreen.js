import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { auth } from '../services/firebase';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) return Alert.alert('エラー', 'メールとパスワードを入力してください');
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      Alert.alert('ログイン失敗', e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRegister() {
    if (!email || !password) return Alert.alert('エラー', 'メールとパスワードを入力してください');
    setIsLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      Alert.alert('登録失敗', e.message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ipop</Text>
      <Text style={styles.subtitle}>i-tya言語学習</Text>

      <TextInput
        style={styles.input}
        placeholder="メールアドレス"
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="パスワード"
        placeholderTextColor="#888"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={isLoading}>
        <Text style={styles.buttonText}>{isLoading ? '...' : 'ログイン'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.buttonSecondary} onPress={handleRegister} disabled={isLoading}>
        <Text style={styles.buttonSecondaryText}>新規登録</Text>
      </TouchableOpacity>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>または</Text>
        <View style={styles.dividerLine} />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', padding: 32 },
  title: { fontSize: 48, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#888', textAlign: 'center', marginBottom: 48 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 12,
    padding: 16, marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#333'
  },
  button: { backgroundColor: '#6c47ff', borderRadius: 12, padding: 16, marginTop: 8 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: 'bold' },
  buttonSecondary: { borderRadius: 12, padding: 16, marginTop: 8 },
  buttonSecondaryText: { color: '#6c47ff', textAlign: 'center', fontSize: 16 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#333' },
  dividerText: { color: '#555', marginHorizontal: 12 },
  googleButton: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  googleButtonText: { color: '#000', textAlign: 'center', fontSize: 16, fontWeight: 'bold' },
});