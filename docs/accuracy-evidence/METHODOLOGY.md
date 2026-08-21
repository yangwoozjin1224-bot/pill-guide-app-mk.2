# 정확도 측정 방법론 (Methodology)

## 1. 앱이 주장하는 인식 방식

본 앱은 **약 이름을 생성형 모델이 직접 지어내지 않습니다.**

1. 카메라에서 알약 영역 검출  
2. 각인(imprint) OCR + 색/모양 특징 추출  
3. 식약처 낱알식별 DB(또는 동등 후보 풀)와 **각인 우선 매칭**  
4. exact / partial 계층만 자동 확정, color-only는 억제  

따라서 심사 시 “정확도”는 **최종 화면의 약 이름(itemSeq)이 정답과 일치하는가**로 정의합니다.

## 2. 이번 증거 패키지의 측정 계층

| 계층 | 포함 여부 | 설명 |
|------|-----------|------|
| A. 오프라인 매칭 (rankCandidates) | ✅ 측정 | OCR 결과가 주어졌다고 가정하고 DB Top-1/거절 |
| B. 단위 테스트 (순수 함수) | ✅ 보조 증거 | CI에서 재현 가능한 회귀 검증 |
| C. 카메라 실기 E2E | ⬚ 양식 제공 | `field-eval-log.csv`에 수기/실측 기록 |

**A를 “카메라 전체 정확도”라고 과장하지 않습니다.**  
A는 “매칭 엔진이 올바른 각인을 받았을 때 정답을 고르는가 + 틀린 각인을 거절하는가”의 증거입니다.

## 3. 지표 정의

### Matching Top-1 Accuracy
- 분자: 1위 후보가 `exact` 또는 `partial`(confidence ≥ 0.5)이고 `ITEM_SEQ`가 정답
- 분모: expectTop1 케이스 수

### Matching Recall@5
- 정답 `ITEM_SEQ`가 상위 5개 후보에 포함되는 비율

### 오인식 억제율 (False-accept rejection)
- 잘못된/빈 각인 케이스에서 exact·partial 자동 확정이 **나오지 않은** 비율  
- 고령자 안전 관점에서 Top-1만큼 중요

## 4. 재현성

```bash
npm run eval:accuracy
```

입력: `fixtures/offline-match-cases.json`  
출력: `reports/accuracy-report.{md,json}`  
코드: `src/vision/match/confidence.js`

동일 커밋에서 동일 명령을 실행하면 동일 수치가 나와야 합니다.

## 5. 한계 (심사 질의 대비)

- 실기 OCR 오류·초점·반사·다중 알약 겹침은 A에 포함되지 않음  
- 픽스처 카탈로그는 대표 OTC 샘플이며 전체 식약처 DB 규모와 다름  
- 실기 숫자는 `field-eval-log.csv`를 채운 뒤 별도 집계 필요  

## 6. 권장 발표 문장

1. “인식은 OCR+DB 매칭이며, 매칭 계층 오프라인 평가 Top-1은 ○○%입니다.”  
2. “각인이 없거나 틀린 경우 자동 확정을 막는 억제율은 ○○%입니다.”  
3. “실기 카메라는 시연 + 필드 로그로 검증합니다.”
