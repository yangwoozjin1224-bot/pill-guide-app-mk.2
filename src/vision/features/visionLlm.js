/**
 * Observation-only vision LLM — extracts imprint/color/shape/score-line.
 * NEVER asks "what drug is this?" in this module.
 */

const OBSERVE_SYSTEM = `당신은 알약 이미지 관찰 도우미입니다.
약 이름을 추측하거나 추정하지 마세요. 보이는 특징만 JSON으로 보고하세요.
식약처 낱알식별 카테고리를 사용하세요.
색상: 하양,노랑,주황,분홍,빨강,갈색,연두,초록,청록,파랑,남색,보라,회색,검정,투명
모양: 원형,타원형,장방형,삼각형,사각형,마름모,오각형,육각형,팔각형,기타
응답은 JSON만: {
  "imprintFront": "각인 문자열 또는 빈 문자열",
  "imprintBack": "",
  "color": "색상",
  "shape": "모양",
  "scoreLine": true/false,
  "notes": "관찰 메모(이름 금지)"
}`;

function env(key, fallback = "") {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[key] != null) {
      return String(import.meta.env[key]);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function getVisionLlmConfig() {
  return {
    apiKey: env("VITE_VISION_LLM_KEY", ""),
    url: env("VITE_VISION_LLM_URL", "https://api.openai.com/v1/chat/completions"),
    model: env("VITE_VISION_LLM_MODEL", "gpt-4o-mini"),
  };
}

export function isVisionLlmConfigured() {
  return Boolean(getVisionLlmConfig().apiKey);
}

export function canvasToDataUrl(canvas, type = "image/jpeg", quality = 0.85) {
  if (!canvas) return null;
  if (typeof canvas.toDataURL === "function") return canvas.toDataURL(type, quality);
  return null;
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeObservation(obj) {
  if (!obj || typeof obj !== "object") return null;
  const imprintFront = String(obj.imprintFront || obj.imprint_front || obj.imprint || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const imprintBack = String(obj.imprintBack || obj.imprint_back || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return {
    imprintFront: imprintFront.length >= 1 ? imprintFront : "",
    imprintBack: imprintBack.length >= 1 ? imprintBack : "",
    color: String(obj.color || "").trim(),
    shape: String(obj.shape || "").trim(),
    scoreLine: Boolean(obj.scoreLine ?? obj.score_line),
    notes: String(obj.notes || "").slice(0, 200),
    source: "vision-llm",
  };
}

/**
 * Observe a single pill crop. Returns null if LLM not configured or request fails.
 */
export async function observePillFeatures(cropCanvas, options = {}) {
  const cfg = getVisionLlmConfig();
  if (!cfg.apiKey && !options.fetcher) return null;

  const dataUrl = canvasToDataUrl(cropCanvas);
  if (!dataUrl && !options.imageUrl) return null;

  const userText =
    options.prompt ||
    "이 알약 크롭 이미지에서 보이는 각인(앞), 색상, 모양, 분할선 유무만 관찰해 JSON으로 답하세요. 약 이름 추측 금지.";

  const messages = [
    { role: "system", content: OBSERVE_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        {
          type: "image_url",
          image_url: { url: options.imageUrl || dataUrl },
        },
      ],
    },
  ];

  try {
    let content = "";
    if (typeof options.fetcher === "function") {
      content = await options.fetcher({ messages, model: cfg.model });
    } else {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0,
          max_tokens: 300,
          messages,
        }),
      });
      if (!res.ok) {
        console.warn("[vision-llm] HTTP", res.status);
        return null;
      }
      const json = await res.json();
      content = json?.choices?.[0]?.message?.content || "";
    }
    return normalizeObservation(parseJsonLoose(content));
  } catch (e) {
    console.warn("[vision-llm] observe failed", e);
    return null;
  }
}

export { OBSERVE_SYSTEM, parseJsonLoose, normalizeObservation };
