import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('API_KEY 환경변수를 설정해주세요.');
  console.error('사용법: API_KEY=your_key node scripts/generate-previews.mjs');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const MODEL = 'gemini-2.5-flash-preview-tts';
const SAMPLE_TEXT = '안녕하세요, 여러분은 이제부터 이 목소리로 멋진 오디오 콘텐츠를 만들 수 있습니다.';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'previews');

const VOICES = [
  'Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina',
  'Erinome', 'Laomedeia', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat',
  'Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel',
  'Algieba', 'Algenib', 'Rasalgethi', 'Achernar', 'Alnilam', 'Schedar',
  'Achird', 'Zubenelgenubi', 'Sadachbia', 'Sadaltager'
];

function base64PcmToWavBuffer(base64Pcm) {
  const pcm = Buffer.from(base64Pcm, 'base64');
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

async function generatePreview(voiceName) {
  const outPath = path.join(OUTPUT_DIR, `${voiceName}.wav`);

  // Skip if already exists
  if (fs.existsSync(outPath)) {
    console.log(`  [SKIP] ${voiceName}.wav already exists`);
    return;
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ parts: [{ text: SAMPLE_TEXT }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName }
        },
        languageCode: 'ko-KR'
      }
    }
  });

  const audioPart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!audioPart?.inlineData?.data) {
    throw new Error(`No audio data for ${voiceName}`);
  }

  const wav = base64PcmToWavBuffer(audioPart.inlineData.data);
  fs.writeFileSync(outPath, wav);
  console.log(`  [OK] ${voiceName}.wav (${(wav.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Generating ${VOICES.length} voice previews...\n`);

  let success = 0;
  let fail = 0;

  for (const voice of VOICES) {
    try {
      await generatePreview(voice);
      success++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`  [FAIL] ${voice}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone! Success: ${success}, Failed: ${fail}`);
}

main();
