import { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { fetchDueWords, fetchQuestion, submitReview } from '../services/api';

// 文字ごとの差分を計算
function diffChars(input, answer) {
  const maxLen = Math.max(input.length, answer.length);
  const result = [];
  
  for (let i = 0; i < maxLen; i++) {
    if (i >= input.length) {
      result.push({ char: answer[i], status: 'missing' });
    } else if (i >= answer.length) {
      result.push({ char: input[i], status: 'wrong' }); // 入力が多すぎる場合
    } else if (input[i] === answer[i]) {
      result.push({ char: input[i], status: 'correct' });
    } else {
      result.push({ char: input[i], status: 'wrong' });
    }
  }
  return result;
}

function parseAnnotations(line) {
  if (!line) return [{ text: line, main: true }];

  if (/^(意訳|意味|※|＊|注)[:：]/.test(line.trim())) {
    return [{ text: line, main: false }];
  }

  const parts = [];
  const regex = /（[ァ-ヶー・\s]+）/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: line.slice(lastIndex, match.index), main: true });
    }
    parts.push({ text: match[0], main: false });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    parts.push({ text: line.slice(lastIndex), main: true });
  }
  return parts.length > 0 ? parts : [{ text: line, main: true }];
}

function AnnotatedText({ text, mainStyle, annotationStyle }) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <Text>
      {lines.map((line, li) => {
        const parts = parseAnnotations(line);
        const allAnnotation = parts.every(p => !p.main);
        return (
          <Text key={li}>
            {parts.map((p, pi) => (
              <Text key={pi} style={p.main ? mainStyle : annotationStyle}>{p.text}</Text>
            ))}
            {li < lines.length - 1 ? '\n' : ''}
          </Text>
        );
      })}
    </Text>
  );
}

export default function StudyScreen() {
  const [dueWords, setDueWords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion] = useState(null);
  const [answer, setAnswer] = useState('');
  const [userInput, setUserInput] = useState('');
  const [hintShown, setHintShown] = useState(false);  // ヒントは1段階：押すと答え表示
  const [wrongCount, setWrongCount] = useState(0);
  const [isCorrect, setIsCorrect] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const startTimeRef = useRef(null);
  const inputRef = useRef(null);

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

  // ヒントボタン：1回押すと答えをそのまま表示
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
        hintUsed: hintShown,      // boolean（サーバー側も対応済み）
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
        { text: 'OK', onPress: () => loadDueWords(false) }
      ]);
      return;
    }
    setCurrentIndex(nextIndex);
    await loadQuestion(dueWords[nextIndex]);
  }

  // 文字差分UI
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
            {/* カタカナ読みと意訳を直接表示する */}
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

  if (dueWords.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>✅</Text>
        <Text style={styles.doneText}>今日の学習は完了しています</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity style={[styles.button, { flex: 0, paddingHorizontal: 24, backgroundColor: '#333' }]} onPress={() => loadDueWords(false)}>
            <Text style={styles.buttonText}>更新</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { flex: 0, paddingHorizontal: 24 }]} onPress={() => loadDueWords(true)}>
            <Text style={styles.buttonText}>追加で学ぶ</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const currentWord = dueWords[currentIndex];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 進捗バー */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${((currentIndex + 1) / dueWords.length) * 100}%` }]} />
      </View>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>{currentIndex + 1} / {dueWords.length}</Text>
        <Text style={styles.progressBadge}>{currentWord.isNew ? '🆕 新規' : '🔁 復習'}</Text>
      </View>

      {/* 問題（単語カード削除済み） */}
      {renderQuestion()}

      {/* ヒント（1段階：押すと答えを表示） */}
      {hintShown && answer && (
        <View style={styles.hintCard}>
          <Text style={styles.hintLabel}>💡 答え</Text>
          <Text style={styles.hintAnswer}>{answer}</Text>
          <Text style={styles.hintLength}>（{answer.length}文字）</Text>
        </View>
      )}

      {/* 差分フィードバック */}
      {renderDiff()}

      {/* 入力エリア */}
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

      {/* 正解 */}
      {isCorrect === true && (
        <View style={styles.correctCard}>
          <Text style={styles.correctText}>✅ 正解！</Text>
          <TouchableOpacity style={styles.nextButton} onPress={handleNext} disabled={isSubmitting}>
            <Text style={styles.buttonText}>{isSubmitting ? '...' : '次へ →'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* スキップ */}
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

  // 進捗
  progressBarBg: { height: 4, backgroundColor: '#1a1a1a', borderRadius: 2, marginBottom: 8 },
  progressBarFill: { height: 4, backgroundColor: '#6c47ff', borderRadius: 2 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  progressText: { color: '#555', fontSize: 12 },
  progressBadge: { color: '#444', fontSize: 11 },

  // 問題エリア
  questionArea: { marginBottom: 16 },
  exampleCard: { backgroundColor: '#111', borderRadius: 16, padding: 20, marginBottom: 10 },
  sectionLabel: { color: '#444', fontSize: 10, letterSpacing: 1.5, marginBottom: 8, textTransform: 'uppercase' },
  exampleText: { color: '#fff', fontSize: 22, lineHeight: 36, fontWeight: '500' },
  annotationText: { color: '#3a3a3a', fontSize: 13, lineHeight: 22 },  // カタカナ振りや意訳は目立たせない
  blankCard: {
    backgroundColor: '#0d0d1a', borderRadius: 16, padding: 20, marginBottom: 10,
    borderWidth: 1, borderColor: '#6c47ff33',
  },
  blankText: { color: '#ccc', fontSize: 20, lineHeight: 32 },
  explainCard: { backgroundColor: '#0a1a0a', borderRadius: 16, padding: 20, marginBottom: 10 },
  explainText: { color: '#aaa', fontSize: 15, lineHeight: 24 },
  explainAnnotationText: { color: '#555', fontSize: 13, lineHeight: 20 },

  // ヒント（1段階：答えをそのまま表示）
  hintCard: {
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  hintLabel: { color: '#6c47ff', fontSize: 12 },
  hintAnswer: { color: '#9b7cff', fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  hintLength: { color: '#444', fontSize: 12, marginLeft: 'auto' },

  // 差分フィードバック
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

  // 入力
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

  // 正解
  correctCard: { borderRadius: 16, padding: 20, marginBottom: 12, alignItems: 'center', gap: 16 },
  correctText: { color: '#4caf50', fontSize: 28, fontWeight: 'bold' },
  nextButton: { width: '100%', backgroundColor: '#6c47ff', borderRadius: 12, padding: 16 },

  // スキップ
  skipButton: { padding: 16, alignItems: 'center' },
  skipText: { color: '#444', fontSize: 14 },
});