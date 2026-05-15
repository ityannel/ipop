import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Animated, Platform,
  Alert, BackHandler, Vibration, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchDueWords, fetchQuestion, submitReview, migrateQuestions } from '../services/api';
import { FONT, COLORS } from '../constants/theme';
import Chara from '../chara.svg';
import FukidashiTail from '../fukidashi.svg';
import IpopLogo from '../ipop.svg';
import CloseIcon from '../close.svg';
import StatusBar from '../status.svg';
import CustomKeyboard from '../components/CustomKeyboard';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildParts(example, blank) {
  const idx = example.indexOf(blank);
  if (idx === -1) return [example];
  const parts = [];
  if (idx > 0) parts.push(example.slice(0, idx));
  parts.push(null);
  const after = example.slice(idx + blank.length);
  if (after.length > 0) parts.push(after);
  return parts;
}

export default function StudyScreen({ onFinish }) {
  const [words, setWords]               = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion]         = useState(null);
  const [typed, setTyped]               = useState('');
  const [isCorrect, setIsCorrect]       = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const [isDone, setIsDone]             = useState(false);
  const [hintLevel, setHintLevel]       = useState(0);
  const [error, setError]               = useState(null);

  const [originalTotal, setOriginalTotal] = useState(10);
  const [clearedCount, setClearedCount]   = useState(0);
  const [flawlessCount, setFlawlessCount] = useState(0);
  const [isReview, setIsReview]           = useState(false);
  const [barWidth, setBarWidth]           = useState(0);

  const sessionStartRef = useRef(Date.now());
  const startTimeRef  = useRef(0);
  const firstSeenRef  = useRef({});
  const autoNextTimer = useRef(null);
  const isLoadingRef  = useRef(false);

  const wordsRef        = useRef([]);
  const currentIndexRef = useRef(0);
  const hintLevelRef = useRef(0);
  const preFetchedRef = useRef({}); // Cache for pre-fetched questions

  const progressAnim   = useRef(new Animated.Value(0)).current;
  const redFlashAnim   = useRef(new Animated.Value(0)).current;
  const checkScaleAnim = useRef(new Animated.Value(0)).current;
  const checkRotAnim   = useRef(new Animated.Value(-15)).current;
  const cardSlideAnim  = useRef(new Animated.Value(60)).current;
  const cardOpacAnim   = useRef(new Animated.Value(0)).current;
  const explainAnim    = useRef(new Animated.Value(0)).current;
  const kbSlideAnim    = useRef(new Animated.Value(0)).current;
  const charaSpeechAnim = useRef(new Animated.Value(0)).current;

  // Chara Animation: Strictly follows keyboard downward
  const charaTranslateY = kbSlideAnim.interpolate({
    inputRange: [0, 400],
    outputRange: [-250, -40],
  });

  useEffect(() => {
    return () => {
      if (autoNextTimer.current) {
        clearTimeout(autoNextTimer.current);
      }
    };
  }, []);

  const handleExit = useCallback(() => {
    Alert.alert(
      '確認',
      '中断しますか？\n（進捗は破棄されます）',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'はい', style: 'destructive', onPress: () => { if (onFinish) onFinish(); } },
      ]
    );
    return true;
  }, [onFinish]);

  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', handleExit);
    return () => h.remove();
  }, [handleExit]);

  useEffect(() => { loadWords(); }, []);

  async function loadWords() {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDueWords();
      const reviewWords = data.review || [];
      const newWords    = (data.new || []).slice(0, 5);
      const all         = shuffle([...reviewWords, ...newWords]);

      setOriginalTotal(all.length || 1);
      setClearedCount(0);
      setFlawlessCount(0);
      progressAnim.setValue(0);
      kbSlideAnim.setValue(0);
      setCurrentIndex(0);
      currentIndexRef.current = 0;

      const initializedWords = all.map(w => ({ ...w, isRetry: false }));
      setWords(initializedWords);
      wordsRef.current = initializedWords;
      firstSeenRef.current = {};

      if (initializedWords.length > 0) {
        sessionStartRef.current = Date.now();
        // Load the first question fully
        await loadQuestion(initializedWords[0]);
        // Pre-fetch ALL other questions before removing loading screen
        if (initializedWords.length > 1) {
          const others = initializedWords.slice(1);
          await Promise.all(others.map(w => preFetchQuestion(w)));
        }
      } else {
        setIsDone(true);
      }
    } catch (e) {
      console.error(e);
      setError('データ取得失敗');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }

  async function preFetchQuestion(word) {
    if (!word || preFetchedRef.current[word.id]) return;
    try {
      const data = await fetchQuestion(word.id);
      preFetchedRef.current[word.id] = data;
    } catch (e) {
      console.warn('Pre-fetch failed for word:', word.id, e);
    }
  }

  async function loadQuestion(word) {
    setTyped('');
    setIsCorrect(false);
    setIsReview(false);
    setError(null);
    try {
      let data = preFetchedRef.current[word.id];
      if (!data) {
        data = await fetchQuestion(word.id);
      }
      const raw  = data.question ?? data;
      const answer = data.answer ?? raw.blank ?? '';
      const parts  = buildParts(raw.example ?? '', answer);

      setQuestion({
        ja:          raw.example_translation ?? '',
        jaBlank:     raw.translation_blank ?? raw.ja_blank ?? raw.keyword_ja ?? null,
        answer,
        parts,
        explanation: raw.explanation ?? '',
      });
      setTyped('');
      setIsCorrect(false);
      setHintLevel(0);
      hintLevelRef.current = 0;
      setIsReview(false);

      const now = Date.now();
      startTimeRef.current = now;
      if (!firstSeenRef.current[word.id]) firstSeenRef.current[word.id] = now;

      // Reset animations
      kbSlideAnim.setValue(400); 
      cardSlideAnim.setValue(60);
      cardOpacAnim.setValue(0);
      checkScaleAnim.setValue(0);
      checkRotAnim.setValue(-15);
      explainAnim.setValue(0);

      Animated.parallel([
        Animated.timing(cardSlideAnim, { toValue: 0, duration: 280, useNativeDriver: false }),
        Animated.timing(cardOpacAnim,  { toValue: 1, duration: 280, useNativeDriver: false }),
        Animated.spring(kbSlideAnim,   { toValue: 0, friction: 8, tension: 40, useNativeDriver: false }),
      ]).start();

      // Pre-fetch next-next if applicable
      const nextIdx = currentIndexRef.current + 1;
      if (nextIdx < wordsRef.current.length) {
        preFetchQuestion(wordsRef.current[nextIdx]);
      }
    } catch (e) {
      console.error(e);
      setError('問題ロード失敗');
    }
  }

  function handleCorrect() {
    setIsCorrect(true);

    const timeTaken  = Date.now() - startTimeRef.current;
    const word       = wordsRef.current[currentIndexRef.current];
    const isFlawless = hintLevelRef.current === 0 && timeTaken <= 10000;

    if (!word.isRetry) {
      submitReview({ wordId: word.id, isCorrect: isFlawless }).catch(e => console.error(e));
    }

    if (isFlawless) {
      const nextCleared = clearedCount + 1;
      setClearedCount(nextCleared);
      setFlawlessCount(prev => prev + 1);
      Animated.timing(progressAnim, {
        toValue: nextCleared / originalTotal,
        duration: 600,
        useNativeDriver: false,
      }).start();
    } else {
      setIsReview(true);
      setWords(prev => {
        const next = [...prev, { ...word, isRetry: true }];
        wordsRef.current = next;
        return next;
      });
      // Pre-fetch the retry word details if it's now further in the list
      preFetchQuestion(word);
    }

    Animated.parallel([
      Animated.spring(checkScaleAnim, { toValue: 1, friction: 5, tension: 200, useNativeDriver: false }),
      Animated.timing(checkRotAnim,   { toValue: -8, duration: 350, useNativeDriver: false }),
    ]).start();

    // Hide keyboard completely when correct
    Animated.timing(kbSlideAnim, { toValue: 400, duration: 400, useNativeDriver: false }).start(() => {
      Animated.timing(explainAnim, { toValue: 1, duration: 280, useNativeDriver: false }).start();
    });

    if (isFlawless) {
      autoNextTimer.current = setTimeout(() => nextQuestion(), 1400);
    }
  }

  function handleHint() {
    if (!question || isCorrect) return;
    const target = question.answer;

    if (hintLevel === 0) {
      setHintLevel(1);
      hintLevelRef.current = 1;
    } else if (hintLevel === 1) {
      const first = target[0];
      const isFirstOfSentence = question.parts[0] === null;
      setTyped(isFirstOfSentence ? first.toUpperCase() : first);
      setHintLevel(2);
      hintLevelRef.current = 2;
    } else {
      setTyped(target);
      setHintLevel(3);
      hintLevelRef.current = 3;
    }
  }

  const pressKey = useCallback((key) => {
    if (isCorrect) return;
    if (key === '⌫') {
      setTyped(prev => prev.slice(0, -1));
    } else if (key === 'OK') {
      if (!question) return;
      if (typed.toLowerCase() === question.answer.toLowerCase()) {
        handleCorrect();
      } else {
        Animated.sequence([
          Animated.timing(redFlashAnim, { toValue: 1, duration: 80,  useNativeDriver: false }),
          Animated.timing(redFlashAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
        ]).start();
      }
    } else {
      setTyped(prev => prev + key);
    }
  }, [isCorrect, question, typed]);

  const nextQuestion = useCallback(async () => {
    if (autoNextTimer.current) {
      clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
    }
    // Do NOT setQuestion(null) here to avoid the "mystery square" flash
    setTyped('');
    setIsCorrect(false);
    setHintLevel(0);
    hintLevelRef.current = 0;

    const next = currentIndexRef.current + 1;
    if (next >= wordsRef.current.length) {
      setIsDone(true);
      return;
    }
    setCurrentIndex(next);
    currentIndexRef.current = next;
    await loadQuestion(wordsRef.current[next]);
  }, []);

  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) {
      clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
    }
  }, []);

  function restart() {
    setIsDone(false);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setTyped('');
    setIsCorrect(false);
    loadWords();
  }

  function getElapsedLabel(wordId) {
    const firstSeen = firstSeenRef.current[wordId];
    if (!firstSeen) return 'さっき';
    const diffMins = Math.floor((Date.now() - firstSeen) / 60000);
    if (diffMins === 0) return 'さっき';
    return `${diffMins}分前`;
  }

  function getNextReviewLabel(word) {
    if (!word) return '';
    const ts = word.next_review ?? word.due_at ?? word.next_due ?? null;
    if (!ts) return '復習！';
    const diffMs   = new Date(ts).getTime() - Date.now();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins <= 0)  return 'まもなく！';
    if (diffMins < 60)  return `${diffMins}分後！`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}時間後！`;
    const diffDays  = Math.round(diffHours / 24);
    return `${diffDays}日後！`;
  }

  function getCloseHint() {
    if (!question || !typed || isCorrect) return null;
    const ans = question.answer.toLowerCase();
    const typ = typed.toLowerCase();
    
    if (typ === ans) return 'いけ！';

    if (ans.startsWith(typ) && typed.length >= Math.max(1, ans.length - 2)) {
      const remaining = ans.length - typed.length;
      if (remaining > 0 && remaining <= 3) return `残り${remaining}文字！`;
    }

    if (typed.length === ans.length) {
      let diff = 0;
      for (let i = 0; i < ans.length; i++) {
        if (typ[i] !== ans[i]) diff++;
      }
      if (diff <= 2) return `${diff}文字直して！`;
    }

    return null;
  }

  const closeHint = getCloseHint();

  useEffect(() => {
    if (closeHint) {
      charaSpeechAnim.setValue(0);
      Animated.spring(charaSpeechAnim, {
        toValue: 1,
        friction: 4,
        tension: 40,
        useNativeDriver: false,
      }).start();
    } else {
      Animated.timing(charaSpeechAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  }, [closeHint]);

  if (isLoading) {
    return (
      <View style={s.center}>
        <IpopLogo width={120} height={40} fill={COLORS.green} style={{ marginBottom: 15 }} />
        <View style={{ transform: [{ scale: 0.8 }] }}>
          <Chara width={160} height={160} />
        </View>
        <ActivityIndicator color={COLORS.green} size="small" style={{ marginTop: 30, opacity: 0.5 }} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.outer}>
        <SafeAreaView style={s.container}>
          <View style={s.center}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity
              style={[s.nextBtn, { marginTop: 20, paddingHorizontal: 32 }]}
              onPress={loadWords}
            >
              <Text style={s.nextBtnText}>再試行</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.nextBtn, { backgroundColor: '#1e1e2e', marginTop: 12, paddingHorizontal: 32 }]}
              onPress={() => { if (onFinish) onFinish(); }}
            >
              <Text style={s.nextBtnText}>終了</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (isDone) {
    const elapsed  = Math.round((Date.now() - sessionStartRef.current) / 1000);
    const mins     = Math.floor(elapsed / 60);
    const secs     = elapsed % 60;
    const accuracy = originalTotal > 0
      ? Math.round((flawlessCount / originalTotal) * 100)
      : 0;

    return (
      <View style={s.outer}>
        <SafeAreaView style={s.container}>
          <View style={s.center}>
            <Text style={{ fontSize: 56, marginBottom: 20 }}>🎉</Text>
            <Text style={s.doneTitle}>学習完了</Text>
            <View style={s.doneStats}>
              <View style={s.doneStat}>
                <Text style={s.doneStatNum}>{flawlessCount}<Text style={s.doneStatUnit}> / {originalTotal}</Text></Text>
                <Text style={s.doneStatLabel}>正解数</Text>
              </View>
              <View style={[s.doneStat, s.doneStatBorder]}>
                <Text style={s.doneStatNum}>{accuracy}<Text style={s.doneStatUnit}>%</Text></Text>
                <Text style={s.doneStatLabel}>正答率</Text>
              </View>
              <View style={s.doneStat}>
                <Text style={s.doneStatNum}>
                  {mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}`}
                  <Text style={s.doneStatUnit}>{mins > 0 ? '' : '秒'}</Text>
                </Text>
                <Text style={s.doneStatLabel}>時間</Text>
              </View>
            </View>

            <TouchableOpacity style={s.nextBtn} onPress={restart}>
              <Text style={s.nextBtnText}>リトライ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.nextBtn, { backgroundColor: '#1e1e2e', marginTop: 12 }]}
              onPress={() => { if (onFinish) onFinish(); }}
            >
              <Text style={s.nextBtnText}>ホーム</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const word = words[currentIndex];
  const badgeLabel = word?.isRetry
    ? getElapsedLabel(word.id)
    : word?.isNew
    ? '新規'
    : getNextReviewLabel(word);

  const badgeStyle = word?.isRetry
    ? s.timeBadgeRetry
    : word?.isNew
    ? s.timeBadgeNew
    : s.timeBadgeReview;

  return (
    <View style={s.outer}>
      <SafeAreaView style={s.container} edges={['top', 'left', 'right']}>
        <Animated.View
          pointerEvents="none"
          style={[s.redFlash, { opacity: redFlashAnim }]}
        />

        <View style={s.header}>
          <TouchableOpacity onPress={handleExit} style={s.closeBtn}>
            <CloseIcon width={34} height={34} />
          </TouchableOpacity>
          <View style={s.headerProgress}>
            <View style={s.barContainer}>
              <View 
                style={s.progressWrapper} 
                onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
              >
                <StatusBar width="100%" height={8} style={{ color: '#5C5C5C' }} />
                <Animated.View
                  style={[
                    s.progressFillContainer,
                    { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: [0, barWidth] }) },
                  ]}
                >
                  <StatusBar width={barWidth} height={8} style={{ color: COLORS.green }} />
                </Animated.View>
              </View>
            </View>
            <View style={s.progressTextRow}>
              <Text style={s.progressNum}>{clearedCount}</Text>
              <Text style={s.progressMu}> mu </Text>
              <Text style={s.progressTotal}>{originalTotal}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="always"
          scrollEnabled={isCorrect}
        >
          {question && (
            <TouchableOpacity activeOpacity={1} onPress={cancelAutoNext}>
              <Animated.View 
                style={[
                  s.cardWrapper,
                  {
                    opacity: cardOpacAnim,
                    transform: [{ translateX: cardSlideAnim }],
                  },
                ]}
              >
                <View
                  style={[
                    s.card,
                    isCorrect && !isReview && s.cardCorrect,
                    isCorrect && isReview  && s.cardReview,
                  ]}
                >
                  <Animated.View
                    style={[
                      s.checkBadge,
                      {
                        opacity: checkScaleAnim,
                        transform: [
                          { scale: checkScaleAnim },
                          { rotate: checkRotAnim.interpolate({ inputRange: [-15, -8], outputRange: ['-15deg', '-8deg'] }) },
                        ],
                      },
                    ]}
                  >
                    <Text style={s.checkBadgeText}>✓</Text>
                  </Animated.View>

                  <View style={s.metaRow}>
                    <View style={s.lvBadge}>
                      <Text style={s.lvText}>{word?.syllableCount ?? word?.level ?? '1'} lulu lu</Text>
                    </View>
                    <View style={[s.timeBadge, badgeStyle, { marginLeft: 8 }]}>
                      <Text style={s.timeText}>{badgeLabel}</Text>
                    </View>
                  </View>

                  <Text style={s.jaText}>
                    {question.jaBlank && question.ja.includes(question.jaBlank) ? (() => {
                      const idx = question.ja.indexOf(question.jaBlank);
                      return (
                        <Text>
                          {idx > 0 && <Text>{question.ja.slice(0, idx)}</Text>}
                          <Text style={s.jaTextHighlight}>{question.jaBlank}</Text>
                          <Text>{question.ja.slice(idx + question.jaBlank.length)}</Text>
                        </Text>
                      );
                    })() : question.ja}
                  </Text>

                  <View style={s.sentenceWrap}>
                    {(() => {
                      const elements = [];
                      const parts = question.parts ?? [];
                      for (let i = 0; i < parts.length; i++) {
                        const part = parts[i];
                        if (part === null) {
                          // Check if next part is punctuation
                          let punctuation = '';
                          if (i + 1 < parts.length && typeof parts[i + 1] === 'string') {
                            const nextPart = parts[i + 1];
                            const match = nextPart.match(/^([,.;!?])/);
                            if (match) {
                              punctuation = match[1];
                            }
                          }

                          elements.push(
                            <View key={`box-${i}`} style={s.boxGroup}>
                              <View
                                style={[
                                  s.blankBox,
                                  typed.length > 0 && !isCorrect && s.blankBoxTyping,
                                  isCorrect && !isReview && s.blankBoxCorrect,
                                  isCorrect && isReview  && s.blankBoxReview,
                                  hintLevel > 1 && !isCorrect && s.blankBoxHint,
                                ]}
                              >
                                {hintLevel > 0 && !isCorrect ? (
                                  <Text style={s.blankText} numberOfLines={1}>
                                    <Text style={s.hintTyped}>{typed}</Text>
                                    <Text style={s.hintRemain}>
                                      {question.answer.slice(typed.length).replace(/./g, '·')}
                                    </Text>
                                  </Text>
                                ) : (
                                  <Text
                                    style={[
                                      s.blankText,
                                      typed.length === 0 && s.blankTextEmpty,
                                      isCorrect && !isReview && s.blankTextCorrect,
                                      isCorrect && isReview  && s.blankTextReview,
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {typed || ' '}
                                  </Text>
                                )}
                              </View>
                              {punctuation !== '' && <Text style={s.enWord}>{punctuation}</Text>}
                            </View>
                          );
                        } else {
                          let displayPart = part;
                          if (i > 0 && parts[i - 1] === null) {
                            displayPart = part.replace(/^[,.;!?]/, '');
                          }
                          if (displayPart.length > 0) {
                            elements.push(<Text key={`text-${i}`} style={s.enWord}>{displayPart}</Text>);
                          }
                        }
                      }
                      return elements;
                    })()}
                  </View>
                </View>

                {/* Custom SVG Speech Bubble Bottom */}
                <View style={s.fukidashiBottom}>
                  <FukidashiTail width="100%" height={75} preserveAspectRatio="none" />
                </View>
              </Animated.View>
            </TouchableOpacity>
          )}

          <Animated.View
            style={[
              s.explainCard,
              {
                opacity: explainAnim,
                transform: [{ translateY: explainAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
              },
            ]}
          >
            <Text style={s.explainText}>{question?.explanation}</Text>
            {isCorrect && isReview && (
              <TouchableOpacity style={s.nextBtn} onPress={nextQuestion}>
                <Text style={s.nextBtnText}>次へ</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </ScrollView>

        {/* Keyboard Area */}
        <Animated.View
          style={[
            s.kbArea,
            { transform: [{ translateY: kbSlideAnim }] },
          ]}
          pointerEvents={isCorrect || !question ? 'none' : 'auto'}
        >
          <CustomKeyboard
            onKeyPress={pressKey}
            onDelete={() => pressKey('⌫')}
            onSubmit={() => pressKey('OK')}
            onHint={handleHint}
            isKuta={hintLevel === 2}
          />
        </Animated.View>

        {/* Chara - Always on top, with speech hint */}
        <Animated.View 
          style={[
            s.charaContainer, 
            { transform: [{ translateY: charaTranslateY }] }
          ]} 
          pointerEvents="none"
        >
          {closeHint && (
            <Animated.View 
              style={[
                s.charaSpeechBubble,
                {
                  opacity: charaSpeechAnim,
                  transform: [
                    { scale: charaSpeechAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                    { translateY: charaSpeechAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                    { rotate: '-10deg' }
                  ]
                }
              ]}
            >
              <Text style={[s.charaSpeechText, closeHint === 'いけ！' && { color: '#FFCC00' }]}>
                {closeHint}
              </Text>
            </Animated.View>
          )}
          <Chara width={120} height={120} />
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#4A1C53', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#4A1C53', width: '100%', maxWidth: 500 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  headerProgress: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  barContainer: {
    height: 40,
    justifyContent: 'center',
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redFlash: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,40,40,0.18)',
    zIndex: 50,
    pointerEvents: 'none',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  scrollContent: { padding: 16, paddingTop: 4, paddingBottom: 320 },
  progressWrapper: {
    height: 8,
    position: 'relative',
    justifyContent: 'center',
  },
  progressFillContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 8,
    overflow: 'hidden',
  },
  progressTextRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'flex-end',
    marginRight: 8,
  },
  progressNum: { 
    color: COLORS.green, 
    fontSize: 24, 
    fontFamily: 'Fredoka', 
    lineHeight: 28 
  },
  progressMu: { 
    color: '#5C5C5C', 
    fontSize: 14, 
    fontFamily: FONT.en, 
    lineHeight: 18 
  },
  progressTotal: { 
    color: '#5C5C5C', 
    fontSize: 18, 
    fontFamily: 'Fredoka', 
    lineHeight: 22 
  },
  
  cardWrapper: {
    position: 'relative',
    marginTop: 20,
    marginBottom: 40,
  },
  card: {
    backgroundColor: '#4A1C53',
    padding: 20, 
    paddingBottom: 5,
    borderTopWidth: 6,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 0,
    borderColor: '#70FF70',
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: 'visible',
  },
  fukidashiBottom: {
    marginTop: -3, 
    width: '100%',
    height: 78,
  },
  checkBadge: {
    position: 'absolute',
    top: -15,
    right: 30,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#70FF70',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  checkBadgeText: { fontSize: 20, color: '#70FF70', fontFamily: 'Fredoka' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 22, 
  },
  lvBadge: {
    backgroundColor: '#4A1C53',
    borderRadius: 15,
    paddingHorizontal: 10,
    height: 20, 
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#70FF70',
  },
  lvText: { 
    color: '#70FF70', 
    fontSize: 12, 
    fontFamily: 'Fredoka', // Explicitly set loaded font name
    lineHeight: 14,
  },
  timeBadge: {
    borderRadius: 15,
    paddingHorizontal: 10,
    height: 20, 
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeBadgeNew:    { backgroundColor: '#70FF70' },
  timeBadgeReview: { backgroundColor: '#70FF70' },
  timeBadgeRetry:  { backgroundColor: '#70FF70' },
  timeText: { 
    color: '#4A1C53', 
    fontSize: 12, 
    fontFamily: FONT.jpBd,
    lineHeight: 16,
  },
  jaText: { color: '#CAFFCA', fontSize: 18, lineHeight: 26, marginBottom: 16, fontFamily: FONT.jpBd },
  jaTextHighlight: { 
    color: '#70FF70', // Match brand green
    fontFamily: FONT.jpBd,
  },
  sentenceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 5,
    rowGap: 12, // Increased from 4 for more "living space"
  },
  enWord: {
    color: '#70FF70',
    fontSize: 24,
    lineHeight: 36, // Increased from 28
    fontFamily: 'Fredoka',
  },
  boxGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4, // Add small gap between words/boxes
  },
  blankBox: {
    height: 38, // Slightly taller to match new lineHeight
    minWidth: 70,
    backgroundColor: '#5C5C5C',
    borderRadius: 10,
    marginHorizontal: 4,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  blankBoxTyping:  { backgroundColor: '#5C5C5C' }, // Stay grey
  blankBoxCorrect: { backgroundColor: '#5C5C5C' }, // Stay grey
  blankBoxReview:  { backgroundColor: '#5C5C5C' }, // Stay grey
  blankBoxHint:    { backgroundColor: '#5C5C5C', borderWidth: 2, borderColor: '#70FF70' },
  blankText: { color: '#70FF70', fontSize: 24, textAlign: 'center', fontFamily: 'Fredoka' }, 
  blankTextEmpty: { color: 'rgba(112,255,112,0.2)' },
  blankTextCorrect: { color: '#70FF70' },
  blankTextReview:  { color: '#70FF70' },
  hintTyped: { color: '#70FF70' },
  hintRemain: { color: 'rgba(255,255,255,0.4)' },
  explainCard: {
    backgroundColor: 'rgba(8,20,8,0.9)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.15)',
    marginBottom: 10,
  },
  explainText: { color: '#999', fontSize: 14, lineHeight: 22 },
  nextBtn: {
    backgroundColor: '#6c47ff',
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  nextBtnText: { color: '#fff', fontSize: 17 },
  doneTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 30, fontFamily: FONT.jpBd },
  doneStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 40,
    width: '100%',
  },
  doneStat: { flex: 1, alignItems: 'center' },
  doneStatBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  doneStatNum: { color: '#70FF70', fontSize: 20, fontWeight: 'bold', marginBottom: 4, fontFamily: 'Fredoka' },
  doneStatUnit: { fontSize: 12, opacity: 0.6 },
  doneStatLabel: { color: '#999', fontSize: 11, fontFamily: FONT.jp },
  errorText: { color: '#ff4444', fontSize: 16, textAlign: 'center' },
  kbArea: {
    backgroundColor: '#240D28',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 20 : 5, 
    paddingHorizontal: 20, 
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  charaContainer: {
    position: 'absolute',
    bottom: 0,
    right: 15, // Slightly right (reduced from original 0 or earlier V2's offset)
    zIndex: 9999,
    elevation: 100,
  },
  charaSpeechBubble: {
    position: 'absolute',
    bottom: 120, 
    right: 35, // Adjusted to follow chara
    minWidth: 100,
    alignItems: 'center',
  },
  charaSpeechText: {
    color: '#c4b2ff',
    fontSize: 20,
    fontFamily: FONT.dot, 
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
});
