import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { fetchDueWords, fetchQuestion, submitReview } from '../services/api';

function diffChars(input, answer) {
  const maxLen = Math.max(input.length, answer.length);
  const result = [];
  for (let i = 0; i < maxLen; i++) {
    if (i >= input.length) {
      result.push({ char: answer[i], status: 'missing' });
    } else if (i >= answer.length) {
      result.push({ char: input[i], status: 'wrong' });
    } else if (input[i] === answer[i]) {
      result.push({ char: input[i], status: 'correct' });
    } else {
      result.push({ char: input[i], status: 'wrong' });
    }
  }
  return result;
}

export default function StudyScreen() {
  const [dueWords, setDueWords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState('');
  const [userInput, setUserInput] = useState('');
  const [hintShown, setHintShown] = useState(false);
  const [wrongCount, setWrongCount] = useState(0);
  const [isCorrect, setIsCorrect] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const startTimeRef = useRef(null);
  const inputRef = useRef(null);
  const [isExtraMode, setIsExtraMode] = useState(false);

  useEffect(() => { loadDueWords(); }, []);

  async function loadDueWords(isExtra = false) {
    setIsLoading(true);
    setIsExtraMode(isExtra);
    try {
      const data = await fetchDueWords(isExtra);
      const all = [...(data.review || []), ...(data.new || [])];
      setDueWords(all);
      setCurrentIndex(0);
      if (all.length > 0) {
        await loadQuestion(all[0]);
      }
    } catch (e) {
      Alert.alert('エラー', e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadQuestion(word) {
    setIsLoading(true);
    setUserInput('');
    setHintShown(false);
    setWrongCount(0);
    setIsCorrect(null);
    setShowDiff(false);
    try {
      const data = await fetchQuestion(word.id);
      setQuestion(data);
      setAnswer(data.answer || '');
      startTimeRef.current = Date.now();
      setTimeout(() => inputRef.current?.focus(), 300);
    } catch (e) {
      Alert.alert('エラー', e.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleHint() {
    setHintShown(true);
  }

  async function handleSubmit() {
    if (!userInput.trim()) return;
    const correct = userInput.trim().toLowerCase() === answer.toLowerCase();

    if (!correct) {
      setWrongCount(w => w + 1);
      setIsCorrect(false);
      setShowDiff(true);
      return;
    }

    setIsCorrect(true);
    setShowDiff(false);
    setIsSubmitting(true);
    const answerTimeMs = Date.now() - startTimeRef.current;

    try {
      await submitReview({
        wordId: dueWords[currentIndex].id,
        isCorrect: true,
        wrongCount,
        hintUsed: hintShown,
        answerTimeMs,
        syllableCount: question.syllableCount || 2,
      });
    } catch (e) {
      console.warn('review error:', e.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleNext() {
    const nextIndex = currentIndex + 1;

    if (isCorrect !== true) {
      const answerTimeMs = Date.now() - startTimeRef.current;
      try {
        await submitReview({
          wordId: dueWords[currentIndex].id,
          isCorrect: false,
          wrongCount: wrongCount + 1,
          hintUsed: hintShown,
          answerTimeMs,
          syllableCount: question?.syllableCount || 2,
        });
      } catch (e) {
        console.warn('review error:', e.message);
      }
    }

    if (nextIndex >= dueWords.length) {
      Alert.alert('🎉 完了！', '学習が終わりました！', [
        { text: 'OK', onPress: () => loadDueWords(false) },
        { text: '追加で学ぶ', onPress: () => loadDueWords(true) },
      ]);
      return;
    }

    setCurrentIndex(nextIndex);
    await loadQuestion(dueWords[nextIndex]);
  }

  function renderDiff() {
    if (!showDiff || !answer) return null;
    const diff = diffChars(userInput.trim().toLowerCase(), answer.toLowerCase());
    const remaining = Math.max(0, answer.length - userInput.trim().length);

    return (
      <View style={styles.diffContainer}>
        <View style={styles.diffChars}>
          {diff.map((d, i) => (
            <View key={i} style={styles.diffCharWrapper}>
              <Text style={[
                styles.diffChar,
                d.status === 'correct' && styles.diffCorrect,
                d.status === 'wrong'   && styles.diffWrong,
                d.status === 'missing' && styles.diffMissing,
              ]}>
                {d.status === 'missing' ? '_' : d.char}
              </Text>
              <View style={[
                styles.diffUnderline,
                d.status === 'correct' && styles.underlineCorrect,
                d.status === 'wrong'   && styles.underlineWrong,
                d.status === 'missing' && styles.underlineMissing,
              ]} />
            </View>
          ))}
        </View>
        {remaining > 0 && (
          <Text style={styles.remainingText}>あと {remaining} 文字</Text>
        )}
      </View>
    );
  }

  function renderQuestion() {
    if (!question) return null;
    return (
      <View style={styles.questionArea}>
        {question.example && (
          <View style={styles.exampleCard}>
            <Text style={styles.sectionLabel}>例文</Text>
            <Text style={styles.exampleText}>{question.example}</Text>
            {question.example_reading && (
              <Text style={styles.annotationText}>{question.example_reading}</Text>
            )}
            {question.example_translation && (
              <Text style={styles.annotationText}>{question.example_translation}</Text>
            )}
          </View>
        )}
        {question.blank && (
          <View style={styles.blankCard}>
            <Text style={styles.sectionLabel}>穴埋め</Text>
            <Text style={styles.blankText}>{question.blank}</Text>
          </View>
        )}
        {isCorrect === true && question.explanation && (
          <View style={styles.explainCard}>
            <Text style={styles.sectionLabel}>解説</Text>
            <Text style={styles.explainText}>{question.explanation}</Text>
          </View>
        )}
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  const currentWord = dueWords[currentIndex];

  if (dueWords.length === 0) {
  if (isExtraMode) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>✨</Text>
        <Text style={styles.doneText}>追加できる単語がありません</Text>
        <TouchableOpacity
          style={[styles.button, { flex: 0, paddingHorizontal: 24 }]}
          onPress={() => { setIsExtraMode(false); loadDueWords(false); }}
        >
          <Text style={styles.buttonText}>戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>✅</Text>
      <Text style={styles.doneText}>今日の学習は完了しています</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <TouchableOpacity
          style={[styles.button, { flex: 0, paddingHorizontal: 24, backgroundColor: '#333' }]}
          onPress={() => loadDueWords(false)}
        >
          <Text style={styles.buttonText}>更新</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { flex: 0, paddingHorizontal: 24 }]}
          onPress={() => loadDueWords(true)}
        >
          <Text style={styles.buttonText}>追加で学ぶ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${((currentIndex + 1) / dueWords.length) * 100}%` }]} />
      </View>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{currentIndex + 1} / {dueWords.length}</Text>
        <Text style={styles.progressBadge}>{currentWord.isNew ? '🆕 新規' : '🔁 復習'}</Text>
      </View>

      {renderQuestion()}

      {hintShown && answer && (
        <View style={styles.hintCard}>
          <Text style={styles.hintLabel}>💡 答え</Text>
          <Text style={styles.hintAnswer}>{answer}</Text>
          <Text style={styles.hintLength}>（{answer.length}文字）</Text>
        </View>
      )}

      {renderDiff()}

      {isCorrect !== true && (
        <>
          <View style={styles.inputWrapper}>
            <TextInput
              ref={inputRef}
              style={[styles.input, isCorrect === false && styles.inputError]}
              placeholder="ipop語を入力..."
              placeholderTextColor="#555"
              value={userInput}
              onChangeText={(t) => { setUserInput(t); setShowDiff(false); }}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleSubmit}
            />
            {answer.length > 0 && (
              <Text style={[styles.charCount, userInput.length > 0 && styles.charCountActive]}>
                {userInput.length > 0 ? `${userInput.length} / ${answer.length}` : `${answer.length}文字`}
              </Text>
            )}
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.hintButton, hintShown && styles.hintButtonUsed]}
              onPress={handleHint}
              disabled={hintShown}
            >
              <Text style={[styles.hintButtonText, hintShown && styles.hintButtonTextUsed]}>
                {hintShown ? '💡 表示中' : '💡 ヒント'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={handleSubmit}>
              <Text style={styles.buttonText}>答える</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {isCorrect === true && (
        <View style={styles.correctCard}>
          <Text style={styles.correctText}>✅ 正解！</Text>
          <TouchableOpacity style={styles.nextButton} onPress={handleNext} disabled={isSubmitting}>
            <Text style={styles.buttonText}>{isSubmitting ? '...' : '次へ →'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {isCorrect !== true && (
        <TouchableOpacity style={styles.skipButton} onPress={handleNext}>
          <Text style={styles.skipText}>スキップ</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingTop: 56, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', fontSize: 16 },
  emoji: { fontSize: 48, marginBottom: 16 },
  doneText: { color: '#fff', fontSize: 18, marginBottom: 24 },

  progressBarBg: { height: 4, backgroundColor: '#1a1a1a', borderRadius: 2, marginBottom: 8 },
  progressBarFill: { height: 4, backgroundColor: '#6c47ff', borderRadius: 2 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  progressText: { color: '#555', fontSize: 12 },
  progressBadge: { color: '#444', fontSize: 11 },

  questionArea: { marginBottom: 16 },
  exampleCard: { backgroundColor: '#111', borderRadius: 16, padding: 20, marginBottom: 10 },
  sectionLabel: { color: '#444', fontSize: 10, letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
  exampleText: { color: '#fff', fontSize: 22, lineHeight: 36, fontWeight: '500' },
  annotationText: { color: '#3a3a3a', fontSize: 13, lineHeight: 22 },
  blankCard: {
    backgroundColor: '#0d0d1a', borderRadius: 16, padding: 20, marginBottom: 10,
    borderWidth: 1, borderColor: '#6c47ff33',
  },
  blankText: { color: '#ccc', fontSize: 20, lineHeight: 32 },
  explainCard: { backgroundColor: '#0a1a0a', borderRadius: 16, padding: 20, marginBottom: 10 },
  explainText: { color: '#aaa', fontSize: 15, lineHeight: 24 },

  hintCard: {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  hintLabel: { color: '#6c47ff', fontSize: 12 },
  hintAnswer: { color: '#9b7cff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  hintLength: { color: '#444', fontSize: 12, marginLeft: 'auto' },

  diffContainer: { marginBottom: 12, padding: 16, backgroundColor: '#1a0a0a', borderRadius: 12 },
  diffChars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  diffCharWrapper: { alignItems: 'center' },
  diffChar: { fontSize: 20, fontWeight: 'bold', paddingHorizontal: 2 },
  diffCorrect: { color: '#4caf50' },
  diffWrong: { color: '#ff4444' },
  diffMissing: { color: '#555' },
  diffUnderline: { height: 2, width: '100%', marginTop: 2 },
  underlineCorrect: { backgroundColor: '#4caf50' },
  underlineWrong: { backgroundColor: '#ff4444' },
  underlineMissing: { backgroundColor: '#333' },
  remainingText: { color: '#ff8c00', fontSize: 13 },

  inputWrapper: { position: 'relative', marginBottom: 10 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 12,
    paddingVertical: 16, paddingLeft: 16, paddingRight: 72,
    fontSize: 20, borderWidth: 1, borderColor: '#333',
  },
  inputError: { borderColor: '#ff4444' },
  charCount: {
    position: 'absolute', right: 14, top: 0, bottom: 0,
    textAlignVertical: 'center', color: '#444', fontSize: 12, lineHeight: 56,
  },
  charCountActive: { color: '#6c47ff' },

  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  button: { flex: 1, backgroundColor: '#6c47ff', borderRadius: 12, padding: 16 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: 'bold' },
  hintButton: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#333',
  },
  hintButtonUsed: { borderColor: '#6c47ff33', backgroundColor: '#0f0f1e' },
  hintButtonText: { color: '#888', textAlign: 'center', fontSize: 16 },
  hintButtonTextUsed: { color: '#6c47ff' },

  correctCard: { borderRadius: 16, padding: 20, marginBottom: 12, alignItems: 'center', gap: 16 },
  correctText: { color: '#4caf50', fontSize: 28, fontWeight: 'bold' },
  nextButton: { width: '100%', backgroundColor: '#6c47ff', borderRadius: 12, padding: 16 },

  skipButton: { padding: 16, alignItems: 'center' },
  skipText: { color: '#444', fontSize: 14 },
});