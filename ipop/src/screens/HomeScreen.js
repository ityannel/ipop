import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, useWindowDimensions,
  PanResponder, SafeAreaView, Pressable, Easing
} from 'react-native';
import Svg, { Defs, ClipPath, Path, G, Pattern, Rect, Circle, Text as SvgText } from 'react-native-svg';

import Katati1    from '../katati1.svg';
import Katati2    from '../katati2.svg';
import Katati3    from '../katati3.svg';
import Katati4    from '../katati4.svg';
import Chara      from '../chara.svg';
import IpopLogo   from '../ipop.svg';

import { fetchStats } from '../services/api';
import { FONT, COLORS } from '../constants/theme';

const C = COLORS;

// 編集用要素コンポーネント
function AdjustableElement({ 
  id, config, setConfig, isEditMode, isSelected, onSelect, children, 
  style: extraStyle, ratio = 1
}) {
  const pan = useRef(new Animated.ValueXY({ x: config.x * ratio, y: config.y * ratio })).current;
  const isDragging = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!isDragging.current) {
      pan.setValue({ x: config.x * ratio, y: config.y * ratio });
    }
  }, [config.x, config.y, ratio]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => isEditMode,
    onMoveShouldSetPanResponder: (evt, gs) => isEditMode && (Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      isDragging.current = true;
      onSelect(id);
      pan.setOffset({ x: configRef.current.x * ratio, y: configRef.current.y * ratio });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (evt, gs) => {
      pan.setValue({ x: gs.dx, y: gs.dy });
    },
    onPanResponderRelease: (evt, gs) => {
      isDragging.current = false;
      pan.flattenOffset();
      setConfig(prev => ({
        ...prev,
        [id]: { 
          ...prev[id], 
          x: (configRef.current.x * ratio + gs.dx) / ratio, 
          y: (configRef.current.y * ratio + gs.dy) / ratio 
        }
      }));
    },
    onPanResponderTerminate: () => {
      isDragging.current = false;
      pan.flattenOffset();
    },
  })).current;

  const startScale = useRef(1);
  const startValue = useRef(0);
  const resizePanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => isEditMode,
    onStartShouldSetPanResponderCapture: () => isEditMode,
    onMoveShouldSetPanResponder: () => isEditMode,
    onMoveShouldSetPanResponderCapture: () => isEditMode,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      if (evt.stopPropagation) evt.stopPropagation();
      isDragging.current = true;
      onSelect(id);
      startScale.current = configRef.current.s;
      startValue.current = configRef.current.v ?? 0;
    },
    onPanResponderMove: (evt, gs) => {
      if (!isEditMode) return;
      const newScale = Math.max(0.1, startScale.current * (1 + gs.dx / (150 * ratio)));
      const hasValue = configRef.current.v !== undefined;
      const newValue = hasValue ? Math.max(0, Math.floor(startValue.current - gs.dy / (5 * ratio))) : undefined;

      setConfig(prev => ({ 
        ...prev, 
        [id]: { 
          ...prev[id], 
          s: newScale,
          ...(hasValue ? { v: newValue } : {})
        } 
      }));
    },
    onPanResponderRelease: (evt, gs) => {
      isDragging.current = false;
      const finalScale = Math.max(0.1, startScale.current * (1 + gs.dx / (150 * ratio)));
      const hasValue = configRef.current.v !== undefined;
      const finalValue = hasValue ? Math.max(0, Math.floor(startValue.current - gs.dy / (5 * ratio))) : undefined;

      setConfig(prev => ({ 
        ...prev, 
        [id]: { 
          ...prev[id], 
          s: finalScale,
          ...(hasValue ? { v: finalValue } : {})
        } 
      }));
    },
    onPanResponderTerminate: () => { isDragging.current = false; },
  })).current;

  return (
    <Animated.View 
      pointerEvents={isEditMode ? 'auto' : 'box-none'}
      style={[{ position: 'absolute', transform: pan.getTranslateTransform(), zIndex: isSelected ? 100 : 10 }, extraStyle, isEditMode && isSelected && styles.selectedBorder]} 
      {...panResponder.panHandlers}
    >
      <View pointerEvents={isEditMode ? 'none' : 'auto'}>{children}</View>
      {isEditMode && isSelected && (
        <>
          <DebugInfo config={config} />
          <View style={styles.resizeHandle} {...resizePanResponder.panHandlers}>
            <Text style={{ fontSize: 18, color: '#fff', fontWeight: 'bold' }}>⤡</Text>
          </View>
        </>
      )}
    </Animated.View>
  );
}

// 編集モード用デバッグ表示
function DebugInfo({ config }) {
  return (
    <View style={styles.debugLabel}>
      <Text style={styles.debugText}>S: {config.s.toFixed(2)}</Text>
      {config.v !== undefined && <Text style={styles.debugText}>V: {config.v}</Text>}
    </View>
  );
}

// 縁取りテキスト (SVG)
function HollowText({ children, fontSize, strokeColor, strokeWidth = 2, style, fill = "none" }) {
  const width = fontSize * 0.8 * String(children).length + strokeWidth * 2;
  const height = fontSize * 1.2;
  return (
    <View style={[{ width, height }, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <SvgText x={width / 2} y={height * 0.8} fontSize={fontSize} fontFamily={FONT.en} fill={fill} stroke={strokeColor} strokeWidth={strokeWidth} textAnchor="middle">
          {children}
        </SvgText>
      </Svg>
    </View>
  );
}

// 学習進捗グラフ
function MaskedGraph({ stats, config, size = 160 }) {
  const GRAPH_PATH_D = 'M175.5 85.5C167 134.5 135.761 164.395 87.75 171C40.5 177.5 0 153 0 85.5C0 71.5 39.287 0 87.75 0C186.5 0 175.5 38.2797 175.5 85.5Z';
  
  const total    = 100;
  const learned  = config?.v ?? Math.round(((stats?.learnedCount ?? 0) / Math.max(stats?.totalWords ?? 1, 1)) * 100); 
  const mature   = Math.round(learned * 0.6);
  const learning = learned - mature;

  const getCoord = (deg) => {
    const rad = (deg - 90) * (Math.PI / 180);
    return { x: 88 + 120 * Math.cos(rad), y: 86 + 120 * Math.sin(rad) };
  };

  const createSector = (startDeg, endDeg) => {
    const angle = endDeg - startDeg;
    if (angle >= 359.9) return "M88,86 m-120,0 a120,120 0 1,0 240,0 a120,120 0 1,0 -240,0";
    if (angle <= 0) return "";
    const p1 = getCoord(startDeg);
    const p2 = getCoord(endDeg);
    const largeArc = angle > 180 ? 1 : 0;
    return `M88,86 L${p1.x},${p1.y} A120,120 0 ${largeArc},1 ${p2.x},${p2.y} Z`;
  };

  const matureDeg   = (mature / total) * 360;
  const learningDeg = (learning / total) * 360;

  return (
    <View style={{ width: size, height: size * (172/176) }}>
      <Svg width="100%" height="100%" viewBox="0 0 176 172">
        <Defs>
          <Pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Rect width="1.2" height="4" fill={C.green} />
          </Pattern>
          <Pattern id="dots" width="5" height="8" patternUnits="userSpaceOnUse">
             <Circle cx="1.2" cy="2" r="0.7" fill={C.green} />
             <Circle cx="3.7" cy="6" r="0.7" fill={C.green} />
          </Pattern>
          <ClipPath id="graphClip"><Path d={GRAPH_PATH_D} /></ClipPath>
        </Defs>
        <Path d={GRAPH_PATH_D} fill={C.bg} />
        <G clipPath="url(#graphClip)">
          {mature > 0 && <Path d={createSector(0, matureDeg)} fill="url(#hatch)" />}
          {learning > 0 && <Path d={createSector(matureDeg, matureDeg + learningDeg)} fill="url(#dots)" />}
          <Path d={createSector(matureDeg + learningDeg, 360)} fill={C.bg} />
        </G>
      </Svg>
    </View>
  );
}

export default function HomeScreen({ onStartStudy }) {
  const { width: windowWidth } = useWindowDimensions();
  const BASE_WIDTH = 375;
  const cardWidth = Math.min(windowWidth, 500) * 0.94; 
  const ratio = cardWidth / BASE_WIDTH;

  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const op1 = useRef(new Animated.Value(1)).current;
  const op2 = useRef(new Animated.Value(1)).current;
  const op3 = useRef(new Animated.Value(1)).current;
  const spinValue = useRef(new Animated.Value(0)).current;

  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [cfg, setConfig] = useState({
    k1:          { x: 1.995, y: 21.4968, s: 1.0 },
    numNew:      { x: 271.3437, y: 122.3829, s: 1.0, v: 5 },
    numDue:      { x: 299.8281, y: 170.4687, s: 1.0, v: 2 },
    chara:       { x: 3.8425, y: 149.2968, s: 190 },
    k2:          { x: 200.5, y: 253.6, s: 155 },
    streak:      { x: 200.3701, y: 244.0031, s: 1.0, v: 23 },
    k3:          { x: 2.21, y: 338, s: 1.0 },
    pct:         { x: 60.5625, y: 360.4468, s: 1.0, v: 64 },
    graph:       { x: 164.125, y: 393.6281, s: 1.0 },
  });

  useEffect(() => {
    fetchStats().then(d => {
      if (d && d.stats) {
        setStats(d.stats);
        setConfig(prev => ({
          ...prev,
          numNew: { ...prev.numNew, v: d.stats.newCount },
          numDue: { ...prev.numDue, v: d.stats.dueCount },
          streak: { ...prev.streak, v: d.stats.streak },
          pct:    { ...prev.pct,    v: Math.round(((d.stats.learnedCount ?? 0) / Math.max(d.stats.totalWords ?? 1, 1)) * 100) }
        }));
      }
    }).catch(e => {
      console.error('[API] fetchStats error:', e);
    }).finally(() => {
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    if (isLoading) {
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
  }, [isLoading]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['-15deg', '15deg'],
  });

  const onPressIn = (op) => {
    if (isEditMode) return;
    Animated.timing(op, { toValue: 0.5, duration: 80, useNativeDriver: true }).start();
  };
  const onPressOut = (op, action) => {
    if (isEditMode) return;
    Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }).start(() => action && action());
  };

  if (isLoading) return (
    <View style={styles.loadingRoot}>
      <IpopLogo width={200} height={80} />
      <Animated.View style={{ transform: [{ translateY: -90 }, { rotate: spin }, { translateY: 90 }] }}>
        <Chara width={180} height={180} />
      </Animated.View>
    </View>
  );

  const engagedCount = (stats?.learnedCount ?? 0);
  const masteryRate = stats ? Math.round((engagedCount / Math.max(stats.totalWords, 1)) * 100) : 0;

  return (
    <SafeAreaView style={styles.outer}>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <View style={{ width: cardWidth, height: 850 * ratio }}>
          
          {/* 進捗セクション */}
          <Animated.View pointerEvents="box-none" style={[styles.abs, { opacity: op3, zIndex: 10 }]}>
            <AdjustableElement id="k3" config={cfg.k3} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'k3'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op3)} onPressOut={() => onPressOut(op3)} disabled={isEditMode}>
                <Katati3 width={cardWidth * cfg.k3.s} height={cardWidth * cfg.k3.s * (238/345)} />
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="pct" config={cfg.pct} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'pct'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op3)} onPressOut={() => onPressOut(op3)} disabled={isEditMode}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Text style={[styles.progressPct, { fontSize: 64 * cfg.pct.s * ratio }]}>{isEditMode ? cfg.pct.v : masteryRate}</Text>
                    <Text style={[styles.progressPct, { fontSize: 24 * cfg.pct.s * ratio, marginLeft: 2 * ratio, marginTop: 14 * ratio }]}>%</Text>
                  </View>
                  <Text style={[styles.progressLab, { fontSize: 18 * cfg.pct.s * ratio, marginTop: -5 * cfg.pct.s * ratio }]}>学習済み</Text>
                </View>
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="graph" config={cfg.graph} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'graph'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op3)} onPressOut={() => onPressOut(op3)} disabled={isEditMode}>
                <MaskedGraph stats={stats} config={isEditMode ? cfg.pct : null} size={cardWidth * 0.54 * cfg.graph.s} />
              </Pressable>
            </AdjustableElement>
          </Animated.View>

          {/* キャラクターセクション */}
          <AdjustableElement id="chara" config={cfg.chara} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'chara'} onSelect={setSelectedId} ratio={ratio}>
            <Chara width={cfg.chara.s * ratio} height={cfg.chara.s * ratio} />
          </AdjustableElement>

          {/* ストリークセクション */}
          <Animated.View pointerEvents="box-none" style={[styles.abs, { opacity: op2, zIndex: 20 }]}>
            <AdjustableElement id="k2" config={cfg.k2} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'k2'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op2)} onPressOut={() => onPressOut(op2)} disabled={isEditMode}>
                <Katati2 width={cfg.k2.s * ratio} height={cfg.k2.s * ratio * (147/175)} />
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="streak" config={cfg.streak} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'streak'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op2)} onPressOut={() => onPressOut(op2)} disabled={isEditMode}>
                <View style={[styles.streakInner, { width: cfg.k2.s * ratio, height: cfg.k2.s * ratio * (147/175), flexDirection: 'row', alignItems: 'center' }]}>
                  {(isEditMode ? cfg.streak.v : (stats?.streak ?? 0)) > 0 ? (
                    <>
                      <Text style={{ fontSize: 24 * cfg.streak.s * ratio, marginRight: 6 * ratio }}>🔥</Text>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={[styles.streakNum, { fontSize: 52 * cfg.streak.s * ratio, color: C.green }]}>{isEditMode ? cfg.streak.v : (stats?.streak)}</Text>
                        <Text style={[styles.streakLab, { fontSize: 16 * cfg.streak.s * ratio, color: C.green }]}>日連続！</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={{ fontSize: 24 * cfg.streak.s * ratio, marginRight: 6 * ratio }}>🌱</Text>
                      <View style={{ alignItems: 'center' }}>
                        <Text style={{ fontSize: 16 * cfg.streak.s * ratio, color: C.green, fontFamily: FONT.jpBd }}>
                          {(!isEditMode && stats?.lastActivityDate) ? 'あら、' : 'まだ、'}
                        </Text>
                        <Text style={{ fontSize: 48 * cfg.streak.s * ratio, color: C.green, fontFamily: FONT.en, marginTop: -2 * ratio }}>0</Text>
                      </View>
                    </>
                  )}
                </View>
              </Pressable>
            </AdjustableElement>
          </Animated.View>

          {/* メインアクションセクション */}
          <Animated.View pointerEvents="box-none" style={[styles.abs, { opacity: op1, zIndex: 30 }]}>
            <AdjustableElement id="k1" config={cfg.k1} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'k1'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op1)} onPressOut={() => onPressOut(op1, onStartStudy)} disabled={isEditMode}>
                <Katati1 width={cardWidth * cfg.k1.s} height={cardWidth * cfg.k1.s * (245/369)} />
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="numNew" config={cfg.numNew} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'numNew'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op1)} onPressOut={() => onPressOut(op1, onStartStudy)} disabled={isEditMode}>
                <HollowText fontSize={52 * cfg.numNew.s * ratio} strokeColor={C.bg} strokeWidth={2.4 * ratio}>{isEditMode ? cfg.numNew.v : (stats?.newCount ?? 5)}</HollowText>
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="numDue" config={cfg.numDue} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'numDue'} onSelect={setSelectedId} ratio={ratio}>
              <Pressable onPressIn={() => onPressIn(op1)} onPressOut={() => onPressOut(op1, onStartStudy)} disabled={isEditMode}>
                <Text style={[styles.pillNumSolid, { fontSize: 52 * cfg.numDue.s * ratio, textAlign: 'center' }]}>{isEditMode ? cfg.numDue.v : (stats?.dueCount ?? 2)}</Text>
              </Pressable>
            </AdjustableElement>
          </Animated.View>

        </View>
      </View>

      <View style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 200, flexDirection: 'row', gap: 10 }}>
        {isEditMode && (
          <TouchableOpacity style={{ backgroundColor: COLORS.purple, padding: 12, borderRadius: 30 }} onPress={() => console.log('FINAL_CONFIG:', JSON.stringify(cfg, null, 2))}>
            <Text style={{ fontSize: 12, color: '#fff' }}>Config出力</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={{ backgroundColor: isEditMode ? COLORS.green : '#fff', padding: 12, borderRadius: 30 }} onPress={() => { setIsEditMode(!isEditMode); setSelectedId(null); }}>
          <Text style={{ fontSize: 12, color: isEditMode ? '#fff' : '#000' }}>{isEditMode ? '編集終了' : 'UI調整器'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.bg },
  abs: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  loadingRoot: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  loadingLogo: { color: C.green, fontSize: 72, fontFamily: FONT.en, marginBottom: 40 },
  selectedBorder: { borderWidth: 1, borderColor: COLORS.green, borderStyle: 'dashed' },
  resizeHandle: { position: 'absolute', right: -15, bottom: -15, width: 30, height: 30, backgroundColor: COLORS.green, borderRadius: 15, justifyContent: 'center', alignItems: 'center', zIndex: 200 },
  streakInner: { alignItems: 'center', justifyContent: 'center', paddingTop: 10 },
  streakNum: { color: C.bg, ...FONT.enVar, marginTop: -5 },
  streakLab: { color: C.bg, fontFamily: FONT.jpBd, marginTop: -8 },
  pillNumSolid: { color: C.bg, ...FONT.enVar },
  progressPct: { color: C.dark, ...FONT.enVar },
  progressLab: { color: C.dark, fontFamily: FONT.jpBd },
  debugLabel: { position: 'absolute', top: -45, left: 0, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, zIndex: 210 },
  debugText: { color: '#fff', fontSize: 10, fontFamily: 'monospace' },
});
