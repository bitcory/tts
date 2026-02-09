import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";

let apiKey: string = process.env.API_KEY || '';
let ai: GoogleGenAI | null = apiKey ? new GoogleGenAI({ apiKey }) : null;

const ttsModelName = "gemini-2.5-flash-preview-tts";

export function setApiKey(key: string): void {
  apiKey = key;
  ai = key ? new GoogleGenAI({ apiKey: key }) : null;
}

export function getApiKey(): string {
  return apiKey;
}

function getAI(): GoogleGenAI {
  if (!ai) {
    throw new Error('API 키를 먼저 설정해주세요. 상단의 "API 키 설정" 버튼을 눌러주세요.');
  }
  return ai;
}
const transcriptionModelName = 'gemini-2.5-flash';

interface SpeechConfig {
  voiceConfig?: {
    prebuiltVoiceConfig: {
      voiceName: string;
    };
  };
  multiSpeakerVoiceConfig?: {
    speakerVoiceConfigs: {
      speaker: string;
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: string;
        };
      };
    }[];
  };
  languageCode?: string;
}

async function _generateAudio(prompt: string, speechConfig: SpeechConfig, signal?: AbortSignal): Promise<string> {
  try {
    const config: {
      responseModalities: Modality[];
      speechConfig: SpeechConfig;
    } = {
      responseModalities: [Modality.AUDIO],
      speechConfig: speechConfig,
    };

    const response: GenerateContentResponse = await getAI().models.generateContent({
      model: ttsModelName,
      contents: [{ parts: [{ text: prompt }] }],
      config: config,
    }, { signal });

    const audioPart = response.candidates?.[0]?.content?.parts.find(part => part.inlineData);
    const data = audioPart?.inlineData?.data;

    if (!data) {
      console.error("API response did not contain audio data:", response);
      throw new Error('오디오 생성에 실패했습니다. AI의 응답이 불완전합니다.');
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error("Error generating audio with Gemini API:", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI와 통신 중 오류가 발생했습니다: ${message}`);
  }
}

export const generateSingleSpeakerAudio = (prompt: string, voiceName: string, signal?: AbortSignal): Promise<string> => {
  const speechConfig: SpeechConfig = {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: voiceName,
      },
    },
    languageCode: 'ko-KR',
  };
  return _generateAudio(prompt, speechConfig, signal);
};

export const previewVoice = (voiceName: string): Promise<string> => {
  const sampleText = `안녕하세요, 여러분은 이제부터 이 목소리로 멋진 오디오 콘텐츠를 만들 수 있습니다.`;
  // Preview does not need to be cancellable
  return generateSingleSpeakerAudio(sampleText, voiceName);
};

export const transcribeAudioWithSrt = async (
  base64Wav: string,
  splitCharCount: number,
  signal?: AbortSignal,
  referenceText?: string
): Promise<string> => {
  try {
    const audioPart = {
      inlineData: {
        mimeType: 'audio/wav',
        data: base64Wav,
      },
    };

    let promptText = `역할: 전문 자막 제작자 (Professional Subtitler)
목표: 오디오 파일에 딱 맞는 정밀한 SRT 자막 생성

**기본 기술 규칙:**
1. **포맷 준수:** 표준 SubRip(.srt) 형식을 엄격히 따르세요.
   (형식: 순번 -> 시간(hh:mm:ss,ms --> hh:mm:ss,ms) -> 내용 -> 빈 줄)
2. **타임스탬프 정밀도:** 오디오 파형의 시작과 끝을 밀리초 단위로 정확히 포착하세요.
3. **출력:** 코드 블록(\`\`\`srt) 안에 SRT 내용만 출력하세요. 사족은 금지합니다.`;

    if (referenceText) {
      promptText += `

**[모드: 강제 정렬 (Forced Alignment)]**
제공된 **참조 스크립트**가 이 오디오의 정확한 대본(정답지)입니다.
당신의 임무는 받아쓰기가 아니라, **참조 스크립트의 각 줄이 오디오의 어느 시간대에 위치하는지 정확히 매핑**하는 것입니다.

**★ 중요 타임코드 지침 (반드시 준수):**
1. **첫 문장 시작 보정 (0초 시작):** 
   - 이 오디오는 TTS(음성 합성) 결과물이므로, **첫 번째 문장은 무조건 00:00:00,000에서 시작**해야 합니다.
   - 오디오 초반에 아주 미세한 무음이 있더라도, 첫 자막은 0초부터 시작하도록 강제하세요. 절대 첫 문장의 앞부분을 놓치거나 늦게 시작하지 마세요.

2. **문장 간 겹침 방지 (No Overlaps):**
   - **(N)번째 자막의 시작 시간**은 반드시 **(N-1)번째 자막의 종료 시간 이후**여야 합니다.
   - **문제가 되는 현상:** 다음 문장의 자막이 이전 문장의 음성이 끝나기도 전에 미리 나오는 현상을 절대적으로 방지하세요.
   - **해결책:** 문장 사이에 호흡이 있다면 그 구간은 자막을 비워두고, **확실하게 이전 음성이 끝난 후**에 다음 타임코드를 시작하세요. 필요하다면 0.1~0.2초 정도의 간격을 두어 분리하세요.

3. **텍스트 무결성:**
   - 참조 스크립트의 문장 구조와 내용을 그대로 사용하세요. (임의 수정 금지)
   - 단, 한 줄이 너무 길면(${splitCharCount}자 이상) 오디오 호흡에 맞춰 자연스럽게 두 줄로 나누세요.

**[참조 스크립트]:**
${referenceText}`;
    } else {
      promptText += `

**[모드: 일반 전사 (Transcription)]**
1. 오디오를 듣고 내용을 정확하게 한국어로 받아쓰세요.
2. 문맥에 맞게 자연스럽게 줄을 나누어 자막을 생성하세요.
3. 자막 한 줄은 최대 ${splitCharCount}자를 넘지 않도록 하세요.
`;
    }

    promptText += `

**출력 예시:**
1
00:00:00,000 --> 00:00:02,150
안녕하세요! 툴비 스튜디오입니다.

2
00:00:02,250 --> 00:00:05,100
여러분의 음성녹음을 도와드리겠습니다.
`;

    const textPart = { text: promptText };

    const response: GenerateContentResponse = await getAI().models.generateContent({
      model: transcriptionModelName,
      contents: { parts: [audioPart, textPart] },
    }, { signal });

    let srtText = response.text?.trim() ?? '';
    // Use a regex to robustly extract content within \`\`\`srt ... \`\`\` or \`\`\` ... \`\`\` blocks,
    // ignoring any surrounding text from the model.
    const match = srtText.match(/```(?:srt)?\s*([\s\S]*?)```/);
    if (match && match[1]) {
      srtText = match[1].trim();
    }

    return srtText;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error("Error transcribing audio with Gemini API:", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AI를 이용한 음성 분석 중 오류가 발생했습니다: ${message}`);
  }
};