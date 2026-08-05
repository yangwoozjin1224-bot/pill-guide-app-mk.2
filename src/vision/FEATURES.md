# 각인 기반 DB 매칭 파이프라인

## 역할 분리

| 단계 | 모듈 | 역할 |
|------|------|------|
| 1. 분리 | `detectors/` | OpenCV-style(adaptive+contour+watershed) / YOLO stub |
| 2. 특징 | `features/` | OCR + CV(색/모양/분할선) + **관찰용** 비전 LLM |
| 3. 매칭 | `match/` | 식약처 낱알식별 API — 각인 1차 → 색/모양 2차 + 캐시 |
| 4. 폴백 | `match/fallbackLlm.js` | 후보 0개일 때만 이름 추측 LLM (`lowAccuracy: true`) |

## 신뢰도

1. 각인 완전 일치 (앞/뒤)
2. 각인 부분 일치
3. 색상+모양만 일치

## 환경 변수

```
VITE_API_KEY=...                 # data.go.kr 서비스키
VITE_VISION_LLM_KEY=...          # 관찰/폴백 비전 LLM (선택)
VITE_VISION_LLM_URL=https://api.openai.com/v1/chat/completions
VITE_VISION_LLM_MODEL=gpt-4o-mini
```

API 키는 [data.go.kr](https://www.data.go.kr) → 「의약품 낱알식별정보」에서 발급.
