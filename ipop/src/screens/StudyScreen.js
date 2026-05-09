import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Animated, Dimensions, SafeAreaView, Platform, StatusBar,
  Alert, BackHandler
} from 'react-native';
// ダミーを消し去って、本物のAPIをインポートしたぞ
import { fetchDueWords, fetchQuestion, submitReview } from '../services/api';

const { width: SCREEN_W } = Dimensions.get('window');

const KB_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m','⌫'],
];

export default function StudyScreen({ onFinish }) {
  const [words, setWords]               = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion]         = useState(null);
  const [typed, setTyped]               = useState('');
  const [isCorrect, setIsCorrect]       = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [isDone, setIsDone]             = useState(false);
  const [hintLevel, setHintLevel]       = useState(0);
  
  const [originalTotal, setOriginalTotal] = useState(10);
  const [clearedCount, setClearedCount]   = useState(0);
  const [isReview, setIsReview]           = useState(false);

  const startTimeRef                    = useRef(0);
  const [sessionStartTime, setSessionStartTime] = useState(0);
  const firstSeenRef = useRef({});

  const progressAnim   = useRef(new Animated.Value(0)).current;
  const redFlashAnim   = useRef(new Animated.Value(0)).current;
  const checkScaleAnim = useRef(new Animated.Value(0)).current;
  const checkRotAnim   = useRef(new Animated.Value(-15)).current;
  const cardSlideAnim  = useRef(new Animated.Value(20)).current;
  const cardOpacAnim   = useRef(new Animated.Value(0)).current;
  const cardShakeAnim  = useRef(new Animated.Value(0)).current;
  const explainAnim    = useRef(new Animated.Value(0)).current;
  const nextBtnAnim    = useRef(new Animated.Value(0)).current;

  const handleExit = useCallback(() => {
    Alert.alert(
      '確認',
      '本当に戻りますか？\n（現在のセッションの進捗は失われます）',
      [
        { text: 'キャンセル', style: 'cancel' },
        { 
          text: 'はい', 
          style: 'destructive',
          onPress: () => {
            if (onFinish) onFinish();
          } 
        }
      ]
    );
    return true;
  }, [onFinish]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleExit);
    return () => backHandler.remove();
  }, [handleExit]);

  useEffect(() => { loadWords(); }, []);

  async function loadWords() {
    setIsLoading(true);
    try {
      // 本物のAPIから単語リストを取得するぞ
      const data = await fetchDueWords();
      const all = [...(data.review || []), ...(data.new || [])];
      
      const shuffled = all.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, 10);
      
      setOriginalTotal(selected.length);
      setClearedCount(0);
      progressAnim.setValue(0);
      
      const initializedWords = selected.map(w => ({ ...w, isRetry: false }));
      setWords(initializedWords);
      firstSeenRef.current = {};
      
      if (initializedWords.length > 0) {
          setSessionStartTime(Date.now());
          await loadQuestion(initializedWords[0], 0, initializedWords.length);
      } else {
          setIsDone(true); // 問題がない場合は即終了画面
      }
    } catch (e) {
      console.error(e);
      Alert.alert('エラー', '単語の取得に失敗しました');
    }
    setIsLoading(false);
  }

  async function loadQuestion(word, index, total) {
    try {
      // 本物のAPIから問題データを取得するぞ
      const data = await fetchQuestion(word.id);
      setQuestion(data);
      setTyped('');
      setIsCorrect(false);
      setHintLevel(0);
      setIsReview(false);
      
      const now = Date.now();
      startTimeRef.current = now;
      
      if (!firstSeenRef.current[word.id]) {
        firstSeenRef.current[word.id] = now;
      }

      cardSlideAnim.setValue(20);
      cardOpacAnim.setValue(0);
      cardShakeAnim.setValue(0);
      Animated.parallel([
        Animated.timing(cardSlideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
        Animated.timing(cardOpacAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();

      checkScaleAnim.setValue(0);
      checkRotAnim.setValue(-15);
      explainAnim.setValue(0);
      nextBtnAnim.setValue(0);
    } catch (e) {
      console.error(e);
      Alert.alert('エラー', '問題データの取得に失敗しました');
    }
  }

  useEffect(() => {
    if (!question || isCorrect) return;

    if (typed.length >= question.answer.length) {
      if (typed.toLowerCase() === question.answer.toLowerCase()) {
        handleCorrect();
      } else {
        Animated.sequence([
          Animated.timing(cardShakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
          Animated.timing(cardShakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
          Animated.timing(cardShakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
          Animated.timing(cardShakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
        ]).start();
      }
    }
  }, [typed, question, isCorrect]);

  function handleCorrect() {
    setIsCorrect(true);
    
    const timeTaken = Date.now() - startTimeRef.current;
    const word = words[currentIndex];
    
    const isFlawless = hintLevel === 0 && timeTaken <= 10000;

    // 初回出題時のみ、本物のバックエンドAPIに結果を送信するぞ
    if (!word.isRetry) {
      submitReview({ wordId: word.id, isCorrect: isFlawless }).catch(e => console.error(e));
    }

    if (isFlawless) {
      setClearedCount(prev => {
        const next = prev + 1;
        Animated.timing(progressAnim, {
          toValue: next / originalTotal,
          duration: 600,
          useNativeDriver: false,
        }).start();
        return next;
      });
    } else {
      setIsReview(true);
      setWords(prev => [...prev, { ...word, isRetry: true }]);
    }

    Animated.parallel([
      Animated.spring(checkScaleAnim, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }),
      Animated.timing(checkRotAnim, { toValue: -8, duration: 350, useNativeDriver: true }),
    ]).start();
    
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(explainAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(nextBtnAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }, 200);
  }

  function handleHint() {
    if (!question || isCorrect) return;
    if (hintLevel === 0) {
      setHintLevel(1);
    } else {
      const target = question.answer;
      if (typed.length < target.length) {
        let nextChar = target[typed.length];
        const isFirstCharOfSentence = typed.length === 0 && question.parts[0] === null;
        if (isFirstCharOfSentence) nextChar = nextChar.toUpperCase();
        setTyped(prev => prev + nextChar);
      }
    }
  }

  const pressKey = useCallback((key) => {
    if (isCorrect) return;
    if (key === '⌫') {
      setTyped(prev => prev.slice(0, -1));
    } else if (key === 'OK') {
      if (!typed) return;
      if (typed.toLowerCase() === question.answer.toLowerCase()) {
        handleCorrect();
      } else {
        Animated.sequence([
          Animated.timing(cardShakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
          Animated.timing(cardShakeAnim, { toValue: -12, duration: 50, useNativeDriver: true }),
          Animated.timing(cardShakeAnim, { toValue: 12, duration: 50, useNativeDriver: true }),
          Animated.timing(cardShakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
        ]).start();
      }
    } else {
      setTyped(prev => prev + key);
    }
  }, [isCorrect, question, typed]);

  async function nextQuestion() {
    const next = currentIndex + 1;
    if (next >= words.length) {
      setIsDone(true);
      return;
    }
    setCurrentIndex(next);
    await loadQuestion(words[next], next, words.length);
  }

  function restart() {
    setIsDone(false);
    setCurrentIndex(0);
    setTyped('');
    setIsCorrect(false);
    loadWords();
  }

  function getElapsedTime(wordId) {
    const firstSeen = firstSeenRef.current[wordId];
    if (!firstSeen) return null;
    const diffMs = Date.now() - firstSeen;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins === 0) return 'さっき';
    return `${diffMins}分前`;
  }

  if (isLoading) {
    return (
      <View style={s.center}>
        <Text style={s.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  if (isDone) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.center}>
          <Text style={{ fontSize: 60, marginBottom: 16 }}>🎉</Text>
          <Text style={s.doneTitle}>学習完了</Text>
          <Text style={s.doneSub}>セッションの単語をすべてクリアしました！</Text>
          <TouchableOpacity style={s.nextBtn} onPress={restart}>
            <Text style={s.nextBtnText}>もう一度</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.nextBtn, { backgroundColor: '#333', marginTop: 12 }]} onPress={() => { if (onFinish) onFinish(); }}>
            <Text style={s.nextBtnText}>ホームに戻る</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const word = words[currentIndex];
  const blankW = question ? Math.max(80, question.answer.length * 19 + 24) : 80;
  const typedW  = typed.length > 0 ? Math.max(blankW, typed.length * 19 + 24) : blankW;
  const elapsedTimeStr = word.isRetry ? getElapsedTime(word.id) : null;

  return (
    <SafeAreaView style={s.root}>
      <Animated.View
        pointerEvents="none"
        style={[s.redFlash, { opacity: redFlashAnim }]}
      />

      <View style={s.header}>
        <TouchableOpacity onPress={handleExit} style={s.closeBtn}>
          <Text style={s.closeBtnText}>×</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="always"
        scrollEnabled={false}
      >
        <View style={s.progressBg}>
          <Animated.View
            style={[
              s.progressFill,
              { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
        </View>
        <View style={s.progressRow}>
          <Text style={s.progressText}>クリア: {clearedCount} / {originalTotal}</Text>
        </View>

        {question && (
          <Animated.View
            style={[
              s.card,
              {
                opacity: cardOpacAnim,
                transform: [
                  { translateY: cardSlideAnim },
                  { translateX: cardShakeAnim }
                ],
              },
            ]}
          >
            <Animated.Text
              style={[
                s.bigCheck,
                isReview && { color: '#ff9800' },
                {
                  opacity: checkScaleAnim,
                  transform: [
                    { scale: checkScaleAnim },
                    { rotate: checkRotAnim.interpolate({ inputRange: [-15, -8], outputRange: ['-15deg', '-8deg'] }) },
                  ],
                },
              ]}
            >
              {isReview ? '⚠️' : '✓'}
            </Animated.Text>

            <View style={s.metaRow}>
              <View style={s.lvBadge}><Text style={s.lvText}>Lv {word.level || 1}</Text></View>
              <View style={[s.timeBadge, word.isRetry ? s.timeBadgeRetry : (word.isNew ? s.timeBadgeNew : s.timeBadgeReview)]}>
                <Text style={s.timeText}>
                  {word.isRetry ? `[RE] 復習 (${elapsedTimeStr})` : (word.isNew ? '[NEW] 新規' : '[REV] 復習')}
                </Text>
              </View>
            </View>

            <Text style={s.jaText}>{question.ja}</Text>
            
            {hintLevel > 0 && (
              <Text style={s.hintNote}>
                ※ <Text style={s.hintWord}>{question.hintWord}</Text>
                という意味の語 — {question.hintDesc}
              </Text>
            )}

            <View style={s.sentenceWrap}>
              {question.parts.map((part, i) =>
                part === null ? (
                  <View
                    key={i}
                    style={[
                      s.blankBox,
                      { width: typedW },
                      typed.length > 0 && !isCorrect && s.blankBoxTyping,
                      isCorrect && !isReview && s.blankBoxCorrect,
                      isCorrect && isReview && s.blankBoxReview,
                    ]}
                  >
                    <Text
                      style={[
                        s.blankText,
                        typed.length === 0 && s.blankTextEmpty,
                        isCorrect && !isReview && s.blankTextCorrect,
                        isCorrect && isReview && s.blankTextReview,
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

            <Text style={s.srcNote}>[単語出典]ipop単語帳</Text>
          </Animated.View>
        )}

        <Animated.View
          style={[
            s.explainCard,
            {
              opacity: explainAnim,
              transform: [{ translateY: explainAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          {isReview && (
            <Text style={{ color: '#ff9800', fontWeight: 'bold', marginBottom: 8 }}>
              ※ヒント使用またはタイムオーバーのため、後で復習します。
            </Text>
          )}
          <Text style={s.explainText}>{question?.explanation}</Text>
        </Animated.View>

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

      {!isCorrect && (
        <View style={s.kbArea}>
          <View style={s.kbActions}>
            <TouchableOpacity style={s.kbAction} onPress={handleHint}>
              <Text style={s.kbActionIcon}>💡</Text>
              <Text style={s.kbActionLabel}>ヒントを見る</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.kbAction}>
              <Text style={s.kbActionIcon}>[MIC]</Text>
              <Text style={s.kbActionLabel}>音声モード</Text>
            </TouchableOpacity>
          </View>

          {KB_ROWS.map((row, ri) => (
            <View key={ri} style={s.kbRow}>
              {ri === 2 && <View style={s.kbSpacer} />}
              {row.map(k => {
                const isAlpha = /^[a-z]$/.test(k);
                const isFirstCharOfSentence = typed.length === 0 && question && question.parts[0] === null;
                const displayKey = (isFirstCharOfSentence && isAlpha) ? k.toUpperCase() : k;
                return <KeyButton key={k} label={displayKey} onPress={() => pressKey(displayKey)} isDel={k === '⌫'} />
              })}
              {ri === 2 && <View style={s.kbSpacer} />}
            </View>
          ))}

          <View style={[s.kbRow, { marginBottom: 4 }]}>
            <KeyButton label="1" onPress={() => {}} isWide />
            <KeyButton label=" " onPress={() => pressKey(' ')} isSpace />
            <KeyButton label="✓ OK" onPress={() => pressKey('OK')} isOK />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function KeyButton({
  label, onPress, isDel = false, isWide = false, isSpace = false, isOK = false,
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0818', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 40 : 0 },
  center: { flex: 1, backgroundColor: '#0a0818', alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { color: '#888', fontSize: 16 },
  header: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold', lineHeight: 24 },
  scrollContent: { padding: 16, paddingTop: 12, paddingBottom: 8 },
  redFlash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,40,40,0.16)', zIndex: 50, pointerEvents: 'none' },
  progressBg: { height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: 6, backgroundColor: '#6c47ff', borderRadius: 3 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  progressText: { color: '#555', fontSize: 13, fontWeight: 'bold' },
  card: { backgroundColor: 'rgba(28,26,44,0.92)', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 12, position: 'relative', overflow: 'visible' },
  bigCheck: { position: 'absolute', top: -22, left: -14, fontSize: 80, color: '#3ecf4c', zIndex: 10 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  lvBadge: { backgroundColor: 'rgba(108,71,255,0.9)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  lvText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  timeBadge: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  timeBadgeNew: { backgroundColor: '#2ab8b8' },
  timeBadgeReview: { backgroundColor: '#6c7a89' },
  timeBadgeRetry: { backgroundColor: '#d9534f' },
  timeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  jaText: { color: '#e0e0e0', fontSize: 18, lineHeight: 32, marginBottom: 6 },
  hintNote: { color: '#ffcc00', fontSize: 12, marginBottom: 16, fontWeight: 'bold' },
  hintWord: { color: '#ff6600' },
  sentenceWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  enWord: { color: '#c8c8c8', fontSize: 20, lineHeight: 40 },
  blankBox: { height: 40, minWidth: 80, backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginHorizontal: 4, paddingHorizontal: 10 },
  blankBoxTyping: { borderColor: 'rgba(108,71,255,0.85)', backgroundColor: 'rgba(108,71,255,0.13)' },
  blankBoxCorrect: { borderColor: 'rgba(76,175,80,0.6)', backgroundColor: 'rgba(76,175,80,0.1)' },
  blankBoxReview: { borderColor: 'rgba(255,152,0,0.6)', backgroundColor: 'rgba(255,152,0,0.1)' },
  blankText: { color: '#fff', fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  blankTextEmpty: { color: 'transparent' },
  blankTextCorrect: { color: '#4caf50' },
  blankTextReview: { color: '#ff9800' },
  srcNote: { textAlign: 'right', color: '#2e2e50', fontSize: 11, marginTop: 8 },
  explainCard: { backgroundColor: 'rgba(8,22,8,0.9)', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: 'rgba(76,175,80,0.18)', marginBottom: 10 },
  explainText: { color: '#999', fontSize: 14, lineHeight: 22 },
  nextBtn: { backgroundColor: '#6c47ff', borderRadius: 14, padding: 15, alignItems: 'center', marginBottom: 8 },
  nextBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  doneTitle: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 8 },
  doneSub: { color: '#666', fontSize: 14, marginBottom: 28 },
  kbArea: { backgroundColor: 'rgba(16,14,28,0.98)', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 44 : 24, paddingHorizontal: 4 },
  kbActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  kbAction: { alignItems: 'center' },
  kbActionIcon: { fontSize: 18, color: '#777', marginBottom: 2 },
  kbActionLabel: { color: '#999', fontSize: 12 },
  kbRow: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 6 },
  kbSpacer: { flex: 0.5 },
  key: { flex: 1, maxWidth: 36, height: 42, backgroundColor: 'rgba(75,73,98,0.75)', borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  keyWide: { maxWidth: 54, flex: 1.4 },
  keySpace: { flex: 4, maxWidth: 9999, backgroundColor: 'rgba(55,53,80,0.8)' },
  keyOK: { maxWidth: 80, flex: 2, backgroundColor: '#3a7fff' },
  keyText: { color: '#fff', fontSize: 15, fontWeight: '500' },
  keyOKText: { fontSize: 13, fontWeight: '700' },
});