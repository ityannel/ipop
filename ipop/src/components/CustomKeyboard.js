import React, { useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, useWindowDimensions, Vibration, Platform } from 'react-native';

import KeyA      from '../keyboard/a.svg';
import KeyH      from '../keyboard/h.svg';
import KeyI      from '../keyboard/i.svg';
import KeyK      from '../keyboard/k.svg';
import KeyL      from '../keyboard/l.svg';
import KeyM      from '../keyboard/m.svg';
import KeyN      from '../keyboard/n.svg';
import KeyP      from '../keyboard/p.svg';
import KeyS      from '../keyboard/s.svg';
import KeyT      from '../keyboard/t.svg';
import KeyU      from '../keyboard/u.svg';
import KeyW      from '../keyboard/w.svg';
import KeyY      from '../keyboard/y.svg';
import KeyDelete from '../keyboard/delete.svg';
import KeyYa     from '../keyboard/ya.svg';
import KeyKita   from '../keyboard/kita.svg';
import KeyKuta   from '../keyboard/kuta.svg';

export default function CustomKeyboard({ onKeyPress, onDelete, onSubmit, onHint, isKuta }) {
  const [layoutWidth, setLayoutWidth] = useState(0);
  const windowWidth = useWindowDimensions().width;
  
  // Padding from screen edges
  const edgePadding = 4;
  const width = (layoutWidth || windowWidth) - (edgePadding * 2);
  
  // Margin per key
  const m = 1;

  // Base calculations for 5 columns - Smaller keys
  const keyWidth = (width / 5) - (2 * m);
  const keyHeight = keyWidth * 0.8;

  // Row 3 specific widths
  const row3Unit = (width - (4 * 2 * m)) / 5;
  const vowelWidth = row3Unit * 1.4;
  const deleteWidth = row3Unit * 0.8;

  // Kita width
  const kitaWidth = (keyWidth * 1.8) + (2 * m);


  const row1 = ['h', 'k', 'l', 'm', 'n'];
  const row2 = ['p', 's', 't', 'w', 'y'];
  const row3 = ['a', 'i', 'u'];

  const KeyMap = {
    a: KeyA, h: KeyH, i: KeyI, k: KeyK, l: KeyL, m: KeyM, n: KeyN,
    p: KeyP, s: KeyS, t: KeyT, u: KeyU, w: KeyW, y: KeyY
  };

  const triggerVibration = useCallback((type = 'normal') => {
    try {
      if (Platform.OS === 'android') {
        if (type === 'delete') {
          // Double pulse for backspace
          Vibration.vibrate([0, 10, 60, 10]);
        } else if (type === 'hint') {
          // Distinct slightly longer pulse for hint
          Vibration.vibrate(35);
        } else if (type === 'submit') {
          // "Sukon-sukon-sukon-sukon" - rhythmic and resonant
          // 20ms vibrate, 40ms pause x 4
          Vibration.vibrate([0, 20, 40, 20, 40, 20, 40, 20]);
        } else {
          // Standard quick pulse
          Vibration.vibrate(10);
        }
      } else {
        // iOS fallback
        Vibration.vibrate();
      }
    } catch (e) {
      // Ignore vibration errors
    }
  }, []);

  const handlePress = useCallback((key) => {
    triggerVibration('normal');
    onKeyPress(key);
  }, [onKeyPress, triggerVibration]);

  const handleDelete = useCallback(() => {
    triggerVibration('delete');
    onDelete();
  }, [onDelete, triggerVibration]);

  const handleSubmit = useCallback(() => {
    triggerVibration('submit');
    onSubmit();
  }, [onSubmit, triggerVibration]);

  const handleHint = useCallback(() => {
    triggerVibration('hint');
    onHint();
  }, [onHint, triggerVibration]);

  const renderKey = (key, w = keyWidth) => {
    const SvgKey = KeyMap[key];
    if (!SvgKey) return null;
    return (
      <TouchableOpacity 
        key={key} 
        onPress={() => handlePress(key)} 
        style={{ width: w, height: keyHeight, margin: m }}
        activeOpacity={0.7}
      >
        <SvgKey width={w} height={keyHeight} preserveAspectRatio="none" />
      </TouchableOpacity>
    );
  };

  return (
    <View 
      style={[styles.container, { paddingHorizontal: edgePadding }]} 
      onLayout={(e) => setLayoutWidth(e.nativeEvent.layout.width)}
    >
      {/* Hint Key */}
      <View style={styles.hintRow}>
        <TouchableOpacity 
          onPress={handleHint} 
          style={{ width: kitaWidth, height: keyHeight, margin: m }}
          activeOpacity={0.7}
        >
          {isKuta ? (
            <KeyKuta width={kitaWidth} height={keyHeight} />
          ) : (
            <KeyKita width={kitaWidth} height={keyHeight} />
          )}
        </TouchableOpacity>
      </View>

      {/* Letters Row 1 */}
      <View style={styles.row}>
        {row1.map(key => renderKey(key))}
      </View>

      {/* Letters Row 2 */}
      <View style={styles.row}>
        {row2.map(key => renderKey(key))}
      </View>

      {/* Row 3 (Vowels + Delete) */}
      <View style={styles.row}>
        {row3.map(key => renderKey(key, vowelWidth))}
        <TouchableOpacity 
          onPress={handleDelete} 
          style={{ width: deleteWidth, height: keyHeight, margin: m }}
          activeOpacity={0.7}
        >
          <KeyDelete width={deleteWidth} height={keyHeight} />
        </TouchableOpacity>
      </View>

      {/* Submit Key */}
      <View style={styles.submitRow}>
        <TouchableOpacity 
          onPress={handleSubmit} 
          style={{ width: width - (2 * m), height: keyHeight, margin: m }}
          activeOpacity={0.7}
        >
          <KeyYa width={width - (2 * m)} height={keyHeight} preserveAspectRatio="none" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 20,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    width: '100%',
  },
  hintRow: {
    flexDirection: 'row',
    width: '100%',
  },
  submitRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
    marginTop: 4,
  }
});
