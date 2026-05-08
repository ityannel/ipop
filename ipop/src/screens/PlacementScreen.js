import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { fetchPlacement, fetchQuestion, submitPlacement } from '../services/api';

export default function PlacementScreen({ idToken, onComplete }) {
  const [words, setWords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [questions, setQuestions] = useState({}); // wordId → {question, answer, syllableCount}
  const [userInput, setUserInput] = useState('');
  const [isCorrect, setIsCorrect] = useState(null);
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const startTimeRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { loadPlacement(); }, []);

  async function loadPlacement() {
    setIsLoading(true);
    try {
      const data = await fetchPlacement();
      if (data.alreadyDone) {
        onComplete(data.level);
        return;
      }
      setWords(data.words);
      // 最初の問題を先読み
      await loadQuestion(data.words[0], data.words);
    } catch (e) {
      Alert.alert('エラー', e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadQuestion(word, allWords) {
    try {
      const data = await fetchQuestion(word.id);
      setQuestions(prev => ({
        ...prev,
        [word.id]: { question: data.question, answer: data.answer, syllableCount: data.syllableCount },
      }));
      startTimeRef.current = Date.now();
      setTimeout(() => inputRef.current?.focus(), 300);

      // 次の問題も先読み（UX向上）
      const nextWord = (allWords || words)[currentIndex + 1];
      if (nextWord && !questions[nextWord.id]) {
        fetchQuestion(nextWord.id).then(d => {
          setQuestions(prev => ({
            ...prev,
            [nextWord.id]: { question: d.question, answer: d.answer, syllableCount: d.syllableCount },
          }));
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('loadQuestion error:', e.message);
    }
  }

  function parseQuestion(text) {
    if (!text) return {};
    const exampleMatch = text.match(/【例文】\s*\n([\s\S]*?)(?=【|$)/);
    const blankMatch   = text.match(/【穴埋め】\s*\n([\s\S]*?)(?=【|$)/);
    return {
      example: exampleMatch ? exampleMatch[1].trim() : '',
      blank:   blankMatch   ? blankMatch[1].trim()   : '',
    };
  }

  async function handleSubmit() {
    if (!userInput.trim()) return;
    const qData = questions[currentWord.id];
    if (!qData) return;

    const correct = userInput.trim().toLowerCase() === qData.answer?.toLowerCase();
    const answerTimeMs = Date.now() - startTimeRef.current;

    setIsCorrect(correct);
    setResults(prev => [...prev, { wordId: currentWord.id, isCorrect: correct, answerTimeMs }]);

    setTimeout(() => handleNext(correct, answerTimeMs), 1200);
  }

  async function handleNext(correct, answerTimeMs) {
    const nextIndex = currentIndex + 1;

    if (nextIndex >= words.length) {
      await finishPlacement();
      return;
    }

    setCurrentIndex(nextIndex);
    setUserInput('');
    setIsCorrect(null);

    const nextWord = words[nextIndex];
    if (!questions[nextWord.id]) {
      await loadQuestion(nextWord, words);
    } else {
      startTimeRef.current = Date.now();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  async function finishPlacement() {
    setIsFinishing(true);
    try {
      const data = await submitPlacement(results); // ← submitPlacement に変更
      onComplete(data.level);
    } catch (e) {
      Alert.alert('エラー', e.message);
    } finally {
      setIsFinishing(false);
    }
  }

  if (isLoading || isFinishing) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingEmoji}>{isFinishing ? '🎯' : '⏳'}</Text>
        <Text style={styles.loadingText}>
          {isFinishing ? 'レベルを計算中...' : '読み込み中...'}
        </Text>
      </View>
    );
  }

  const currentWord = words[currentIndex];
  const qData = currentWord ? questions[currentWord.id] : null;
  const { example, blank } = qData ? parseQuestion(qData.question) : {};
  const progress = words.length > 0 ? (currentIndex + 1) / words.length : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>レベル確認</Text>
        <Text style={styles.headerSub}>あなたのレベルを確認します</Text>
      </View>

      {/* 進捗 */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>{currentIndex + 1} / {words.length}</Text>

      {/* 概念 */}
      {currentWord && (
        <View style={styles.conceptBadge}>
          <Text style={styles.conceptText}>{currentWord.concept_ja || currentWord.meaning}</Text>
        </View>
      )}

      {/* 例文 */}
      {example ? (
        <View style={styles.exampleCard}>
          <Text style={styles.sectionLabel}>例文</Text>
          <Text style={styles.exampleText}>{example}</Text>
        </View>
      ) : (
        <View style={styles.exampleCard}>
          <Text style={styles.loadingText}>問題を読み込み中...</Text>
        </View>
      )}

      {/* 穴埋め */}
      {blank && (
        <View style={styles.blankCard}>
          <Text style={styles.sectionLabel}>穴埋め</Text>
          <Text style={styles.blankText}>{blank}</Text>
        </View>
      )}

      {/* フィードバック */}
      {isCorrect !== null && (
        <View style={[styles.feedbackCard, isCorrect ? styles.feedbackCorrect : styles.feedbackWrong]}>
          <Text style={[styles.feedbackText, isCorrect ? styles.feedbackTextCorrect : styles.feedbackTextWrong]}>
            {isCorrect ? '✅ 正解！' : `❌ 正解: ${qData?.answer}`}
          </Text>
        </View>
      )}

      {/* 入力 */}
      {isCorrect === null && (
        <>
          <View style={styles.inputWrapper}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="ipop語を入力..."
              placeholderTextColor="#555"
              value={userInput}
              onChangeText={setUserInput}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleSubmit}
            />
            {qData?.answer && (
              <Text style={styles.charCountText}>{qData.answer.length}文字</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.button, !qData && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!qData}
          >
            <Text style={styles.buttonText}>答える</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipButton} onPress={() => handleNext(false, 30000)}>
            <Text style={styles.skipText}>わからない → スキップ</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingTop: 56, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingEmoji: { fontSize: 40 },
  loadingText: { color: '#888', fontSize: 15 },

  header: { marginBottom: 24 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  headerSub: { color: '#555', fontSize: 14 },

  progressBarBg: { height: 4, backgroundColor: '#1a1a1a', borderRadius: 2, marginBottom: 8 },
  progressBarFill: { height: 4, backgroundColor: '#6c47ff', borderRadius: 2 },
  progressText: { color: '#555', fontSize: 12, textAlign: 'right', marginBottom: 20 },

  conceptBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#1a1a2e',
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#6c47ff44',
  },
  conceptText: { color: '#9b7cff', fontSize: 14 },

  exampleCard: { backgroundColor: '#111', borderRadius: 16, padding: 20, marginBottom: 10 },
  sectionLabel: { color: '#444', fontSize: 10, letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
  exampleText: { color: '#fff', fontSize: 20, lineHeight: 34, fontWeight: '500' },

  blankCard: {
    backgroundColor: '#0d0d1a', borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: '#6c47ff33',
  },
  blankText: { color: '#ccc', fontSize: 18, lineHeight: 30 },

  feedbackCard: { borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
  feedbackCorrect: { backgroundColor: '#0b1f0c' },
  feedbackWrong: { backgroundColor: '#1f0b0b' },
  feedbackText: { fontSize: 18, fontWeight: 'bold' },
  feedbackTextCorrect: { color: '#4caf50' },
  feedbackTextWrong: { color: '#ff5555' },

  inputWrapper: { position: 'relative', marginBottom: 10 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 12,
    paddingVertical: 16, paddingLeft: 16, paddingRight: 70,
    fontSize: 20, borderWidth: 1, borderColor: '#333',
  },
  charCountText: {
    position: 'absolute', right: 14, top: 0, bottom: 0,
    textAlignVertical: 'center', color: '#444', fontSize: 12,
    lineHeight: 56,
  },

  button: { backgroundColor: '#6c47ff', borderRadius: 12, padding: 16, marginBottom: 10 },
  buttonDisabled: { backgroundColor: '#2a2a2a' },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: 'bold' },

  skipButton: { padding: 12, alignItems: 'center' },
  skipText: { color: '#444', fontSize: 13 },
});