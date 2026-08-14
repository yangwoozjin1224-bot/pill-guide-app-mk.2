/**
 * 알약 촬영/이미지 인식 스트레스 테스트 (Playwright)
 *
 * - 합성 알약 이미지(각인·색·모양) 또는 test-fixtures/scan/ 사진을 넣음
 * - 스캔 화면 "앨범" 입력으로 주입 → 기존 인식 파이프라인 실행
 * - 성공(약 식별) / 실패(에러·타임아웃 등)를 scan-test-results.json 에 저장
 *
 * 실행:
 *   터미널1: npm run dev
 *   터미널2: npm run stress-test:scan
 *
 * 옵션:
 *   STRESS_ITERATIONS=50 npm run stress-test:scan
 *   SCAN_TIMEOUT_MS=45000 npm run stress-test:scan
 *   BASE_URL=http://localhost:5173 npm run stress-test:scan
 */

import { chromium } from "playwright";
import { faker } from "@faker-js/faker";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
// 인식 1회가 수 초~수십 초라 기본 100회 (1000은 STRESS_ITERATIONS=1000)
const ITERATIONS = Number(process.env.STRESS_ITERATIONS || 100);
const SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS || 45000);
const HEADLESS = process.env.STRESS_HEADED !== "1";
const OUT_FILE = path.join(__dirname, "scan-test-results.json");
const FIXTURE_DIR = path.join(__dirname, "test-fixtures", "scan");

const IMPRINTS = [
  "TYLENOL",
  "GEBORIN",
  "ADVIL",
  "Zyrtec",
  "ASPIRIN",
  "P5",
  "TN",
  "123",
  "ABC12",
  "XXX",
];

const COLORS = ["#F8FAFC", "#FDE68A", "#FCA5A5", "#93C5FD", "#86EFAC", "#E9D5FF", "#FED7AA"];

function listFixtureFiles() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => path.join(FIXTURE_DIR, f));
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return true;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function makeSyntheticPngBuffer(page, spec) {
  const dataUrl = await page.evaluate((s) => {
    const c = document.createElement("canvas");
    c.width = 960;
    c.height = 960;
    const ctx = c.getContext("2d");
    ctx.fillStyle = s.bg || "#E5E7EB";
    ctx.fillRect(0, 0, 960, 960);

    if (s.mode === "blank") {
      return c.toDataURL("image/png");
    }

    if (s.mode === "noise") {
      for (let i = 0; i < 8000; i++) {
        ctx.fillStyle = `rgb(${Math.random() * 255|0},${Math.random() * 255|0},${Math.random() * 255|0})`;
        ctx.fillRect(Math.random() * 960, Math.random() * 960, 3, 3);
      }
      return c.toDataURL("image/png");
    }

    // pill body
    ctx.fillStyle = s.color || "#F8FAFC";
    ctx.beginPath();
    if (s.shape === "capsule") {
      ctx.ellipse(480, 480, 260, 120, 0, 0, Math.PI * 2);
    } else if (s.shape === "round") {
      ctx.ellipse(480, 480, 180, 180, 0, 0, Math.PI * 2);
    } else {
      ctx.ellipse(480, 480, 220, 140, -0.2, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 4;
    ctx.stroke();

    // imprint
    if (s.mark) {
      ctx.fillStyle = s.markColor || "#111827";
      ctx.font = `bold ${s.fontSize || 64}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(s.mark), 480, 480);
    }

    return c.toDataURL("image/png");
  }, spec);

  const base64 = dataUrl.split(",")[1] || "";
  return Buffer.from(base64, "base64");
}

function pickCase(i, fixtures) {
  const roll = i % 10;
  if (fixtures.length && roll === 0) {
    const file = fixtures[i % fixtures.length];
    return {
      kind: "fixture",
      label: path.basename(file),
      file,
      expect: "maybe_success",
    };
  }
  if (roll === 1) {
    return {
      kind: "synthetic",
      label: "blank_bg",
      spec: { mode: "blank" },
      expect: "likely_fail",
    };
  }
  if (roll === 2) {
    return {
      kind: "synthetic",
      label: "noise",
      spec: { mode: "noise" },
      expect: "likely_fail",
    };
  }
  if (roll === 3) {
    return {
      kind: "synthetic",
      label: "pill_no_mark",
      spec: {
        mode: "pill",
        color: faker.helpers.arrayElement(COLORS),
        shape: faker.helpers.arrayElement(["round", "oval", "capsule"]),
        mark: "",
      },
      expect: "likely_fail",
    };
  }

  // Prefer high-OCR-success cases: clear white pill + known imprint
  const mark = faker.helpers.arrayElement(["TYLENOL", "TYLENOL", "TYME", "GEBORIN", "ADVIL", "ZYRTEC"]);
  return {
    kind: "synthetic",
    label: `pill_${mark}`,
    spec: {
      mode: "pill",
      color: "#F8FAFC",
      shape: "oval",
      mark,
      markColor: "#111827",
      fontSize: 72,
      bg: "#CBD5E1",
    },
    expect: "maybe_success",
  };
}

async function goHome(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "홈" }).click({ timeout: 5000 }).catch(() => {});
}

async function openScanScreen(page) {
  const scanNav = page.getByRole("button", { name: "촬영" });
  if (await scanNav.isVisible().catch(() => false)) {
    await scanNav.click();
  } else {
    // 홈 카드 버튼
    const shoot = page.getByRole("button", { name: "촬영하러 가기" });
    if (await shoot.isVisible().catch(() => false)) await shoot.click();
  }
  // 앨범 버튼 또는 카메라 에러 UI가 보일 때까지
  await page.getByRole("button", { name: "앨범에서 선택" }).or(page.getByText("알약 촬영")).first().waitFor({
    timeout: 15000,
  });
}

async function uploadImage(page, buffer, name = "pill.png") {
  const input = page.getByTestId("scan-gallery-input");
  await input.setInputFiles({
    name,
    mimeType: "image/png",
    buffer,
  });
}

/**
 * 성공: 약 상세로 이동하거나 인식 결과 목록이 보임
 * 실패: 에러 상태 / 타임아웃 / 페이지 크래시
 */
async function waitForScanOutcome(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) {
      return { ok: false, outcome: "page_closed", message: "페이지가 닫힘" };
    }

    // 상세 화면 (등록 버튼)
    if (await page.getByRole("button", { name: /복용 관리 등록/ }).isVisible().catch(() => false)) {
      const name =
        (await page.locator("p.text-\\[24px\\]").first().textContent().catch(() => null)) ||
        (await page.locator("text=/정|캡슐|mg/i").first().textContent().catch(() => "")) ||
        "";
      return {
        ok: true,
        outcome: "detail",
        message: `상세 화면 진입${name ? `: ${name.trim().slice(0, 80)}` : ""}`,
      };
    }

    // 인식된 알약 목록
    if (await page.getByText("인식된 알약").isVisible().catch(() => false)) {
      const countText = (await page.getByText(/\d+개를 찾았습니다/).textContent().catch(() => "")) || "";
      return { ok: true, outcome: "results", message: countText.trim() || "인식 결과 목록" };
    }

    // 파이프라인 에러 UI
    if (await page.getByText("다시 인식하기").isVisible().catch(() => false)) {
      const err =
        (await page.locator("p").filter({ hasText: /없|실패|못|오류|에러|권한/ }).first().textContent().catch(() => null)) ||
        "인식 실패(에러 UI)";
      return { ok: false, outcome: "error_ui", message: String(err).trim() };
    }

    // 품질 안내만 계속인 경우는 계속 대기 (smart still 중일 수 있음)
    await page.waitForTimeout(250);
  }

  const hint = (await page.locator("text=/초점을|어두|밝|흔들|담는 중|포착/").first().textContent().catch(() => "")) || "";
  const scanning = await page.getByText("알약 촬영").isVisible().catch(() => false);
  return {
    ok: false,
    outcome: "timeout",
    message: hint
      ? `제한시간 초과 (힌트: ${hint.trim()})`
      : scanning
        ? "제한시간 초과 (계속 스캔 중)"
        : "제한시간 초과 (결과 UI 없음)",
  };
}

async function main() {
  console.log("========================================");
  console.log("  알약 이미지/카메라 인식 스트레스 테스트");
  console.log("========================================");
  console.log(`대상 URL : ${BASE_URL}`);
  console.log(`반복 횟수: ${ITERATIONS}`);
  console.log(`대기시간 : ${SCAN_TIMEOUT_MS}ms / 회`);
  console.log(`결과 파일: ${OUT_FILE}`);
  console.log("");

  const fixtures = listFixtureFiles();
  console.log(`실사 픽스처: ${fixtures.length}개 (${FIXTURE_DIR})`);
  if (!fixtures.length) {
    console.log("→ test-fixtures/scan/ 폴더에 png/jpg를 넣으면 실사 이미지도 섞어 테스트합니다.");
  }
  console.log("");

  console.log("개발 서버 확인 중...");
  if (!(await waitForServer(BASE_URL))) {
    console.error(`❌ ${BASE_URL} 연결 실패. 먼저: npm run dev`);
    process.exit(1);
  }
  console.log("✅ 개발 서버 확인됨\n");

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    locale: "ko-KR",
    permissions: ["camera"],
  });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));

  const summary = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    iterations: ITERATIONS,
    timeoutMs: SCAN_TIMEOUT_MS,
    success: 0,
    failure: 0,
    failures: [],
    successes: [],
    outcomes: {},
  };

  // helper page evaluate context for PNG generation
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  try {
    for (let i = 1; i <= ITERATIONS; i++) {
      const testCase = pickCase(i, fixtures);
      const beforeErr = pageErrors.length;
      let inputMeta = { kind: testCase.kind, label: testCase.label };

      try {
        await goHome(page);
        await openScanScreen(page);

        let buffer;
        let filename = `${testCase.label || "pill"}.png`;
        if (testCase.kind === "fixture") {
          buffer = fs.readFileSync(testCase.file);
          filename = path.basename(testCase.file);
          inputMeta.file = filename;
        } else {
          buffer = await makeSyntheticPngBuffer(page, testCase.spec);
          inputMeta.spec = testCase.spec;
        }

        // 카메라 권한 실패 화면이어도 앨범으로 진행 가능
        await uploadImage(page, buffer, filename);
        const result = await waitForScanOutcome(page, SCAN_TIMEOUT_MS);

        const newErrors = pageErrors.slice(beforeErr);
        if (newErrors.length) {
          summary.failure += 1;
          summary.failures.push({
            iteration: i,
            input: inputMeta,
            outcome: "pageerror",
            errorMessage: newErrors.join(" | "),
          });
        } else if (result.ok) {
          summary.success += 1;
          summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1;
          if (summary.successes.length < 30) {
            summary.successes.push({
              iteration: i,
              input: inputMeta,
              outcome: result.outcome,
              message: result.message,
            });
          }
        } else {
          summary.failure += 1;
          summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1;
          // 실패 원인 粗분류 (발표/분석용)
          let failClass = "other";
          const msg = result.message || "";
          if (/알약\/각인을 찾지|각인\(표기\)을 읽지|선명하게/.test(msg)) failClass = "detect_or_ocr_fail";
          else if (/표기로 약을 찾지|특정하지 못/.test(msg)) failClass = "db_match_fail";
          else if (/권한|카메라/.test(msg)) failClass = "camera_permission";
          else if (result.outcome === "timeout") failClass = "timeout";
          summary.failClasses = summary.failClasses || {};
          summary.failClasses[failClass] = (summary.failClasses[failClass] || 0) + 1;
          summary.failures.push({
            iteration: i,
            input: inputMeta,
            outcome: result.outcome,
            failClass,
            errorMessage: result.message,
          });
        }
      } catch (err) {
        summary.failure += 1;
        summary.outcomes.exception = (summary.outcomes.exception || 0) + 1;
        summary.failures.push({
          iteration: i,
          input: inputMeta,
          outcome: "exception",
          errorMessage: String(err?.message || err),
        });
      }

      if (i % 10 === 0 || i === ITERATIONS) {
        console.log(
          `진행: ${i}/${ITERATIONS}  (성공 ${summary.success} / 실패 ${summary.failure})`
        );
      }
    }
  } finally {
    summary.finishedAt = new Date().toISOString();
    summary.successRate =
      summary.iterations > 0
        ? Number(((summary.success / summary.iterations) * 100).toFixed(2))
        : 0;
    // 실패가 너무 많으면 파일 비대화 방지
    if (summary.failures.length > 200) {
      summary.failuresTruncated = summary.failures.length;
      summary.failures = summary.failures.slice(0, 200);
    }
    fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2), "utf8");
    await browser.close();
  }

  console.log("\n======== 결과 요약 ========");
  console.log(`성공(약 식별): ${summary.success}`);
  console.log(`실패: ${summary.failure}`);
  console.log(`성공률: ${summary.successRate}%`);
  console.log("outcome 분포:", summary.outcomes);
  if (summary.failClasses) console.log("실패 유형:", summary.failClasses);
  console.log(`결과 저장: ${OUT_FILE}`);
  if (summary.failure > 0) {
    console.log("실패 예시:");
    for (const f of summary.failures.slice(0, 8)) {
      console.log(
        `  #${f.iteration} [${f.input?.label}] → ${f.outcome}: ${f.errorMessage}`
      );
    }
  }
}

main().catch((err) => {
  console.error("스캔 스트레스 테스트 오류:", err);
  process.exit(1);
});
