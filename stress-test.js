/**
 * 알약 앱 검색 폼 Playwright 스트레스 테스트
 *
 * 이 앱은 일반 회원가입 폼이 아니라, 아래 입력이 핵심입니다.
 *  - 약 찾기 화면: placeholder "약의 이름이나 형태, 효능군 등을 입력해주세요"
 *  - 검색 버튼: aria-label="검색"
 *
 * 실행 예:
 *   터미널1: npm run dev
 *   터미널2: npm run stress-test
 *
 * 옵션:
 *   STRESS_ITERATIONS=100   npm run stress-test   # 횟수 변경
 *   BASE_URL=http://localhost:5173 npm run stress-test
 */

import { chromium } from "playwright";
import { faker } from "@faker-js/faker";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const ITERATIONS = Number(process.env.STRESS_ITERATIONS || 1000);
const HEADLESS = process.env.STRESS_HEADED !== "1";
const OUT_FILE = path.join(__dirname, "test-results.json");

const KNOWN_DRUGS = [
  "타이레놀",
  "게보린",
  "펜잘큐",
  "판콜에이",
  "화이투벤",
  "훼스탈플러스",
  "베아제",
  "지르텍",
  "후시딘",
  "삐콤씨",
  "아로나민골드",
  "우루사",
  "스멕타",
  "정로환",
  "케토톱",
  "낙센",
  "부루펜",
  "센트룸",
  "락토핏",
  "마데카솔",
];

function makeRandomQuery(i) {
  const roll = i % 12;
  switch (roll) {
    case 0:
      return faker.helpers.arrayElement(KNOWN_DRUGS);
    case 1:
      return faker.lorem.word();
    case 2:
      return faker.string.alphanumeric({ length: faker.number.int({ min: 1, max: 12 }) });
    case 3:
      return faker.string.numeric({ length: faker.number.int({ min: 1, max: 8 }) });
    case 4:
      return faker.helpers.arrayElement([" ", "   ", "\t", "\n"]);
    case 5:
      return "";
    case 6:
      return faker.helpers.arrayElement([
        "<script>alert(1)</script>",
        "'; DROP TABLE drugs;--",
        "../../etc/passwd",
        "${jndi:ldap://x}",
      ]);
    case 7:
      return faker.lorem.paragraph().slice(0, 300);
    case 8:
      return faker.helpers.arrayElement(["감기", "두통", "소화불량", "비타민", "알레르기", "안약"]);
    case 9:
      return faker.helpers.arrayElement(["TYLENOL", "Advil", "Zyrtec", "Aspirin"]);
    case 10:
      return faker.helpers.arrayElement(["💊", "!!!", "@@@", "한글English123", "타이레놀!!!"]);
    default:
      return faker.helpers.arrayElement(KNOWN_DRUGS) + faker.string.alpha({ length: 2 });
  }
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return true;
    } catch {
      // server not ready
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function goToSearchScreen(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // 홈의 "검색하기" 또는 하단 네비 "약 찾기(+)"
  const homeSearch = page.getByRole("button", { name: /검색하기/ });
  const navSearch = page.getByRole("button", { name: "약 찾기" });

  if (await homeSearch.isVisible().catch(() => false)) {
    await homeSearch.click();
  } else if (await navSearch.isVisible().catch(() => false)) {
    await navSearch.click();
  } else {
    // 이미 약 찾기일 수 있음
  }

  await page
    .getByPlaceholder("약의 이름이나 형태, 효능군 등을 입력해주세요")
    .waitFor({ state: "visible", timeout: 15000 });
}

async function ensureSearchScreen(page) {
  const input = page.getByPlaceholder("약의 이름이나 형태, 효능군 등을 입력해주세요");
  if (await input.isVisible().catch(() => false)) return;

  // 상세/다른 화면에서 복귀
  const back = page.locator("button").filter({ has: page.locator("svg") }).first();
  const homeNav = page.getByRole("button", { name: "홈" });
  const searchNav = page.getByRole("button", { name: "약 찾기" });

  if (await searchNav.isVisible().catch(() => false)) {
    await searchNav.click();
  } else if (await homeNav.isVisible().catch(() => false)) {
    await homeNav.click();
    await page.getByRole("button", { name: /검색하기/ }).click();
  } else if (await back.isVisible().catch(() => false)) {
    await back.click();
  } else {
    await goToSearchScreen(page);
  }

  await input.waitFor({ state: "visible", timeout: 15000 });
}

/**
 * 성공 기준:
 *  - 앱이 죽지 않고
 *  - 검색 요청에 대해 UI가 응답함
 *    (결과 목록 / "검색 결과가 없습니다" / 기타 안내 문구 / 카테고리 복귀)
 * 빈 입력은 앱이 검색을 시작하지 않음 → 의도된 동작으로 성공 처리
 */
async function runOneSearch(page, query) {
  const input = page.getByPlaceholder("약의 이름이나 형태, 효능군 등을 입력해주세요");
  await input.click({ clickCount: 3 });
  await input.fill("");
  await input.fill(query);

  const trimmed = String(query).trim();
  if (!trimmed) {
    // Enter / 검색을 눌러도 runSearch가 early return
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await page.waitForTimeout(200);
    return {
      ok: true,
      outcome: "empty_input_skipped",
      message: "빈 입력은 앱에서 검색을 시작하지 않음(정상)",
    };
  }

  await page.getByRole("button", { name: "검색", exact: true }).click();

  // loading → 결과/에러 대기
  const deadline = Date.now() + 12000;
  let sawLoading = false;

  while (Date.now() < deadline) {
    const loadingVisible = await page.getByText("검색 중...").isVisible().catch(() => false);
    if (loadingVisible) sawLoading = true;

    if (!loadingVisible) {
      const resultsLabel = page.getByText(/검색 결과\s+\d+건/);
      if (await resultsLabel.isVisible().catch(() => false)) {
        const text = (await resultsLabel.textContent()) || "";
        return { ok: true, outcome: "results", message: text.trim() };
      }

      // 에러/안내 문구 (앱이 정상적으로 보여준 경우)
      const errorCandidates = [
        page.getByText("검색 결과가 없습니다."),
        page.getByText(/검색 실패/),
        page.getByText(/알약 정보를/),
        page.getByText(/공공데이터/),
        page.getByText(/서비스 키/),
        page.getByText(/찾을 수 없/),
      ];
      for (const loc of errorCandidates) {
        if (await loc.isVisible().catch(() => false)) {
          const message = ((await loc.textContent()) || "").trim();
          return { ok: true, outcome: "handled_message", message };
        }
      }

      // 로딩을 봤다가 카테고리로 돌아온 경우도 허용
      if (sawLoading && (await page.getByText("카테고리별 대표 약").isVisible().catch(() => false))) {
        return {
          ok: true,
          outcome: "back_to_categories",
          message: "검색 후 카테고리 화면으로 복귀",
        };
      }
    }

    // 페이지 크래시 감지
    if (page.isClosed()) {
      return { ok: false, outcome: "page_closed", message: "페이지가 닫힘" };
    }

    await page.waitForTimeout(150);
  }

  // 타임아웃: 로딩이 무한히 돌거나 UI 무응답
  const stillLoading = await page.getByText("검색 중...").isVisible().catch(() => false);
  return {
    ok: false,
    outcome: stillLoading ? "loading_timeout" : "no_ui_response",
    message: stillLoading
      ? "검색 중... 상태가 12초 이상 지속됨"
      : "검색 후 결과/에러 UI를 확인하지 못함",
  };
}

async function resetAfterSearch(page) {
  const backToCat = page.getByRole("button", { name: "카테고리 보기" });
  if (await backToCat.isVisible().catch(() => false)) {
    await backToCat.click();
    await page.waitForTimeout(100);
  }
  await ensureSearchScreen(page);
}

async function main() {
  console.log("========================================");
  console.log("  알약 앱 검색 폼 스트레스 테스트");
  console.log("========================================");
  console.log(`대상 URL : ${BASE_URL}`);
  console.log(`반복 횟수: ${ITERATIONS}`);
  console.log(`결과 파일: ${OUT_FILE}`);
  console.log("");

  console.log("개발 서버 확인 중...");
  const up = await waitForServer(BASE_URL);
  if (!up) {
    console.error(`❌ ${BASE_URL} 에 연결할 수 없습니다.`);
    console.error("먼저 다른 터미널에서 아래를 실행하세요:");
    console.error("  npm run dev");
    process.exit(1);
  }
  console.log("✅ 개발 서버 확인됨\n");

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    locale: "ko-KR",
  });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err?.message || err));
  });

  const summary = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    iterations: ITERATIONS,
    success: 0,
    failure: 0,
    failures: [],
    outcomes: {},
  };

  try {
    await goToSearchScreen(page);

    for (let i = 1; i <= ITERATIONS; i++) {
      const input = makeRandomQuery(i);
      const beforeErrors = pageErrors.length;

      try {
        await ensureSearchScreen(page);
        const result = await runOneSearch(page, input);

        // 검색 도중 새로 난 페이지 예외가 있으면 실패로 간주
        const newErrors = pageErrors.slice(beforeErrors);
        if (newErrors.length > 0) {
          summary.failure += 1;
          summary.failures.push({
            iteration: i,
            input,
            outcome: "pageerror",
            errorMessage: newErrors.join(" | "),
          });
        } else if (result.ok) {
          summary.success += 1;
          summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1;
        } else {
          summary.failure += 1;
          summary.failures.push({
            iteration: i,
            input,
            outcome: result.outcome,
            errorMessage: result.message,
          });
        }

        await resetAfterSearch(page);
      } catch (err) {
        summary.failure += 1;
        summary.failures.push({
          iteration: i,
          input,
          outcome: "exception",
          errorMessage: String(err?.message || err),
        });
        try {
          await goToSearchScreen(page);
        } catch {
          // ignore recovery failure; next loop will retry
        }
      }

      if (i % 100 === 0 || i === ITERATIONS) {
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

    fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2), "utf8");
    await browser.close();
  }

  console.log("\n======== 결과 요약 ========");
  console.log(`성공: ${summary.success}`);
  console.log(`실패: ${summary.failure}`);
  console.log(`성공률: ${summary.successRate}%`);
  console.log(`결과 저장: ${OUT_FILE}`);
  if (summary.failure > 0) {
    console.log(`실패 케이스 ${Math.min(5, summary.failures.length)}개 미리보기:`);
    for (const f of summary.failures.slice(0, 5)) {
      console.log(`  #${f.iteration} input=${JSON.stringify(f.input)} → ${f.errorMessage}`);
    }
  }
}

main().catch((err) => {
  console.error("스트레스 테스트 실행 중 오류:", err);
  process.exit(1);
});
