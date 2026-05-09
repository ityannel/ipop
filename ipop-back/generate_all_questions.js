require('dotenv').config();
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// ■ Firebase初期化
const serviceAccount = require('./serviceAccountKey.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ■ 各種設定
const grammarSpec = fs.readFileSync(path.join(__dirname, 'i-tya-grammar.txt'), 'utf8');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const epopModel = genAI.getGenerativeModel({
  model: 'gemini-3.1-flash-lite', 
  systemInstruction: `あなたは人工言語「i-tya」の学習アプリ「ipop」の専属AIです。以下の文法仕様に厳密に従ってください。\n\n${grammarSpec}`
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runInfiniteLoop() {
  const startTime = Date.now();
  console.log("▶ ミッション開始：一括生成処理を実行します。");

  while (true) {
    const [wordsSnap, complexSnap, questionsSnap ] = await Promise.all([
        db.collection('itya_words').get(),
        db.collection('itya_complex').get(),
        db.collection('epop_questions').get(); 
    ]);

    const allWords = [
      ...wordsSnap.docs.map(d => ({ id: d.id, ...d.data(), type: 'word' })),
      ...complexSnap.docs.map(d => ({ id: d.id, ...d.data(), type: 'complex' }))
    ];
    const questionsSnap = await db.collection('epop_questions').get(); 
    const existingIds = new Set(questionsSnap.docs.map(d => d.id));
    const missingWords = allWords.filter(w => !existingIds.has(w.id));

    // ■ すべての問題が生成完了した場合
    if (missingWords.length === 0) {
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      const hours = Math.floor(durationMs / 3600000);
      const minutes = Math.floor((durationMs % 3600000) / 60000);
      
      console.log("\n========================================");
      console.log("■ 処理完了：全単語の生成が終了しました。");
      console.log(`■ 終了時刻: ${new Date().toLocaleString('ja-JP')}`);
      console.log(`■ 所要時間: ${hours}時間 ${minutes}分`);
      console.log("========================================\n");
      process.exit(0);
    }

    console.log(`\n[進捗] 残り ${missingWords.length} 問。未完了分を生成します。`);
    const dictListStr = allWords.map(w => `${w.word_noun || w.combination || w.root}: ${w.concept_ja || w.meaning}`).join(', ');

    for (const word of missingWords) {
      const wordName = word.concept_ja || word.meaning;
      const wordLevel = word.level || (word.type === 'complex' ? 2 : 1);
      const forms = [word.word_noun, word.word_verb, word.word_extender, word.combination].filter(Boolean).join(', ');

      const prompt = `以下の単語の穴埋め問題をJSON形式で作成してください。\n概念: ${wordName}, レベル: ${wordLevel}, 形態: ${forms}\n【辞書リスト】: ${dictListStr}`;

      try {
        const result = await epopModel.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("JSONが見つかりません。");
        
        const parsed = JSON.parse(jsonMatch[0]);

        // ■ 重要なガード：AIが「エラー」や「不明」を返してきたら保存せずにやり直す
        if (!parsed.example || parsed.example.includes("エラー") || parsed.example === "例文生成エラー") {
            throw new Error("AIが有効な例文を生成できませんでした。リトライします。");
        }

        await db.collection('epop_questions').doc(word.id).set({
            question: { 
            example: parsed.example, 
            example_reading: parsed.example_reading, 
            example_translation: parsed.example_translation, 
            blank: parsed.blank, 
            explanation: parsed.explanation 
            },
            answer: parsed.answer,
            wordId: word.id,
            generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`[成功] ${wordName}`);
        await sleep(3000); 

        } catch (err) {
        // エラー時は保存せずに次のループ（またはリトライ）へ
        console.error(`[待機中] ${wordName} の生成に失敗しました: ${err.message}`);
        await sleep(20000); // 20秒待機して冷却
        break; // whileの先頭に戻ってリストを再取得
        }
    }
  }
}

runInfiniteLoop();