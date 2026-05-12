require('dotenv').config();
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('./serviceAccountKey.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const grammarSpec = fs.readFileSync(path.join(__dirname, 'i-tya-grammar.txt'), 'utf8');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const epopModel = genAI.getGenerativeModel({
  model: 'gemini-3.1-flash-lite', 
  systemInstruction: `あなたは人工言語「i-tya」の学習アプリ「ipop」の専属AIです。以下の文法仕様に厳密に従ってください。\n\n${grammarSpec}`
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runInfiniteLoop() {
  while (true) {
    const [wordsSnap, complexSnap, questionsSnap ] = await Promise.all([
        db.collection('itya_words').get(),
        db.collection('itya_complex').get(),
        db.collection('epop_questions').get()
    ]);

    const allWords = [
      ...wordsSnap.docs.map(d => ({ id: d.id, ...d.data(), type: 'word' })),
      ...complexSnap.docs.map(d => ({ id: d.id, ...d.data(), type: 'complex' }))
    ];
    const existingIds = new Set(questionsSnap.docs.map(d => d.id));
    const missingWords = allWords.filter(w => !existingIds.has(w.id));

    if (missingWords.length === 0) {
      process.exit(0);
    }

    const dictListStr = allWords.map(w => `${w.word_noun || w.combination || w.root}: ${w.concept_ja || w.meaning}`).join(', ');

    for (const word of missingWords) {
      const wordName = word.concept_ja || word.meaning;
      const wordLevel = word.level || (word.type === 'complex' ? 2 : 1);
      const forms = [word.word_noun, word.word_verb, word.word_extender, word.combination].filter(Boolean).join(', ');

      const prompt = `以下の単語の穴埋め問題を必ずJSON形式のみで出力してください。Markdownのコードブロック( \`\`\`json など )は使用しないでください。
      概念: ${wordName}, レベル: ${wordLevel}, 形態: ${forms}
      【辞書リスト】: ${dictListStr}

      出力形式は以下のJSON構造に厳密に従うこと：
      {
        "example": "i-tya言語での例文",
        "example_reading": "例文の読み方(カタカナ)",
        "example_translation": "例文の日本語訳",
        "translation_blank": "example_translationの中でanswerに対応する日本語の単語または句をそのまま抜き出したもの（必ずexample_translationに含まれる部分文字列）",
        "blank": "穴埋めにする単語（かならず、単語の一部などではなく単語の全部です。）",
        "explanation": "問題の解説",
        "answer": "正解の単語"
      }`;

      try {
        const result = await epopModel.generateContent(prompt);
        let text = result.response.text();
        
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("JSONNotFound");
        
        const parsed = JSON.parse(jsonMatch[0]);

        if (!parsed.example || parsed.example.includes("エラー") || parsed.example === "例文生成エラー") {
            throw new Error("InvalidExample");
        }

        await db.collection('epop_questions').doc(word.id).set({
            example:             parsed.example,
            example_reading:     parsed.example_reading,
            example_translation: parsed.example_translation,
            translation_blank:   parsed.translation_blank ?? null,
            blank:               parsed.blank,
            explanation:         parsed.explanation,
            answer:              parsed.answer,
            wordId:              word.id,
            generatedAt:         admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(wordName);
        await sleep(3000); 

      } catch (err) {
        console.error(err.message);
        await sleep(5000);
        continue;
      }
    }
  }
}

runInfiniteLoop();