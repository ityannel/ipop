import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  Dimensions,
  SafeAreaView,
  Platform,
} from 'react-native';
// import { fetchDueWords, fetchQuestion, submitReview } from '../services/api';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── ダミーデータ ────────────────────────────────────────────
const DUMMY_WORDS = [
  { id: 'w1', isNew: true },
  { id: 'w2', isNew: false },
  { id: 'w3', isNew: true },
];

const DUMMY_QUESTIONS: Record<string, QuestionData> = {
  w1: {
    ja: '私はi-tyaです（私はi-tyaを話します）。',
    hintWord: 'ma',
    hintDesc: '一人称を表す名詞形',
    parts: [null, ' la i-tya.'],
    answer: 'ma',
    explanation: '「ma」は一人称を表す最も基本的な名詞形だ。',
    syllableCount: 1,
  },
  w2: {
    ja: 'これは水です。',
    hintWord: 'sa',
    hintDesc: '対象を指し示す音',
    parts: [null, ' a ti.'],
    answer: 'sa',
    explanation: '「sa」は対象を鋭く指し示すポインティングの音だぜ。',
    syllableCount: 1,
  },
  w3: {
    ja: '空間が広がる。',
    hintWord: 'lu',
    hintDesc: '流音で空間の広がりを表す',
    parts: [null, ' a wa.'],
    answer: 'lu',
    explanation: '流音「l」は空間の広がりや無限の連続性（lu）を示すんだ。',
    syllableCount: 1,
  },
};

// ─── 型 ──────────────────────────────────────────────────────
interface Word { id: string; isNew: boolean; }
interface QuestionData {
  ja: string;
  hintWord: string;
  hintDesc: string;
  parts: (string | null)[];
  answer: string;
  explanation: string;
  syllableCount: number;
}

// ─── キーボード定義 ──────────────────────────────────────────
const KB_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m','⌫'],
];

// ─── メインコンポーネント ────────────────────────────────────
export default function StudyScreen() {
  const [words, setWords]               = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion]         = useState<QuestionData | null>(null);
  const [typed, setTyped]               = useState('');
  const [isCorrect, setIsCorrect]       = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [isDone, setIsDone]             = useState(false);
  const startTimeRef                    = useRef<number>(0);

  // アニメーション値
  const progressAnim   = useRef(new Animated.Value(1 / 3)).current;
  const redFlashAnim   = useRef(new Animated.Value(0)).current;
  const checkScaleAnim = useRef(new Animated.Value(0)).current;
  const checkRotAnim   = useRef(new Animated.Value(-15)).current;
  const cardSlideAnim  = useRef(new Animated.Value(20)).current;
  const cardOpacAnim   = useRef(new Animated.Value(0)).current;
  const explainAnim    = useRef(new Animated.Value(0)).current;
  const nextBtnAnim    = useRef(new Animated.Value(0)).current;
  const bubbleAnim     = useRef(new Animated.Value(0)).current;

  // ── ロード ──────────────────────────────────────────────────
  useEffect(() => { loadWords(); }, []);

  async function loadWords() {
    setIsLoading(true);
    // const data = await fetchDueWords();
    // const all = [...(data.review || []), ...(data.new || [])];
    const all = DUMMY_WORDS;
    setWords(all);
    if (all.length > 0) await loadQuestion(all[0], 0, all.length);
    setIsLoading(false);
  }

  async function loadQuestion(word: Word, index: number, total: number) {
    // const data = await fetchQuestion(word.id);
    const data = DUMMY_QUESTIONS[word.id];
    setQuestion(data);
    setTyped('');
    setIsCorrect(false);
    startTimeRef.current = Date.now();

    // 進捗バー
    Animated.timing(progressAnim, {
      toValue: (index + 1) / total,
      duration: 600,
      useNativeDriver: false,
    }).start();

    // カードスライドイン
    cardSlideAnim.setValue(20);
    cardOpacAnim.setValue(0);
    Animated.parallel([
      Animated.timing(cardSlideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(cardOpacAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();

    // アニメリセット
    checkScaleAnim.setValue(0);
    checkRotAnim.setValue(-15);
    explainAnim.setValue(0);
    nextBtnAnim.setValue(0);
    bubbleAnim.setValue(0);
  }

  // ── キー入力 ────────────────────────────────────────────────
  const pressKey = useCallback((key: string) => {
    if (isCorrect) return;
    if (key === '⌫') {
      setTyped(prev => {
        const next = prev.slice(0, -1);
        Animated.timing(bubbleAnim, {
          toValue: next.length > 0 ? 1 : 0,
          duration: 120,
          useNativeDriver: true,
        }).start();
        return next;
      });
    } else if (key === 'OK') {
      handleSubmit();
    } else {
      setTyped(prev => {
        const next = prev + key;
        Animated.timing(bubbleAnim, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }).start();
        return next;
      });
    }
  }, [isCorrect]);

  // ── 正解を見る ───────────────────────────────────────────────
  function showAnswer() {
    if (!question || isCorrect) return;
    setTyped(question.answer);
    Animated.timing(bubbleAnim, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }

  // ── 回答送信 ─────────────────────────────────────────────────
  function handleSubmit() {
    if (!question || isCorrect || !typed) return;
    if (typed.toLowerCase() === question.answer.toLowerCase()) {
      setIsCorrect(true);
      Animated.parallel([
        Animated.spring(checkScaleAnim, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }),
        Animated.timing(checkRotAnim, { toValue: -8, duration: 350, useNativeDriver: true }),
        Animated.timing(bubbleAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(explainAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(nextBtnAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start();
      }, 200);
      // submitReview({ wordId: words[currentIndex].id, isCorrect: true, ... });
    } else {
      // 不正解: 赤フラッシュ
      Animated.sequence([
        Animated.timing(redFlashAnim, { toValue: 1, duration: 70, useNativeDriver: true }),
        Animated.timing(redFlashAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start();
    }
  }

  // ── 次の問題 ─────────────────────────────────────────────────
  async function nextQuestion() {
    const next = currentIndex + 1;
    if (next >= words.length) {
      setIsDone(true);
      return;
    }
    setCurrentIndex(next);
    await loadQuestion(words[next], next, words.length);
  }

  // ── 再スタート ───────────────────────────────────────────────
  function restart() {
    setIsDone(false);
    setCurrentIndex(0);
    setTyped('');
    setIsCorrect(false);
    loadWords();
  }

  // ── ローディング ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={s.center}>
        <Text style={s.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  // ── 完了画面 ─────────────────────────────────────────────────
  if (isDone) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.center}>
          <Text style={{ fontSize: 60, marginBottom: 16 }}>🎉</Text>
          <Text style={s.doneTitle}>学習完了！</Text>
          <Text style={s.doneSub}>{words.length}問すべて終わりました</Text>
          <TouchableOpacity style={s.nextBtn} onPress={restart}>
            <Text style={s.nextBtnText}>もう一度</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const word = words[currentIndex];
  const blankW = question ? Math.max(80, question.answer.length * 19 + 24) : 80;
  const typedW  = typed.length > 0 ? Math.max(blankW, typed.length * 19 + 24) : blankW;

  return (
    <SafeAreaView style={s.root}>
      {/* 赤フラッシュ */}
      <Animated.View
        pointerEvents="none"
        style={[s.redFlash, { opacity: redFlashAnim }]}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="always"
        scrollEnabled={false}
      >
        {/* プログレスバー */}
        <View style={s.progressBg}>
          <Animated.View
            style={[
              s.progressFill,
              { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
        </View>
        <View style={s.progressRow}>
          <Text style={s.progressText}>{currentIndex + 1}/{words.length}</Text>
          <Text style={s.progressBadge}>{word.isNew ? '🆕 新規' : '🔁 復習'}</Text>
        </View>

        {/* 問題カード */}
        {question && (
          <Animated.View
            style={[
              s.card,
              {
                opacity: cardOpacAnim,
                transform: [{ translateY: cardSlideAnim }],
              },
            ]}
          >
            {/* 正解チェックマーク */}
            <Animated.Text
              style={[
                s.bigCheck,
                {
                  opacity: checkScaleAnim,
                  transform: [
                    { scale: checkScaleAnim },
                    { rotate: checkRotAnim.interpolate({ inputRange: [-15, -8], outputRange: ['-15deg', '-8deg'] }) },
                  ],
                },
              ]}
            >
              ✓
            </Animated.Text>

            {/* メタ行 */}
            <View style={s.metaRow}>
              <View style={s.lvBadge}><Text style={s.lvText}>Lv —</Text></View>
              <View style={[s.timeBadge, word.isNew ? s.timeBadgeNew : s.timeBadgeReview]}>
                <Text style={s.timeText}>{word.isNew ? '🆕 新規' : '🔁 復習'}</Text>
              </View>
            </View>

            {/* 日本語文 */}
            <Text style={s.jaText}>{question.ja}</Text>
            <Text style={s.hintNote}>
              ※ <Text style={s.hintWord}>{question.hintWord}</Text>
              という意味の語 — {question.hintDesc}
            </Text>

            {/* 穴埋め文（インライン入力欄） */}
            <View style={s.sentenceWrap}>
              {question.parts.map((part, i) =>
                part === null ? (
                  <View
                    key={i}
                    style={[
                      s.blankBox,
                      { width: typedW },
                      typed.length > 0 && !isCorrect && s.blankBoxTyping,
                      isCorrect && s.blankBoxCorrect,
                    ]}
                  >
                    <Text
                      style={[
                        s.blankText,
                        typed.length === 0 && s.blankTextEmpty,
                        isCorrect && s.blankTextCorrect,
                      ]}
                    >
                      {typed || ''}
                    </Text>
                  </View>
                ) : (
                  <Text key={i} style={s.enWord}>{part}</Text>
                )
              )}
            </View>

            {/* タイピング中の吹き出し */}
            <Animated.View
              pointerEvents="none"
              style={[
                s.bubble,
                {
                  opacity: bubbleAnim,
                  transform: [{ translateY: bubbleAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
                },
              ]}
            >
              <Text style={s.bubbleText}>{typed}</Text>
              <View style={s.bubbleTail} />
            </Animated.View>

            <Text style={s.srcNote}>[単語出典]ipop単語帳</Text>
          </Animated.View>
        )}

        {/* 解説 */}
        <Animated.View
          style={[
            s.explainCard,
            {
              opacity: explainAnim,
              transform: [{ translateY: explainAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          <Text style={s.explainText}>{question?.explanation}</Text>
        </Animated.View>

        {/* 次へボタン */}
        <Animated.View
          style={{
            opacity: nextBtnAnim,
            transform: [{ translateY: nextBtnAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }}
        >
          {isCorrect && (
            <TouchableOpacity style={s.nextBtn} onPress={nextQuestion}>
              <Text style={s.nextBtnText}>次の問題 →</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </ScrollView>

      {/* カスタムキーボード */}
      {!isCorrect && (
        <View style={s.kbArea}>
          {/* アクション行 */}
          <View style={s.kbActions}>
            <TouchableOpacity style={s.kbAction} onPress={showAnswer}>
              <Text style={s.kbActionIcon}>✓</Text>
              <Text style={s.kbActionLabel}>正解を見る</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.kbAction}>
              <Text style={s.kbActionIcon}>🎤</Text>
              <Text style={s.kbActionLabel}>音声モード</Text>
            </TouchableOpacity>
          </View>

          {/* キー行 */}
          {KB_ROWS.map((row, ri) => (
            <View key={ri} style={s.kbRow}>
              {ri === 2 && <View style={s.kbSpacer} />}
              {row.map(k => (
                <KeyButton key={k} label={k} onPress={() => pressKey(k)} isDel={k === '⌫'} />
              ))}
              {ri === 2 && <View style={s.kbSpacer} />}
            </View>
          ))}

          {/* スペース行 */}
          <View style={[s.kbRow, { marginBottom: 4 }]}>
            <KeyButton label="1" onPress={() => {}} isWide />
            <KeyButton label=" " onPress={() => pressKey(' ')} isSpace />
            <KeyButton label="✓ OK" onPress={handleSubmit} isOK />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── キーボタン ──────────────────────────────────────────────
function KeyButton({
  label, onPress, isDel = false, isWide = false, isSpace = false, isOK = false,
}: {
  label: string; onPress: () => void;
  isDel?: boolean; isWide?: boolean; isSpace?: boolean; isOK?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function onIn() {
    Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 50 }).start();
  }
  function onOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start();
    onPress();
  }

  return (
    <TouchableOpacity
      onPressIn={onIn}
      onPressOut={onOut}
      activeOpacity={1}
      style={[
        s.key,
        isDel && s.keyWide,
        isWide && s.keyWide,
        isSpace && s.keySpace,
        isOK && s.keyOK,
      ]}
    >
      <Animated.Text
        style={[s.keyText, isOK && s.keyOKText, { transform: [{ scale }] }]}
      >
        {label}
      </Animated.Text>
    </TouchableOpacity>
  );
}

// ─── スタイル ────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0818' },
  center: { flex: 1, backgroundColor: '#0a0818', alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { color: '#888', fontSize: 16 },
  scrollContent: { padding: 16, paddingTop: 20, paddingBottom: 8 },

  // 赤フラッシュ
  redFlash: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,40,40,0.16)', zIndex: 50, pointerEvents: 'none',
  },

  // プログレス
  progressBg: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: 6, backgroundColor: '#6c47ff', borderRadius: 3 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  progressText: { color: '#555', fontSize: 12 },
  progressBadge: { color: '#444', fontSize: 11 },

  // カード
  card: {
    backgroundColor: 'rgba(28,26,44,0.92)',
    borderRadius: 22, padding: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 12, position: 'relative', overflow: 'visible',
  },
  bigCheck: {
    position: 'absolute', top: -22, left: -14,
    fontSize: 80, color: '#3ecf4c', zIndex: 10,
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  lvBadge: { backgroundColor: 'rgba(108,71,255,0.9)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  lvText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  timeBadge: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  timeBadgeNew: { backgroundColor: '#2ab8b8' },
  timeBadgeReview: { backgroundColor: '#6c7a89' },
  timeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  jaText: { color: '#e0e0e0', fontSize: 18, lineHeight: 32, marginBottom: 6 },
  hintNote: { color: '#555', fontSize: 12, marginBottom: 16 },
  hintWord: { color: '#4caf50' },

  // 穴埋め文
  sentenceWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  enWord: { color: '#c8c8c8', fontSize: 20, lineHeight: 40 },
  blankBox: {
    height: 40, minWidth: 80,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 10, borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 4,
    paddingHorizontal: 10,
  },
  blankBoxTyping: { borderColor: 'rgba(108,71,255,0.85)', backgroundColor: 'rgba(108,71,255,0.13)' },
  blankBoxCorrect: { borderColor: 'rgba(76,175,80,0.6)', backgroundColor: 'rgba(76,175,80,0.1)' },
  blankText: { color: '#fff', fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  blankTextEmpty: { color: 'transparent' },
  blankTextCorrect: { color: '#4caf50' },

  // 吹き出し
  bubble: {
    position: 'absolute', bottom: '100%', alignSelf: 'center',
    backgroundColor: '#6c47ff', borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 7, marginBottom: 6,
  },
  bubbleText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bubbleTail: {
    position: 'absolute', bottom: -7, alignSelf: 'center',
    width: 0, height: 0,
    borderLeftWidth: 7, borderLeftColor: 'transparent',
    borderRightWidth: 7, borderRightColor: 'transparent',
    borderTopWidth: 7, borderTopColor: '#6c47ff',
  },

  srcNote: { textAlign: 'right', color: '#2e2e50', fontSize: 11, marginTop: 8 },

  // 解説
  explainCard: {
    backgroundColor: 'rgba(8,22,8,0.9)', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.18)', marginBottom: 10,
  },
  explainText: { color: '#999', fontSize: 14, lineHeight: 22 },

  // 次へボタン
  nextBtn: {
    backgroundColor: '#6c47ff', borderRadius: 14,
    padding: 15, alignItems: 'center', marginBottom: 8,
  },
  nextBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  // 完了画面
  doneTitle: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 8 },
  doneSub: { color: '#666', fontSize: 14, marginBottom: 28 },

  // キーボード
  kbArea: {
    backgroundColor: 'rgba(16,14,28,0.98)',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingHorizontal: 4,
  },
  kbActions: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 8,
  },
  kbAction: { alignItems: 'center' },
  kbActionIcon: { fontSize: 18, color: '#777', marginBottom: 2 },
  kbActionLabel: { color: '#999', fontSize: 12 },
  kbRow: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 6 },
  kbSpacer: { flex: 0.5 },

  // キー
  key: {
    flex: 1, maxWidth: 36, height: 42,
    backgroundColor: 'rgba(75,73,98,0.75)',
    borderRadius: 7, alignItems: 'center', justifyContent: 'center',
  },
  keyWide: { maxWidth: 54, flex: 1.4 },
  keySpace: { flex: 4, maxWidth: 9999, backgroundColor: 'rgba(55,53,80,0.8)' },
  keyOK: { maxWidth: 80, flex: 2, backgroundColor: '#3a7fff' },
  keyText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  keyOKText: { fontSize: 13, fontWeight: '700' },
});