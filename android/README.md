# 필가이드 Android (Kotlin + Jetpack Compose)

React 웹앱을 **네이티브 Android**로 마이그레이션한 프로젝트입니다.

## 기술 스택

- Kotlin, Jetpack Compose, Material 3
- CameraX (Preview / ImageCapture / Torch)
- MVVM + Repository + Hilt DI + Coroutines
- Navigation Compose
- Retrofit (data.go.kr + 향후 AI 서버)
- Room (복용 스케줄)
- ML Kit Text Recognition (기본 OCR) — PaddleOCR/서버 OCR 교체 가능
- TextToSpeech, TalkBack semantics, 큰 버튼/글씨, 진동 피드백

## 패키지 구조

```
com.pillguide.app
├── camera/      CameraX Preview & capture
├── ai/          PillDetector (YOLO/Classical), PillVisionPipeline
├── ocr/         OcrEngine (ML Kit / Server / Paddle stub)
├── repository/  Pill / Schedule / BagSession
├── data/        model, remote (Retrofit), local (Room)
├── ui/          home, search, scan, detail, management
├── utils/       TTS, Haptic, BagTextParser, ImageUtils
└── di/          Hilt modules
```

## 인식 파이프라인

```
CameraX frame
 → Detection (YOLO if assets/models/pill_yolo.onnx exists, else classical)
 → Crop (+15% margin)
 → OCR (imprint)
 → 공공 API DB 검색
 → 결과 표시 + TTS ("이 약은 ○○입니다.")
```

## Android Studio에서 열기

1. Android Studio (최신) → **Open** → `android/` 폴더 선택
2. Gradle Sync
3. `local.properties`에 SDK 경로 확인
4. (선택) 프로젝트 루트 `gradle.properties` 또는 `android/gradle.properties`에:

```properties
DATA_GO_API_KEY=발급받은_서비스키
```

5. Run ▶ 앱 (`com.pillguide.app.debug`)

## YOLO 모델 연결

1. `app/src/main/assets/models/pill_yolo.onnx` 추가
2. `YoloPillDetector`에 ONNX Runtime 추론 구현
3. Hilt가 모델 존재 시 자동으로 YOLO detector 선택

## 서버 AI / PaddleOCR

- `AiServerApi` + `ServerOcrEngine` / `PaddleOcrEngine` 스텁 준비됨
- `BuildConfig.AI_SERVER_BASE_URL` 변경 후 endpoint 구현

## 웹 앱과의 관계

기존 React 코드는 참고용으로 저장소에 남아 있을 수 있습니다.
**실행·배포의 주 타깃은 이 Android 프로젝트**입니다.
