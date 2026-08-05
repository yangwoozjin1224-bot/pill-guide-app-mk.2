# Phase 6 — 전용 알약 분류 모델 파인튜닝 설계 (문서만)

> **상태:** 설계 전용. 이 Phase에서는 학습 코드·모델 가중치를 추가하지 않습니다.  
> **시점:** 사용자 수·피드백 데이터가 충분히 쌓인 뒤 착수.  
> **관련 PR 파이프라인:** Detection → FeatureExtractor → DBMatcher (이미 운영 중)

---

## 1. 목표

브라우저/온디바이스에서 **각인·색·모양 특징을 더 안정적으로 추출**하거나,  
후보 재랭킹을 돕는 **경량 분류/임베딩 모델**을 도입한다.

핵심 원칙은 유지한다:

1. 모델이 **약 이름을 직접 추측하지 않는다** (열린 분류 금지).
2. 최종 식별은 **식약처 낱알식별 DB 매칭**이 담당한다.
3. 모델 역할은 `FeatureExtractor` 강화 또는 `DBMatcher` 직전 **후보 재랭킹**에 한정한다.

---

## 2. 파이프라인 삽입 위치

현재:

```
Camera frame
  → QualityGate (Phase 2)
  → Detector (OpenCV / YOLO stub)
  → FeatureExtractor (OCR + CV + optional vision LLM)
  → PrescriptionPool / MFDS DBMatcher
  → Ensemble (Phase 5, conditional)
  → UI + Feedback (Phase 4)
```

파인튜닝 모델 후보 위치:

| 옵션 | 위치 | 출력 | 비고 |
|------|------|------|------|
| **A. FeatureExtractor 교체/보조 (권장)** | OCR/CV와 병렬 | imprint embedding, color/shape logits (식약처 카테고리) | 이름 클래스 없음 |
| **B. Reranker** | DB 후보 Top-K 이후 | 후보별 적합 점수 | 카탈로그 이미지 필요 |
| **C. Detector 교체** | YOLO-seg 실장 | instance mask | 분류가 아님 (별도 트랙) |

권장: **A → (여유 시) B**.  
이름은 항상 DB/`itemSeq`로만 확정.

```
… → Detector
  → FeatureExtractor
       ├─ OCR imprint (기존)
       ├─ CV color/shape/score-line (기존)
       └─ [NEW] Mobile/Efficient embedding + category heads
  → DBMatcher (imprint → color/shape → prescription pool)
```

인터페이스는 기존과 호환:

```ts
// 개념적 시그니처 (구현은 추후)
extractFeatures(crop): {
  imprintFront, imprintBack, color, shape, scoreLine,
  embedding?: Float32Array,  // 128~512-d
  colorLogits?: Record<MfdsColor, number>,
  shapeLogits?: Record<MfdsShape, number>,
}
```

---

## 3. 학습 데이터

### 3.1 식약처·공공 카탈로그 (공개)

| 소스 | 내용 | 용도 |
|------|------|------|
| 의약품 낱알식별정보 (data.go.kr) | `ITEM_IMAGE`, `PRINT_FRONT/BACK`, `COLOR_CLASS*`, `DRUG_SHAPE`, `ITEM_SEQ` | 지도 학습 라벨 + 갤러리 |
| e약은요 등 | 보조 메타 | 검색/표시만, 분류 라벨로는 비권장 |

전처리:

- 알약 ROI 크롭 (가능하면 배경제거)
- 각인 가독성 위한 대비 정규화
- 색 라벨은 식약처 `COLOR_CLASS1` 체계에 맞춤
- 모양 라벨은 `DRUG_SHAPE` 체계에 맞춤

### 3.2 사용자 촬영 데이터 (앱 피드백)

Phase 4 피드백 루프에서:

| 필드 | 학습 활용 |
|------|-----------|
| `predicted` vs `correct` | hard negative / 오분류 패턴 |
| `features` (imprint/color/shape) | weak label 검증 |
| `consentImageStore=true` 인 썸네일만 | 도메인 적응 (실사용 조명·손떨림) |

**개인정보·동의**

- 동의 없는 원본 이미지 **서버 영구 저장·학습 금지** (Phase 4 정책과 동일).
- 학습셋 export 시 동의 플래그 필터 필수.
- 가능하면 임베딩/메타만 수집하고 이미지는 최소화.

### 3.3 합성·증강

- 회전, 밝기, 블러, 부분 가림, 배경 텍스처
- 각인 OCR 강건성을 위한 모션 블러·그림자
- Detector용: 다중 알약 배치 합성 (겹침 케이스)

### 3.4 데이터 규모 가이드 (착수 기준)

| 단계 | 대략 규모 | 목적 |
|------|-----------|------|
| PoC | 공개 이미지 수천~수만 crop | color/shape head + embedding |
| v1 | + 동의 기반 실촬영 수천 | 도메인 갭 축소 |
| v2 | 피드백 hard cases 지속 유입 | 능동학습 |

클래스(약 이름) 수를 키우지 말고, **속성·임베딩** 품질을 올린다.

---

## 4. 모델 후보 (경량)

모바일/브라우저 배포를 전제로 한다.

| 모델 | 장점 | 단점 | 추천 용도 |
|------|------|------|-----------|
| **MobileNetV3-Small/Large** | 빠름, TFLite/ONNX 친화 | 표현력 제한 | 1순위 Feature backbone |
| **EfficientNet-Lite / B0** | 정확도·효율 균형 | MobileNet보다 무거움 | 정확도 우선 PoC |
| **EfficientNet-B0/B1** | 재랭킹·임베딩 품질 | 웹 실시간엔 무거울 수 있음 | 서버 보조 추론 |
| CLIP-like (경량 distill) | zero-shot 여지 | 약 각인에 약할 수 있음 | 실험 트랙만 |

헤드 설계 (권장):

1. **Embedding head** (128~256-d) — 동일 알약 crop 간 metric learning  
2. **Color classifier** — 식약처 색 카테고리  
3. **Shape classifier** — 식약처 모양 카테고리  
4. (선택) **Score-line** binary  

**하지 않을 것:** `ITEM_NAME` soft-max 수만 클래스 분류기.

학습 손실 예:

- ArcFace / triplet for embedding  
- CE for color/shape  
- (재랭킹) pair-wise or listwise loss on (crop, catalog image)

---

## 5. 배포·런타임

| 환경 | 포맷 | 비고 |
|------|------|------|
| Web | ONNX Runtime Web / TF.js / WebGPU | FeatureExtractor 플러그인 |
| Android (향후) | TFLite / ONNX | 기존 `YoloPillDetector` 자리와 분리 |

교체 방법:

- 웹: `setEmbeddingProvider` / FeatureExtractor 어댑터에 ONNX 세션 주입  
- Detector는 별도 `setYoloInferencer` 유지  

폴백:

- 모델 로드 실패 → 기존 OCR+CV 경로 유지 (기능 퇴보 없음)

---

## 6. 평가 지표

단계별로 분리 측정 (이미 Phase 구조가 단계 독립 테스트 가능).

| 단계 | 지표 |
|------|------|
| Detector | recall@pill instance, 겹침 분리율 |
| Features | color/shape top-1, imprint OCR char/word accuracy |
| Matching | top-1 / top-5 itemSeq accuracy, prescription-pool precision |
| End-to-end | 사용자 피드백 정정률 감소, 앙상블 호출 비율 감소 |

오프라인 벤치:

- 공개 카탈로그 hold-out  
- 동의 기반 실촬영 hold-out  
- “각인 없음 / 저조도 / 다중 알약” 스트레스 세트

---

## 7. 로드맵 (구현은 미래)

1. **데이터 파이프라인** — 공공 이미지 크롤/캐시 + 라벨 정규화 스크립트  
2. **PoC 학습** — MobileNetV3 + color/shape + embedding  
3. **웹 ONNX 플러그인** — FeatureExtractor 병렬 추론 A/B  
4. **피드백 능동학습** — Phase 4 export → 재학습 루프  
5. **(선택) 후보 재랭킹 B** — 카탈로그 이미지 페어 학습  
6. **Detector YOLO-seg** — 별도 트랙으로 분리 배포  

각 단계마다 기존 DB 매칭을 끄지 않은 채 비교한다.

---

## 8. 리스크·제약

| 리스크 | 완화 |
|--------|------|
| 약 이름 end-to-end 분류의 유혹 | 제품 원칙·코드 리뷰 체크리스트 |
| 개인정보/처방 이미지 | 동의·최소화·로컬 우선 |
| 브라우저 성능 | Lite 모델, 크롭 단위만 추론, 품질 게이트 후 호출 |
| 카탈로그 이미지와 실촬영 도메인 갭 | 증강 + 동의 기반 실데이터 |
| 각인 한글/특수기호 | OCR 병행 유지, embedding만으로 대체 금지 |

---

## 9. 완료 정의 (이 Phase)

- [x] 학습 데이터 종류 정리  
- [x] 경량 모델 후보 정리  
- [x] FeatureExtractor 교체 위치 명시  
- [x] 코드/가중치 미포함 (설계 문서만)

다음 실제 구현 착수 시 별도 Epic으로 분리한다.
