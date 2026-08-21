/**
 * Fallback multimodal: guess drug name ONLY when DB match returned 0 candidates.
 * Always sets lowAccuracy flag for UI.
 */

import { canvasToDataUrl, getVisionLlmConfig, parseJsonLoose } from "../features/visionLlm.js";

const FALLBACK_SYSTEM = `당신은 의약품 식별 보조입니다.
식약처 DB 매칭이 실패한 경우에만 호출됩니다.
가능한 약 이름 후보를 JSON으로 제안하되, 확신도가 낮음을 명시하세요.
응답 JSON만: {
  "guesses": [{"name":"약이름","confidence":0.0~1.0,"reason":"근거"}],
  "warning": "정확도가 낮을 수 있습니다"
}`;

/**
 * @returns {Promise<null | { guesses: array, lowAccuracy: true, warning: string }>}
 */
export async function fallbackMultimodalGuess(cropCanvas, features = {}, options = {}) {
  const cfg = getVisionLlmConfig();
  if (!cfg.apiKey && !options.fetcher) return null;

  const dataUrl = canvasToDataUrl(cropCanvas);
  if (!dataUrl && !options.imageUrl) return null;

  const featText = [
    features.imprintFront && `각인(앞): ${features.imprintFront}`,
    features.imprintBack && `각인(뒤): ${features.imprintBack}`,
    features.color && `색상: ${features.color}`,
    features.shape && `모양: ${features.shape}`,
    features.scoreLine != null && `분할선: ${features.scoreLine ? "있음" : "없음"}`,
  ]
    .filter(Boolean)
    .join(", ");

  const messages = [
    { role: "system", content: FALLBACK_SYSTEM },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `DB 매칭 실패. 추출 특징: ${featText || "없음"}. 가능한 국내 알약 이름 후보를 최대 3개 제안하세요.`,
        },
        { type: "image_url", image_url: { url: options.imageUrl || dataUrl } },
      ],
    },
  ];

  try {
    let content = "";
    if (typeof options.fetcher === "function") {
      content = await options.fetcher({ messages, model: cfg.model, mode: "fallback" });
    } else {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          max_tokens: 400,
          messages,
        }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      content = json?.choices?.[0]?.message?.content || "";
    }

    const parsed = parseJsonLoose(content) || {};
    const guesses = Array.isArray(parsed.guesses)
      ? parsed.guesses
          .map((g) => ({
            name: String(g.name || "").trim(),
            confidence: Math.min(0.5, Number(g.confidence) || 0.25),
            reason: String(g.reason || ""),
          }))
      .filter((g) => g.name)
      .slice(0, 3)
      : [];

    if (!guesses.length) return null;

    return {
      guesses,
      lowAccuracy: true,
      warning: parsed.warning || "정확도가 낮을 수 있습니다",
      source: "multimodal-fallback",
    };
  } catch (e) {
    console.warn("[fallback-llm] failed", e);
    return null;
  }
}
