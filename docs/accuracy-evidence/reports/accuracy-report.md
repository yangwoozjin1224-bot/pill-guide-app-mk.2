# 정확도 증거 보고서 (Accuracy Evidence)

> 생성 시각: 2026-08-21T03:46:19.957Z  
> 앱: pill-guide-app-mk.2

## 한 줄 설명
저시력·고령자를 위한 AI 알약 인식 앱 — 카메라로 각인을 읽고 식약처 DB와 매칭한다.

## 측정 범위 (중요)
- **이번 보고서가 측정한 것:** 각인·색·모양이 이미 추출되었다고 가정한 뒤, DB 후보 순위/수락·거절 정확도
- **아직 포함하지 않은 것:** 카메라 실기 E2E는 별도 필드 평가 로그(field-eval-log.csv)로 수집

심사 시 숫자 인용 시 반드시 “오프라인 매칭 계층”임을 명시하세요.

## 핵심 수치

| 지표 | 결과 | 정의 |
|------|------|------|
| Matching Top-1 | **100%** (16/16) | rankCandidates 1위가 exact/partial(conf≥0.5)이고 ITEM_SEQ가 정답과 일치 |
| Matching Recall@5 | **100%** (16/16) | 정답 ITEM_SEQ가 상위 5후보에 포함 |
| 오인식 억제(거절 성공) | **100%** (4/4) | 잘못된/빈 각인에서 exact·partial 자동 확정이 나오지 않음 (오인식 억제) |
| 카탈로그 크기 | 12종 | 픽스처 내 후보 풀 |
| 평가 케이스 | 20건 | exact / partial / reject / OCR후보 |

## 자동화 단위 테스트
- 통과: **YES** (exit 0)
- 테스트 수: 37
- 요약: `# tests 37 | # suites 22 | # pass 37 | # fail 0 | # cancelled 0 | # skipped 0 | # todo 0 | # duration_ms 123.482908`

## 파이프라인 근거
```
카메라 프레임
  → 품질 게이트
  → 알약 검출
  → 각인 OCR + 색/모양
  → [본 보고서 측정] 식약처형 DB 매칭(rankCandidates)
  → 상세 화면 → 복용 관리 등록
```

이름이 모델에서 직접 생성되지 않고, **각인 매칭 → DB itemSeq** 로 확정되는 구조를 증거로 제시합니다.

## 케이스별 결과
| ID | 유형 | 결과 | 상세 |
|----|------|------|------|
| E01 | exact | PASS | TOP1 타이레놀정500밀리그램 (exact, conf=0.91) |
| E02 | exact | PASS | TOP1 게보린정 (exact, conf=0.91) |
| E03 | exact | PASS | TOP1 아스피린프로텍트정100밀리그램 (exact, conf=0.91) |
| E04 | exact | PASS | TOP1 낙센정500밀리그램 (exact, conf=0.91) |
| E05 | exact | PASS | TOP1 지르텍정 (exact, conf=0.91) |
| E06 | exact | PASS | TOP1 훼스탈플러스정 (exact, conf=0.91) |
| E07 | exact | PASS | TOP1 클라리틴정 (exact, conf=0.91) |
| E08 | exact | PASS | TOP1 부루펜정400밀리그램 (exact, conf=0.91) |
| E09 | exact | PASS | TOP1 애드빌정 (exact, conf=0.91) |
| E10 | exact | PASS | TOP1 베아제정 (exact, conf=0.91) |
| P01 | partial | PASS | TOP1 타이레놀정500밀리그램 (partial, conf=0.83) |
| P02 | partial | PASS | TOP1 게보린정 (partial, conf=0.83) |
| P03 | partial | PASS | TOP1 클라리틴정 (partial, conf=0.82) |
| P04 | partial | PASS | TOP1 낙센정500밀리그램 (partial, conf=0.84) |
| R01 | reject | PASS | rejected (top=color_shape:타이레놀정500밀리그램) |
| R02 | reject | PASS | rejected (top=weak:판콜에이연질캡슐) |
| R03 | reject_color_only | PASS | rejected (top=color_shape:타이레놀정500밀리그램) |
| R04 | reject_color_only | PASS | rejected (top=color_shape:부루펜정400밀리그램) |
| C01 | candidate_mark | PASS | TOP1 타이레놀정500밀리그램 (exact, conf=0.91) |
| C02 | candidate_mark | PASS | TOP1 애드빌정 (exact, conf=0.91) |

## 실패 케이스
없음

## 재현 방법
```bash
npm run eval:accuracy
```
산출물:
- `docs/accuracy-evidence/reports/accuracy-report.json`
- `docs/accuracy-evidence/reports/accuracy-report.md`

## 실기(카메라) 평가 안내
실기 Top-1은 `docs/accuracy-evidence/fixtures/field-eval-log.csv` 양식에
약종·촬영조건·정답여부를 기록한 뒤 별도 집계합니다.
