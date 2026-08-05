# 저시력 고령자를 위한 AI 알약 인식 앱

React + Vite + Tailwind CSS로 만든 프로젝트입니다.

## 인식 파이프라인 (각인 → DB)

1. **분리** `src/vision/detectors/` — OpenCV-style(adaptive threshold + contour + watershed) / YOLO stub  
2. **특징** `src/vision/features/` — OCR + CV(색/모양/분할선) + 관찰용 비전 LLM(이름 추측 금지)  
3. **매칭** `src/vision/match/` — 식약처 낱알식별 API(각인 1차 → 색/모양 2차) + 로컬 캐시  
4. **폴백** DB 후보 0개일 때만 멀티모달 이름 추측 (`lowAccuracy: true`)

단계별 테스트: `npm test`  
설계 요약: `src/vision/FEATURES.md`

## 로컬에서 실행하기

```bash
npm install
npm run dev
```

`http://localhost:5173` 에서 확인할 수 있습니다. (카메라는 로컬/https 환경에서만 정상 동작합니다)

## 공공 API 키 설정

```bash
cp .env.example .env
```

| 변수 | 용도 |
|------|------|
| `VITE_API_KEY` | [data.go.kr](https://www.data.go.kr) 「의약품 낱알식별정보」 서비스키 (**필수**) |
| `VITE_VISION_LLM_KEY` | 관찰/폴백 비전 LLM (선택, OpenAI 호환) |
| `VITE_VISION_LLM_URL` | 기본 `https://api.openai.com/v1/chat/completions` |
| `VITE_VISION_LLM_MODEL` | 기본 `gpt-4o-mini` |

키 없이 LLM을 쓰면 OCR+CV+DB만으로 동작합니다.

### Netlify 배포 시
`netlify/functions/data-go-proxy.js`는 CORS 우회 프록시입니다.  
환경변수 `DATA_GO_API_KEY`가 필요합니다.

## Netlify에 배포하기

```bash
npm install
npm run build
```

`dist` 폴더를 Netlify Drop에 올리거나 GitHub 연동으로 배포하세요.  
Build command: `npm run build` / Publish directory: `dist`

## 참고

- 카메라는 **https** 또는 **localhost**에서만 동작합니다.
- 공공 API는 CORS로 막힐 수 있어 Netlify Functions 프록시를 권장합니다.
