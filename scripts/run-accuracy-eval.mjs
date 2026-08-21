#!/usr/bin/env node
/**
 * Offline accuracy evidence runner (matching layer).
 * Usage: node scripts/run-accuracy-eval.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { rankCandidates } from "../src/vision/match/confidence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(ROOT, "docs/accuracy-evidence/fixtures/offline-match-cases.json");
const OUT_DIR = path.join(ROOT, "docs/accuracy-evidence/reports");

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10; // one decimal
}

function isStrongAccept(top) {
  return top && (top.tier === "exact" || top.tier === "partial") && top.confidence >= 0.5;
}

async function runUnitTests() {
  const r = spawnSync("npm", ["test"], { cwd: ROOT, encoding: "utf8" });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const pass = /# fail\s+0/.test(out);
  const m = out.match(/# tests\s+(\d+)/);
  const tests = m ? Number(m[1]) : null;
  return {
    passed: pass && r.status === 0,
    exitCode: r.status,
    testCount: tests,
    summaryLine: out
      .split("\n")
      .filter((l) => l.startsWith("# "))
      .slice(-8)
      .join(" | "),
  };
}

async function main() {
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));
  const catalog = fixture.catalog;
  const rows = [];

  let top1Ok = 0;
  let top1Total = 0;
  let rejectOk = 0;
  let rejectTotal = 0;
  let recall5Ok = 0;
  let recall5Total = 0;

  for (const c of fixture.cases) {
    const ranked = rankCandidates(catalog, c.features, { minScore: 20 });
    const top = ranked[0] || null;
    const top5 = ranked.slice(0, 5).map((r) => String(r.itemSeq));
    const accepted = isStrongAccept(top);

    let ok = false;
    let detail = "";

    if (c.expectReject) {
      rejectTotal += 1;
      // Reject = do not strongly accept a wrong/uncertain identification
      ok = !accepted;
      if (ok) rejectOk += 1;
      detail = accepted
        ? `FALSE_ACCEPT tier=${top.tier} name=${top.name}`
        : `rejected (top=${top ? `${top.tier}:${top.name}` : "none"})`;
    } else if (c.expectTop1 && c.gtItemSeq) {
      top1Total += 1;
      recall5Total += 1;
      const hit1 = accepted && String(top.itemSeq) === String(c.gtItemSeq);
      const hit5 = top5.includes(String(c.gtItemSeq));
      if (hit1) top1Ok += 1;
      if (hit5) recall5Ok += 1;
      ok = hit1;
      detail = hit1
        ? `TOP1 ${top.name} (${top.tier}, conf=${top.confidence.toFixed(2)})`
        : `MISS top=${top ? `${top.itemSeq}:${top.name}:${top.tier}` : "none"} gt=${c.gtItemSeq}`;
    }

    rows.push({
      id: c.id,
      type: c.type,
      ok,
      detail,
      topTier: top?.tier ?? null,
      topName: top?.name ?? null,
      topConfidence: top ? Number(top.confidence.toFixed(3)) : null,
      gtItemSeq: c.gtItemSeq,
      note: c.note || "",
    });
  }

  const unit = await runUnitTests();

  const report = {
    title: "Pill Guide — Accuracy Evidence Report",
    generatedAt: new Date().toISOString(),
    app: "pill-guide-app-mk.2",
    oneLiner:
      "저시력·고령자를 위한 AI 알약 인식 앱 — 카메라로 각인을 읽고 식약처 DB와 매칭한다.",
    scope: {
      measured: "offline_matching_layer",
      measuredKo:
        "각인·색·모양이 이미 추출되었다고 가정한 뒤, DB 후보 순위/수락·거절 정확도",
      notMeasured: [
        "실기 카메라 프레임 E2E Top-1",
        "조명/반사/손떨림 조건별 OCR 성공률",
        "다중 알약 검출 IoU",
      ],
      notMeasuredKo:
        "카메라 실기 E2E는 별도 필드 평가 로그(field-eval-log.csv)로 수집",
    },
    metrics: {
      matchingTop1AccuracyPct: pct(top1Ok, top1Total),
      matchingTop1: { correct: top1Ok, total: top1Total },
      matchingRecallAt5Pct: pct(recall5Ok, recall5Total),
      matchingRecallAt5: { correct: recall5Ok, total: recall5Total },
      falseAcceptRejectRatePct: pct(rejectOk, rejectTotal),
      falseAcceptReject: { correct: rejectOk, total: rejectTotal },
      catalogSize: catalog.length,
      caseCount: fixture.cases.length,
    },
    unitTests: unit,
    definition: {
      top1:
        "rankCandidates 1위가 exact/partial(conf≥0.5)이고 ITEM_SEQ가 정답과 일치",
      reject:
        "잘못된/빈 각인에서 exact·partial 자동 확정이 나오지 않음 (오인식 억제)",
      recallAt5: "정답 ITEM_SEQ가 상위 5후보에 포함",
    },
    cases: rows,
    reproducibility: {
      command: "npm run eval:accuracy",
      fixture: "docs/accuracy-evidence/fixtures/offline-match-cases.json",
      code: "src/vision/match/confidence.js → rankCandidates",
    },
  };

  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, "accuracy-report.json");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const failRows = rows.filter((r) => !r.ok);
  const md = `# 정확도 증거 보고서 (Accuracy Evidence)

> 생성 시각: ${report.generatedAt}  
> 앱: ${report.app}

## 한 줄 설명
${report.oneLiner}

## 측정 범위 (중요)
- **이번 보고서가 측정한 것:** ${report.scope.measuredKo}
- **아직 포함하지 않은 것:** ${report.scope.notMeasuredKo}

심사 시 숫자 인용 시 반드시 “오프라인 매칭 계층”임을 명시하세요.

## 핵심 수치

| 지표 | 결과 | 정의 |
|------|------|------|
| Matching Top-1 | **${report.metrics.matchingTop1AccuracyPct}%** (${top1Ok}/${top1Total}) | ${report.definition.top1} |
| Matching Recall@5 | **${report.metrics.matchingRecallAt5Pct}%** (${recall5Ok}/${recall5Total}) | ${report.definition.recallAt5} |
| 오인식 억제(거절 성공) | **${report.metrics.falseAcceptRejectRatePct}%** (${rejectOk}/${rejectTotal}) | ${report.definition.reject} |
| 카탈로그 크기 | ${report.metrics.catalogSize}종 | 픽스처 내 후보 풀 |
| 평가 케이스 | ${report.metrics.caseCount}건 | exact / partial / reject / OCR후보 |

## 자동화 단위 테스트
- 통과: **${unit.passed ? "YES" : "NO"}** (exit ${unit.exitCode})
- 테스트 수: ${unit.testCount ?? "—"}
- 요약: \`${unit.summaryLine}\`

## 파이프라인 근거
\`\`\`
카메라 프레임
  → 품질 게이트
  → 알약 검출
  → 각인 OCR + 색/모양
  → [본 보고서 측정] 식약처형 DB 매칭(rankCandidates)
  → 상세 화면 → 복용 관리 등록
\`\`\`

이름이 모델에서 직접 생성되지 않고, **각인 매칭 → DB itemSeq** 로 확정되는 구조를 증거로 제시합니다.

## 케이스별 결과
| ID | 유형 | 결과 | 상세 |
|----|------|------|------|
${rows
  .map((r) => `| ${r.id} | ${r.type} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail} |`)
  .join("\n")}

${
  failRows.length
    ? `## 실패 케이스\n${failRows.map((f) => `- ${f.id}: ${f.detail}`).join("\n")}`
    : "## 실패 케이스\n없음"
}

## 재현 방법
\`\`\`bash
npm run eval:accuracy
\`\`\`
산출물:
- \`docs/accuracy-evidence/reports/accuracy-report.json\`
- \`docs/accuracy-evidence/reports/accuracy-report.md\`

## 실기(카메라) 평가 안내
실기 Top-1은 \`docs/accuracy-evidence/fixtures/field-eval-log.csv\` 양식에
약종·촬영조건·정답여부를 기록한 뒤 별도 집계합니다.
`;

  const mdPath = path.join(OUT_DIR, "accuracy-report.md");
  await writeFile(mdPath, md, "utf8");

  console.log(JSON.stringify(report.metrics, null, 2));
  console.log("Wrote", jsonPath);
  console.log("Wrote", mdPath);
  if (!unit.passed || failRows.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
