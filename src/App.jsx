import { useState, useEffect, useRef } from "react";
import {
  Home,
  Search,
  Camera,
  Clock,
  ChevronLeft,
  ChevronRight,
  Volume2,
  Check,
  Plus,
  MessageCircle,
  MoreHorizontal,
  Scan,
} from "lucide-react";
import {
  runVisionSearch,
  recognizeDocumentPipeline,
  terminateOcrWorker,
  getSessionBagHints,
  setSessionBagContext,
  getPrescriptionDrugs,
  hasPrescriptionContext,
  clearPrescriptionContext,
  getPrescriptionDrugNames,
  evaluateCaptureQuality,
  createMessageThrottle,
  addFeedback,
  getFeedbackStats,
  getFeedbackCount,
  clearFeedback,
  isFeedbackImageAllowed,
  shouldRequestEnsemble,
  getEnsembleConfig,
  EnsembleBuffer,
  fuseEnsembleVotes,
  buildEnsemblePipelineResult,
  SmartStillCapture,
  getSmartStillConfig,
} from "./vision/pipeline.js";
import { formatMetricsSummary, getMetrics } from "./vision/metrics.js";
import { detectInstances } from "./vision/detectors/index.js";

function matchSourceLabel(source) {
  if (source === "prescription") return "처방 목록 매칭";
  if (source === "full_db") return "전체 DB 검색";
  if (source === "fallback_llm") return "AI 추정(낮은 정확도)";
  return null;
}

// ---- Design tokens (reference images) ----
const RED = "#E53E3E";
const RED_LIGHT = "#FFF5F5";
const BG = "#FFFFFF";
const CARD = "#FFFFFF";
const BLACK = "#1A1A1A";
const GRAY = "#9CA3AF";
const GRAY2 = "#6B7280";
const BORDER = "#E8E8E8";
const GREEN = "#059669";
const GREEN_BG = "#ECFDF5";
const BLUE_CARD = "#EFF6FF";
const SCAN_CARD_BG = "#E1DFFF";
const SCAN_BUTTON_BG = "#7A5AF8";
const SCAN_INACTIVE = "#C4B5FD";
const MANAGE_CARD_BG = "#D5F2DE";
const MANAGE_BUTTON_BG = "#34C759";
const SEARCH_BG = "#F6F6F6";
const DETAIL_CARD_BG = "#F8F9FB";
const DETAIL_CTA_BG = "#4669C9";

const API_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_KEY) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_KEY) ||
  "YOUR_SERVICE_KEY";

const HAS_API_KEY = !!API_KEY && API_KEY !== "YOUR_SERVICE_KEY";

const API_ENDPOINTS = {
  PILL_IDENTIFICATION: "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03",
  DRUG_EFFICACY: "https://apis.data.go.kr/B551182/msupCmpnMcareInfoService/getMsupCmpnMcareInq",
  DUR_INFO: "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03",
  EASY_DRUG_INFO: "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
};

const DATA_GO_PROXY_URL = "/api/data-go-proxy";

function normalizeItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  return [items];
}

async function dataGoFetchJson(action, query) {
  const qs = new URLSearchParams(query);
  const proxyUrl = `${DATA_GO_PROXY_URL}?action=${encodeURIComponent(action)}&${qs.toString()}`;
  try {
    const proxyRes = await fetch(proxyUrl);
    if (proxyRes.ok) return await proxyRes.json();
  } catch {}
  if (!HAS_API_KEY) {
    throw new Error("공공데이터 API 서비스 키가 설정되어 있지 않습니다.");
  }
  const baseUrl = API_ENDPOINTS[action];
  if (!baseUrl) throw new Error(`Unknown action: ${action}`);
  const directQuery = new URLSearchParams({ ...query, serviceKey: API_KEY });
  const res = await fetch(`${baseUrl}?${directQuery.toString()}`);
  if (!res.ok) throw new Error("공공 API 호출 실패");
  return await res.json();
}

async function searchPillList(itemName) {
  const q = String(itemName || "").trim();
  if (!q) return [];
  const map = new Map();
  try {
    const easy = await dataGoFetchJson("EASY_DRUG_INFO", { type: "json", numOfRows: "30", pageNo: "1", itemName: q });
    for (const it of normalizeItems(easy?.body?.items)) {
      const id = String(it.itemSeq || "");
      if (!id) continue;
      map.set(id, {
        id, itemSeq: id,
        name: it.itemName || "이름 없음",
        entpName: it.entpName || "",
        tag: "의약품",
        effect: it.efcyQesitm || "",
        timing: it.useMethodQesitm || "",
        caution: it.atpnWarnQesitm || it.atpnQesitm || "",
        imageUrl: it.itemImage || "",
      });
    }
  } catch (err) { console.warn("e약은요 검색 실패:", err); }
  try {
    const idnt = await dataGoFetchJson("PILL_IDENTIFICATION", { type: "json", numOfRows: "30", pageNo: "1", item_name: q });
    for (const it of normalizeItems(idnt?.body?.items)) {
      const id = String(it.ITEM_SEQ || "");
      if (!id) continue;
      const prev = map.get(id) || {};
      map.set(id, {
        ...prev, id, itemSeq: id,
        name: it.ITEM_NAME || prev.name || "이름 없음",
        entpName: it.ENTP_NAME || prev.entpName || "",
        tag: it.CLASS_NAME || prev.tag || "의약품",
        imageUrl: it.ITEM_IMAGE || prev.imageUrl || "",
        mark: it.PRINT_FRONT || "", shape: it.DRUG_SHAPE || "", color: it.COLOR_CLASS1 || "",
      });
    }
  } catch (err) { console.warn("낱알식별 검색 실패:", err); }
  return Array.from(map.values());
}

/** Map MFDS 낱알식별 item → candidate row */
function mapIdItem(it) {
  return {
    itemSeq: String(it.ITEM_SEQ || it.itemSeq || ""),
    name: it.ITEM_NAME || it.itemName || it.name || "",
    itemName: it.ITEM_NAME || it.itemName || it.name || "",
    entpName: it.ENTP_NAME || it.entpName || "",
    imageUrl: it.ITEM_IMAGE || it.imageUrl || "",
    tag: it.CLASS_NAME || it.tag || "의약품",
    mark: it.PRINT_FRONT || it.mark || "",
    PRINT_FRONT: it.PRINT_FRONT || it.mark || "",
    PRINT_BACK: it.PRINT_BACK || "",
    shape: it.DRUG_SHAPE || it.shape || "",
    DRUG_SHAPE: it.DRUG_SHAPE || it.shape || "",
    color: it.COLOR_CLASS1 || it.color || "",
    COLOR_CLASS1: it.COLOR_CLASS1 || it.color || "",
  };
}

/**
 * Low-level 낱알식별 fetch for imprint pipeline.
 * Accepts print_front / color_class1 / drug_shape / item_name query fields.
 */
async function apiFetchPillIdentification(query = {}) {
  const params = {
    type: "json",
    numOfRows: "20",
    pageNo: "1",
  };
  if (query.print_front) params.print_front = query.print_front;
  if (query.color_class1) params.color_class1 = query.color_class1;
  if (query.drug_shape) params.drug_shape = query.drug_shape;
  if (query.item_name) params.item_name = query.item_name;
  if (query.item_seq) params.item_seq = query.item_seq;

  // Guard: refuse empty / color-only without shape when no imprint and no name
  // (color+shape together is allowed for ambiguous shortlists)
  const hasMark = Boolean(params.print_front);
  const hasName = Boolean(params.item_name || params.item_seq);
  const hasColorShape = Boolean(params.color_class1 && params.drug_shape);
  const hasColorOrShape = Boolean(params.color_class1 || params.drug_shape);
  if (!hasMark && !hasName && !hasColorShape && !(hasColorOrShape && (params.color_class1 || params.drug_shape))) {
    // Allow single color OR shape for candidate shortlist, but only when imprint pipeline asks
    if (!hasColorOrShape) return [];
  }

  try {
    const json = await dataGoFetchJson("PILL_IDENTIFICATION", params);
    return normalizeItems(json?.body?.items).map(mapIdItem).filter((x) => x.itemSeq);
  } catch (err) {
    console.warn("apiFetchPillIdentification failed", err);
    return [];
  }
}

/** Vision Search candidate pool — imprint / name guided; color+shape shortlist allowed. */
async function fetchPillTopCandidates({ shape, color, mark, itemName, markCandidates } = {}, topK = 5) {
  const raw = [
    mark,
    ...((markCandidates || []).map((m) => (typeof m === "string" ? m : m.mark)).filter(Boolean)),
  ]
    .map((m) => String(m || "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((m) => m.length >= 2 && m.length <= 14);

  const expanded = [];
  for (const m of raw) {
    expanded.push(m);
    if (m.length >= 4) expanded.push(m.slice(0, 4), m.slice(0, 3));
    if (m.length >= 3) expanded.push(m.slice(0, 3));
  }

  const uniqueMarks = [...new Set(expanded)].slice(0, 6);
  const nameQ = String(itemName || "").trim();
  if (!uniqueMarks.length && !nameQ && !(color || shape)) return [];

  const map = new Map();

  const pull = async (query) => {
    const list = await apiFetchPillIdentification(query);
    for (const it of list) {
      if (!it.itemSeq || map.has(it.itemSeq)) continue;
      map.set(it.itemSeq, it);
    }
  };

  for (const m of uniqueMarks) {
    await pull({ print_front: m });
    if (color) await pull({ print_front: m, color_class1: color });
    if (shape) await pull({ print_front: m, drug_shape: shape });
  }
  if (nameQ) {
    await pull({ item_name: nameQ });
    try {
      const list = await searchPillList(nameQ);
      for (const it of list) {
        const mapped = mapIdItem(it);
        const id = mapped.itemSeq || String(it.itemSeq || it.id || "");
        if (!id || map.has(id)) continue;
        map.set(id, { ...mapped, itemSeq: id });
      }
    } catch {
      /* ignore */
    }
  }
  // Ambiguous shortlist when imprint missing
  if (!uniqueMarks.length && !nameQ && (color || shape)) {
    const q = {};
    if (color) q.color_class1 = color;
    if (shape) q.drug_shape = shape;
    await pull(q);
  }

  return Array.from(map.values()).slice(0, Math.max(topK, 10));
}

async function fetchPillIdentification({ shape, color, mark, itemName, itemSeq } = {}) {
  const cleanMark = String(mark || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // itemSeq lookup is exact; mark-less color/shape queries are forbidden (false positives)
  if (!itemSeq && !itemName && cleanMark.length < 2) {
    throw new Error("알약 각인(표기)을 읽지 못했습니다");
  }

  const query = {
    type: "json", numOfRows: "20", pageNo: "1",
    ...(itemSeq ? { item_seq: itemSeq } : {}),
    ...(itemName ? { item_name: itemName } : {}),
    ...(cleanMark ? { print_front: cleanMark } : {}),
    ...(color && cleanMark ? { color_class1: color } : {}),
    ...(shape && cleanMark ? { drug_shape: shape } : {}),
  };
  const json = await dataGoFetchJson("PILL_IDENTIFICATION", query);
  const items = normalizeItems(json?.body?.items);
  if (!items.length) throw new Error("일치하는 알약 정보를 찾을 수 없습니다");

  // Exact item_seq fetch
  if (itemSeq && !cleanMark) {
    const item = items[0];
    return {
      itemSeq: item.ITEM_SEQ || item.itemSeq,
      itemName: item.ITEM_NAME || item.itemName,
      entpName: item.ENTP_NAME || item.entpName,
      imageUrl: item.ITEM_IMAGE || item.itemImage,
      chart: item.CHART,
      tag: item.CLASS_NAME || "의약품",
    };
  }

  const upper = cleanMark;
  const scored = items
    .map((it) => {
      const front = String(it.PRINT_FRONT || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const back = String(it.PRINT_BACK || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      let score = 0;
      if (front === upper || back === upper) score += 100;
      else if (front.includes(upper) || upper.includes(front) || back.includes(upper) || upper.includes(back)) {
        const ref = front.includes(upper) || upper.includes(front) ? front : back;
        const overlap = Math.min(upper.length, ref.length) / Math.max(upper.length, ref.length, 1);
        score += Math.round(40 + 40 * overlap);
      } else if (upper.length >= 3 && front.length >= 3) {
        // prefix overlap (OCR clip)
        let pref = 0;
        while (pref < upper.length && pref < front.length && upper[pref] === front[pref]) pref += 1;
        if (pref >= 2) score += 25 + pref * 5;
      }
      if (color && String(it.COLOR_CLASS1 || "").includes(color)) score += 15;
      if (shape && String(it.DRUG_SHAPE || "").includes(String(shape).replace("형", ""))) score += 10;
      return { it, score };
    })
    .sort((a, b) => b.score - a.score);

  // print_front query already constrained results — accept moderate imprint overlap
  if (!scored[0] || scored[0].score < 30) {
    throw new Error("각인이 일치하는 알약을 찾지 못했습니다");
  }

  const item = scored[0].it;
  return {
    itemSeq: item.ITEM_SEQ || item.itemSeq,
    itemName: item.ITEM_NAME || item.itemName,
    entpName: item.ENTP_NAME || item.entpName,
    imageUrl: item.ITEM_IMAGE || item.itemImage,
    chart: item.CHART,
    tag: item.CLASS_NAME || "의약품",
  };
}

async function fetchEasyDrugInfo(itemSeq, itemName) {
  try {
    const query = { type: "json", numOfRows: "1", pageNo: "1", ...(itemSeq ? { itemSeq } : {}), ...(itemName ? { itemName } : {}) };
    const json = await dataGoFetchJson("EASY_DRUG_INFO", query);
    const item = normalizeItems(json?.body?.items)?.[0];
    return {
      usageText: item?.useMethodQesitm || "복용법 정보 없음",
      cautionText: item?.atpnWarnQesitm || item?.atpnQesitm || "주의사항 정보 없음",
      effectText: item?.efcyQesitm || "",
      name: item?.itemName || "",
      imageUrl: item?.itemImage || "",
    };
  } catch { return { usageText: "복용법 정보 없음", cautionText: "주의사항 정보 없음", effectText: "" }; }
}

async function fetchDurWarning(itemSeq, currentItemSeqs = []) {
  if (!currentItemSeqs.length) return { hasWarning: false, message: "" };
  try {
    const json = await dataGoFetchJson("DUR_INFO", { type: "json", itemSeq, itemSeqs: currentItemSeqs.join(",") });
    const items = normalizeItems(json?.body?.items);
    if (!items.length) return { hasWarning: false, message: "" };
    const msgs = items.map((it) => it.MIXTURE_ITEM_NAME ? `${it.MIXTURE_ITEM_NAME}와(과) 병용 주의` : it.PROHBT_CONTENT).filter(Boolean);
    return { hasWarning: msgs.length > 0, message: msgs.join(" · ") };
  } catch { return { hasWarning: false, message: "" }; }
}

async function fetchPillDetailBySeq(itemSeq, nameHint = "", currentSchedule = []) {
  const currentItemSeqs = currentSchedule.map((m) => m.itemSeq).filter(Boolean);
  const [dur, easyInfo, idnt] = await Promise.all([
    fetchDurWarning(itemSeq, currentItemSeqs),
    fetchEasyDrugInfo(itemSeq, nameHint),
    fetchPillIdentification({ itemSeq, itemName: nameHint }).catch(() => null),
  ]);
  return {
    id: itemSeq, itemSeq,
    name: idnt?.itemName || easyInfo.name || nameHint || "알약",
    tag: idnt?.tag || "의약품",
    time: "처방 정보 확인",
    timing: easyInfo.usageText,
    effect: easyInfo.effectText || idnt?.tag || "정보 없음",
    caution: dur.hasWarning ? `${easyInfo.cautionText} · [병용주의] ${dur.message}` : easyInfo.cautionText,
    durWarning: dur.hasWarning ? dur.message : null,
    imageUrl: idnt?.imageUrl || easyInfo.imageUrl,
    entpName: idnt?.entpName || "",
  };
}

async function fetchPillData(params = {}, currentSchedule = []) {
  const identification = await fetchPillIdentification(params);
  const { itemSeq } = identification;
  const currentItemSeqs = currentSchedule.map((m) => m.itemSeq).filter(Boolean);
  const [dur, easyInfo] = await Promise.all([
    fetchDurWarning(itemSeq, currentItemSeqs),
    fetchEasyDrugInfo(itemSeq, identification.itemName),
  ]);
  return {
    id: itemSeq, itemSeq,
    name: identification.itemName || easyInfo.name,
    tag: identification.tag,
    time: "처방 정보 확인",
    timing: easyInfo.usageText,
    effect: easyInfo.effectText || identification.tag,
    caution: dur.hasWarning ? `${easyInfo.cautionText} · [병용주의] ${dur.message}` : easyInfo.cautionText,
    durWarning: dur.hasWarning ? dur.message : null,
    imageUrl: identification.imageUrl || easyInfo.imageUrl,
    entpName: identification.entpName || "",
  };
}

const CATEGORIES = [
  { label: "가래 / 몸살", subtitle: "종합감기약, 기침, 콧물약", emoji: "🤒", q: "감기" },
  { label: "두통 / 치통", subtitle: "해열진통제, 빠른 통증 완화약", emoji: "🤕", q: "두통" },
  { label: "생리통 / 통증", subtitle: "생리통 전용 진통제, 여성 진통제", emoji: "😣", q: "생리통" },
  { label: "소화불량 / 위통", subtitle: "소화제, 위산분비억제제, 제산제", emoji: "🤢", q: "소화불량" },
  { label: "근육통 / 관절염", subtitle: "소염진통제, 바르는 겔, 붙이는 파스류", emoji: "💪", q: "근육통" },
  { label: "비염 / 알레르기", subtitle: "항히스타민제, 코 스프레이", emoji: "🤧", q: "알레르기" },
  { label: "상처 / 피부질환", subtitle: "연고, 습윤밴드, 두드러기 약", emoji: "🩹", q: "피부" },
  { label: "눈 건강 / 안약", subtitle: "인공눈물, 충혈 완화제, 다래끼 약", emoji: "👁️", q: "안약" },
  { label: "만성질환 / 처방약", subtitle: "혈압, 당뇨 등 정기 복용약 관리용", emoji: "🏥", q: "고혈압" },
  { label: "피로회복 / 비타민", subtitle: "종합 비타민, 피로회복제, 영양제", emoji: "🔋", q: "비타민" },
  { label: "유산균 / 장 건강", subtitle: "프로바이오틱스, 정장제, 지사제", emoji: "🌀", q: "유산균" },
];

function speak(text) {
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ko-KR";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch (e) { console.error("TTS error", e); }
}

// ---- UI Components ----

function Card({ children, className = "", style = {}, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`bg-white rounded-2xl shadow-sm ${className}`}
      style={{ ...style }}
    >
      {children}
    </Tag>
  );
}

function BottomNav({ screen, setScreen }) {
  // 스펙: 홈 / + / 중앙 스캔 / 시계 / 말풍선
  // + 는 기존 약 찾기(search) 네비게이션 로직 유지
  const leftItems = [
    { key: "home", icon: Home },
    { key: "search", icon: Plus },
  ];
  const rightItems = [
    { key: "management", icon: Clock },
    { key: "chat", icon: MessageCircle, noop: true },
  ];
  const muted = "#A8B3C4";
  const scanActive = screen === "scan";

  return (
    <div
      className="absolute bottom-0 left-0 right-0 bg-white border-t flex items-end justify-around px-2 pt-2 pb-3 z-20"
      style={{ borderColor: BORDER }}
    >
      {leftItems.map((it) => {
        const Icon = it.icon;
        const active = screen === it.key;
        return (
          <button
            key={it.key}
            onClick={() => setScreen(it.key)}
            className="flex items-center justify-center w-12 h-12"
            aria-label={it.key}
          >
            <Icon size={26} color={active ? "#4B5563" : muted} strokeWidth={active ? 2.4 : 2} />
          </button>
        );
      })}

      <button
        onClick={() => setScreen("scan")}
        className="flex items-center justify-center w-[64px] h-[64px] rounded-full -mt-6 shadow-lg"
        style={{ backgroundColor: scanActive ? SCAN_BUTTON_BG : SCAN_INACTIVE }}
        aria-label="촬영"
      >
        <Scan size={28} color="#FFFFFF" strokeWidth={2.4} />
      </button>

      {rightItems.map((it) => {
        const Icon = it.icon;
        const active = screen === it.key;
        return (
          <button
            key={it.key}
            onClick={() => {
              if (!it.noop) setScreen(it.key);
            }}
            className="flex items-center justify-center w-12 h-12"
            aria-label={it.key}
          >
            <Icon size={26} color={active ? "#4B5563" : muted} strokeWidth={active ? 2.4 : 2} />
          </button>
        );
      })}
    </div>
  );
}

function CapsuleIllustration() {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" aria-hidden="true">
      <ellipse cx="44" cy="48" rx="34" ry="12" fill="#C4B5FD" opacity="0.35" />
      <g transform="rotate(-35 44 40)">
        <rect x="14" y="28" width="60" height="26" rx="13" fill="#A78BFA" />
        <rect x="14" y="28" width="30" height="26" rx="13" fill="#67E8F9" />
        <rect x="40" y="28" width="8" height="26" fill="#F8FAFC" opacity="0.9" />
      </g>
      <circle cx="62" cy="22" r="4" fill="#93C5FD" />
      <circle cx="70" cy="30" r="3" fill="#F8FAFC" stroke="#93C5FD" />
      <circle cx="58" cy="32" r="2.5" fill="#60A5FA" />
    </svg>
  );
}

function ClipboardIllustration() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <rect x="18" y="14" width="36" height="46" rx="6" stroke="#34C759" strokeWidth="2.5" fill="#FFFFFF" />
      <rect x="28" y="10" width="16" height="8" rx="3" stroke="#EC4899" strokeWidth="2" fill="#FFFFFF" />
      <path d="M28 30h16M28 38h16M28 46h10" stroke="#60A5FA" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M48 48l4 4 8-10" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="52" cy="22" r="3" stroke="#EC4899" strokeWidth="1.8" fill="none" />
    </svg>
  );
}

// ---- Screens ----

function HomeScreen({ setScreen, setActivePill, setDetailSource, schedule }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28" style={{ backgroundColor: BG }}>
      {/* 1. 상단: 로고 + 인사 / 메뉴(기존 피드백 화면 진입 유지) */}
      <div className="px-5 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-extrabold text-[15px]"
            style={{ backgroundColor: RED }}
            aria-hidden="true"
          >
            약
          </div>
          <p className="text-[22px] font-extrabold" style={{ color: BLACK }}>양우진 님</p>
        </div>
        <button
          type="button"
          onClick={() => setScreen("feedbackStats")}
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "#F3F4F6" }}
          aria-label={`피드백 ${getFeedbackCount()}`}
        >
          <MoreHorizontal size={22} color="#6B7280" />
        </button>
      </div>

      {/* 2. 검색창 — 기존 약 찾기 이동 로직 유지 */}
      <div className="px-5 pt-1">
        <button
          type="button"
          onClick={() => setScreen("search")}
          className="w-full min-h-[52px] rounded-2xl flex items-center px-4 gap-3 text-left"
          style={{ backgroundColor: SEARCH_BG }}
        >
          <span className="flex-1 text-[16px]" style={{ color: GRAY }}>검색하기</span>
          <Search size={22} color={GRAY} />
        </button>
      </div>

      {/* 3. 카드 A — 알약 촬영하기 */}
      <div className="px-5 pt-5">
        <div
          className="w-full rounded-[28px] p-5 relative overflow-hidden text-left"
          style={{ backgroundColor: SCAN_CARD_BG }}
        >
          <div className="pr-[96px]">
            <p className="text-[22px] font-extrabold leading-tight" style={{ color: BLACK }}>알약 촬영하기</p>
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: BLACK }}>
              알약을 카메라로 촬영하면 종류와 복용 방법을 자동으로 찾아드려요.
            </p>
            <button
              type="button"
              onClick={() => setScreen("scan")}
              className="mt-4 min-h-[44px] px-5 rounded-xl font-bold text-[15px] text-white inline-flex items-center justify-center active:scale-[0.98] transition-transform"
              style={{ backgroundColor: SCAN_BUTTON_BG }}
            >
              촬영하러 가기
            </button>
          </div>
          <div className="absolute right-2 bottom-3 pointer-events-none">
            <CapsuleIllustration />
          </div>
        </div>
      </div>

      {/* 4. 카드 B — 복용 관리 */}
      <div className="px-5 pt-4">
        <div
          className="w-full rounded-[28px] p-5 relative overflow-hidden text-left"
          style={{ backgroundColor: MANAGE_CARD_BG }}
        >
          <div className="pr-[88px]">
            <p className="text-[22px] font-extrabold leading-tight" style={{ color: BLACK }}>복용 관리</p>
            <p className="text-[13px] mt-2 leading-relaxed" style={{ color: BLACK }}>
              오늘 먹을 약, 잊지 말고 챙기세요
            </p>
            <button
              type="button"
              onClick={() => setScreen("management")}
              className="mt-4 min-h-[44px] px-5 rounded-xl font-bold text-[15px] text-white inline-flex items-center justify-center active:scale-[0.98] transition-transform"
              style={{ backgroundColor: MANAGE_BUTTON_BG }}
            >
              복용 기록하기
            </button>
          </div>
          <div className="absolute right-3 bottom-4 pointer-events-none">
            <ClipboardIllustration />
          </div>
        </div>
      </div>

      {/* 5~6. 자주 먹는 약 — schedule 기반 데이터/상세 이동 로직 유지 */}
      <div className="pt-7 pb-4">
        <div className="px-5 flex items-center justify-between mb-3">
          <p className="text-[18px] font-extrabold" style={{ color: BLACK }}>자주 먹는 약</p>
          <button
            type="button"
            onClick={() => setScreen("management")}
            className="text-[14px] font-semibold"
            style={{ color: SCAN_BUTTON_BG }}
          >
            전체 확인
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto px-5 pb-1 scrollbar-hide">
          {schedule.length === 0 && (
            <div
              className="min-w-[140px] p-4 rounded-2xl border flex flex-col items-center justify-center gap-2"
              style={{ borderColor: BORDER, backgroundColor: CARD }}
            >
              <p className="text-[13px] text-center" style={{ color: GRAY }}>등록된 약이 없어요</p>
            </div>
          )}
          {schedule.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setDetailSource("search");
                setActivePill(p);
                setScreen("detail");
              }}
              className="w-[132px] flex-shrink-0 rounded-2xl border bg-white text-left overflow-hidden"
              style={{ borderColor: BORDER }}
            >
              <div
                className="w-full h-[96px] flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: "#F9FAFB" }}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain p-2" />
                ) : (
                  <span className="text-[12px] font-bold" style={{ color: GRAY }}>이미지 없음</span>
                )}
              </div>
              <div className="px-3 py-2.5">
                <p className="text-[14px] font-extrabold leading-tight truncate" style={{ color: BLACK }}>
                  {p.name}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: GRAY }}>{p.tag}</p>
                {p.timing ? (
                  <p className="text-[12px] font-bold mt-1.5 leading-snug line-clamp-2" style={{ color: BLACK }}>
                    {String(p.timing).length > 24 ? `${String(p.timing).slice(0, 24)}…` : p.timing}
                  </p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchScreen({ setScreen, setActivePill, setDetailSource, schedule }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [results, setResults] = useState([]);

  const runSearch = async (name) => {
    const q = String(name || "").trim();
    if (!q) return;
    setErrorMsg("");
    setLoading(true);
    setResults([]);
    try {
      const list = await searchPillList(q);
      if (!list.length) setErrorMsg("검색 결과가 없습니다.");
      else setResults(list);
    } catch (err) { setErrorMsg(err.message || "검색 실패"); }
    finally { setLoading(false); }
  };

  const openDetail = async (item) => {
    setLoading(true);
    try {
      const detail = await fetchPillDetailBySeq(item.itemSeq, item.name, schedule);
      setDetailSource("search");
      setActivePill(detail);
      setScreen("detail");
    } catch {
      setDetailSource("search");
      setActivePill({
        id: item.itemSeq, itemSeq: item.itemSeq, name: item.name, tag: item.tag || "의약품",
        time: "처방 정보 확인", timing: item.timing || "복용법 정보 없음",
        effect: item.effect || "정보 없음", caution: item.caution || "주의사항 정보 없음",
        durWarning: null, imageUrl: item.imageUrl || "",
      });
      setScreen("detail");
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full pb-28" style={{ backgroundColor: BG }}>
      {/* Header: 뒤로가기 + 중앙 제목 */}
      <div className="px-5 pt-6 pb-3 flex items-center justify-center relative bg-white">
        <button
          onClick={() => setScreen("home")}
          className="absolute left-4 w-[40px] h-[40px] flex items-center justify-center"
        >
          <ChevronLeft size={28} color={BLACK} />
        </button>
        <p className="text-[20px] font-extrabold" style={{ color: BLACK }}>약 찾기</p>
      </div>

      {/* Search input */}
      <div className="px-4 pt-3">
        <div
          className="w-full flex items-center px-4 py-3 gap-2 rounded-2xl"
          style={{ backgroundColor: SEARCH_BG }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) runSearch(query); }}
            placeholder="약의 이름이나 형태, 효능군 등을 입력해주세요"
            className="flex-1 text-[14px] outline-none bg-transparent"
            style={{ color: BLACK }}
          />
          <button type="button" onClick={() => runSearch(query)} aria-label="검색">
            <Search size={20} color={GRAY} />
          </button>
        </div>
        {loading && <p className="text-[14px] font-bold mt-2 text-center" style={{ color: RED }}>검색 중...</p>}
        {errorMsg && !loading && <p className="text-[14px] mt-2 text-center" style={{ color: GRAY2 }}>{errorMsg}</p>}
      </div>

      {/* Categories or results */}
      {!results.length && !loading ? (
        <div className="px-4 pt-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((c) => (
              <div
                key={c.label}
                className="relative rounded-2xl border bg-white p-3 min-h-[132px] flex flex-col items-start text-left"
                style={{ borderColor: BORDER }}
              >
                <span className="text-[28px] leading-none">{c.emoji}</span>
                <p className="text-[14px] font-extrabold mt-2 leading-tight" style={{ color: BLACK }}>{c.label}</p>
                <p className="text-[11px] mt-1 leading-snug pr-8" style={{ color: GRAY }}>{c.subtitle}</p>
                <button
                  type="button"
                  onClick={() => { setQuery(c.q); runSearch(c.q); }}
                  className="absolute bottom-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: SCAN_BUTTON_BG }}
                  aria-label={`${c.label} 검색`}
                >
                  <Plus size={18} color="#fff" strokeWidth={2.6} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 pt-3 overflow-y-auto flex-1">
          <p className="text-[13px] font-bold mb-2" style={{ color: GRAY }}>검색 결과 {results.length}건</p>
          <div className="flex flex-col gap-2 pb-4">
            {results.map((p) => (
              <Card key={p.id} className="w-full flex items-center gap-3 px-3 py-3 text-left" onClick={() => openDetail(p)}>
                <div className="w-[56px] h-[56px] rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F9FAFB" }}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[12px] font-bold" style={{ color: GRAY }}>약</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold leading-tight" style={{ color: BLACK }}>{p.name}</p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: GRAY }}>{[p.entpName, p.tag].filter(Boolean).join(" · ")}</p>
                </div>
                <ChevronRight size={18} color={GRAY} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScanScreen({ setScreen, setActivePill, setDetailSource, schedule }) {
  const [status, setStatus] = useState("scanning"); // scanning | loading | results | error
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [manualMark, setManualMark] = useState("");
  const [detectedMarks, setDetectedMarks] = useState([]);
  const [foundPills, setFoundPills] = useState([]);
  const [pillBoxes, setPillBoxes] = useState([]);
  const [debugMode, setDebugMode] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);
  const [metricsSnap, setMetricsSnap] = useState(null);
  const [dualMode, setDualMode] = useState(false); // front+back fusion
  const [frontCrop, setFrontCrop] = useState(null);
  const [captureSide, setCaptureSide] = useState("front"); // front | back
  const [accuracyWarning, setAccuracyWarning] = useState("");
  const [qualityHint, setQualityHint] = useState("");
  const [qualityOk, setQualityOk] = useState(true);
  const [ensembleActive, setEnsembleActive] = useState(false);
  const cancelledRef = useRef(false);
  const processingRef = useRef(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  const stopCamera = () => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const openCamera = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("카메라를 지원하지 않는 브라우저입니다.");
      return false;
    }
    if (!window.isSecureContext) {
      setCameraError("HTTPS 또는 localhost에서만 카메라를 사용할 수 있습니다.");
      return false;
    }
    setCameraError("");
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {}
      }
      return true;
    } catch {
      setCameraError("카메라 권한을 허용해주세요.");
      return false;
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    openCamera();
    return () => {
      cancelledRef.current = true;
      stopCamera();
      terminateOcrWorker();
    };
  }, []);

  // Higher-res capture for multi-scale detection (640/960/1280)
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const crop = Math.min(vw, vh) * 0.9;
    const sx = (vw - crop) / 2;
    const sy = (vh - crop) / 2;
    const out = 960;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, crop, crop, 0, 0, out, out);
    return canvas;
  };

  const boxesFromDetections = (detections, frameW, frameH) =>
    (detections || []).map((d) => ({
      left: (d.box.x / frameW) * 100,
      top: (d.box.y / frameH) * 100,
      width: (d.box.w / frameW) * 100,
      height: (d.box.h / frameH) * 100,
      confidence: d.confidence,
      mark: d.mark,
      shape: d.shape,
      cropUrl: debugMode && d.cropCanvas ? d.cropCanvas.toDataURL("image/jpeg", 0.6) : null,
      maskUrl: debugMode && d.maskCanvas ? d.maskCanvas.toDataURL("image/png") : null,
    }));

  const candidateFetcher = async (features) =>
    fetchPillTopCandidates({
      mark: features.mark,
      color: features.color,
      shape: features.shape,
      markCandidates: features.markCandidates,
      itemName: features.itemName,
    }, 10);

  const finalizePipelineResults = async (pipelineResult) => {
    processingRef.current = true;
    setStatus("loading");

    // Accept DB hits; exact imprint can be slightly lower threshold than color-only
    const hits = (pipelineResult.results || []).filter((r) => {
      if (!r.best) return false;
      const conf = r.fusedConfidence ?? r.best.fusedScore ?? 0;
      const tier = r.matchTier || r.best.matchTier || "";
      if (tier === "exact") return conf >= 0.28;
      if (tier === "partial") return conf >= 0.35;
      if (tier === "fallback") return conf >= 0.2; // shown with lowAccuracy warning
      if (tier === "color_shape") return conf >= 0.4;
      return conf >= 0.35;
    });
    const marks = [...new Set(hits.map((r) => r.mark || r.imprintFront).filter(Boolean))];
    setDetectedMarks(marks);

    const anyLow = (pipelineResult.results || []).some((r) => r.lowAccuracy);
    if (anyLow) {
      setAccuracyWarning("정확도가 낮을 수 있습니다. 후보를 확인해 주세요.");
    } else {
      setAccuracyWarning("");
    }

    if (debugMode) {
      setDebugInfo(pipelineResult.debug);
      setMetricsSnap(formatMetricsSummary(getMetrics()));
    }

    if (!hits.length) {
      processingRef.current = false;
      return false;
    }

    try {
      const settled = await Promise.allSettled(
        hits.map(async (r) => {
          const best = r.best;
          const seq = best.itemSeq || best.ITEM_SEQ;
          if (seq) {
            const detail = await fetchPillDetailBySeq(seq, best.name || best.itemName, schedule);
            return {
              ...detail,
              detectedMark: r.mark,
              rerankScore: best.rerankScore,
              matchSource: r.matchSource || best.matchSource || null,
            };
          }
          return fetchPillData(
            { mark: r.mark, color: r.color, shape: r.shape },
            schedule
          ).then((p) => ({
            ...p,
            detectedMark: r.mark,
            matchSource: r.matchSource || null,
          }));
        })
      );
      if (cancelledRef.current) return true;

      const pills = [];
      const seen = new Set();
      for (const res of settled) {
        if (res.status !== "fulfilled" || !res.value) continue;
        const pill = res.value;
        const key = String(pill.itemSeq || pill.id);
        if (seen.has(key)) continue;
        seen.add(key);
        pills.push(pill);
      }

      if (!pills.length) {
        processingRef.current = false;
        return false;
      }

      if (pills.length === 1) {
        setStatus("found");
        setDetailSource("scan");
        setActivePill(pills[0]);
        setScreen("detail");
        return true;
      }

      setFoundPills(pills);
      setStatus("results");
      stopCamera();
      return true;
    } catch (err) {
      if (cancelledRef.current) return true;
      setStatus("error");
      setErrorMsg(err.message || "알약을 찾을 수 없습니다");
      return true;
    }
  };

  const lookupMarks = async (detections) => {
    processingRef.current = true;
    setStatus("loading");
    const list = Array.isArray(detections)
      ? detections.map((d) => (typeof d === "string" ? { mark: d, color: "" } : d))
      : [];
    const marks = list.map((d) => d.mark);
    setDetectedMarks(marks);

    try {
      const settled = await Promise.allSettled(
        list
          .filter((d) => d.mark && String(d.mark).replace(/[^A-Za-z0-9]/g, "").length >= 2)
          .map((d) =>
            fetchPillData(
              {
                mark: d.mark,
                ...(d.color ? { color: d.color } : {}),
              },
              schedule
            )
          )
      );
      if (cancelledRef.current) return;

      const pills = [];
      const seen = new Set();
      settled.forEach((res, idx) => {
        if (res.status !== "fulfilled" || !res.value) return;
        const pill = res.value;
        const key = String(pill.itemSeq || pill.id || marks[idx]);
        if (seen.has(key)) return;
        seen.add(key);
        pills.push({ ...pill, detectedMark: marks[idx] });
      });

      if (!pills.length) {
        setStatus("error");
        setErrorMsg("인식된 표기로 약을 찾지 못했습니다. 직접 입력해보세요.");
        return;
      }

      if (pills.length === 1) {
        setStatus("found");
        setDetailSource("scan");
        setActivePill(pills[0]);
        setScreen("detail");
        return;
      }

      setFoundPills(pills);
      setStatus("results");
      stopCamera();
    } catch (err) {
      if (cancelledRef.current) return;
      setStatus("error");
      setErrorMsg(err.message || "알약을 찾을 수 없습니다");
    }
  };

  const runManualSearch = async () => {
    const manual = String(manualMark || "").trim();
    if (!manual) return;
    setErrorMsg("");
    const marks = manual
      .toUpperCase()
      .split(/[\s,./|]+/)
      .map((m) => m.trim())
      .filter((m) => m.length >= 2);
    await lookupMarks(marks.length ? marks.map((m) => ({ mark: m, color: "" })) : [{ mark: manual, color: "" }]);
  };

  const openPill = (pill) => {
    setDetailSource("scan");
    setActivePill(pill);
    setScreen("detail");
  };

  const [resumeKey, setResumeKey] = useState(0);

  const resumeScanning = async () => {
    setFoundPills([]);
    setDetectedMarks([]);
    setPillBoxes([]);
    setDebugInfo(null);
    setErrorMsg("");
    setManualMark("");
    setFrontCrop(null);
    setCaptureSide("front");
    processingRef.current = false;
    setStatus("scanning");
    await openCamera();
    setResumeKey((k) => k + 1);
  };

  // Detection → Classification → Re-rank pipeline loop
  useEffect(() => {
    if (cameraError) return;

    cancelledRef.current = false;
    processingRef.current = false;
    setStatus("scanning");
    setDetectedMarks([]);
    setPillBoxes([]);
    setErrorMsg("");
    setEnsembleActive(false);

    let timerId = null;
    let stopped = false;
    let emptyTries = 0;
    let totalTries = 0;
    const throttleMsg = createMessageThrottle(400);
    const ensembleCfg = getEnsembleConfig();
    const ensembleBuf = new EnsembleBuffer(ensembleCfg);
    const smartStill = new SmartStillCapture(getSmartStillConfig());
    let lastPipelineForEnsemble = null;
    let stillPhaseDone = false;
    let previewCountTick = 0;

    const fail = (msg) => {
      stopped = true;
      processingRef.current = true;
      setStatus("error");
      setErrorMsg(msg);
      setDetectedMarks([]);
      setEnsembleActive(false);
      ensembleBuf.reset();
      smartStill.reset();
    };

    const runSearchOnCanvas = async (canvas) =>
      runVisionSearch(canvas, {
        candidateFetcher,
        apiFetch: apiFetchPillIdentification,
        bagHints: getSessionBagHints(),
        candidatePool: getPrescriptionDrugs(),
        frontBack: null,
        debug: debugMode,
        maxInstances: 6,
        shareByEmbedding: true,
        scales: [640, 960],
        minConfidenceKeep: 0.2,
        twoPass: true,
        topK: 10,
      });

    const tick = async () => {
      if (stopped || cancelledRef.current || processingRef.current) return;
      if (!videoRef.current?.videoWidth) {
        timerId = setTimeout(tick, 150);
        return;
      }

      const frame = captureFrame();
      if (!frame) {
        timerId = setTimeout(tick, 150);
        return;
      }

      // Phase 2: live quality (realtime track)
      const quality = evaluateCaptureQuality(frame, { mode: "pill" });
      setQualityOk(quality.ok);
      if (!quality.ok) {
        const text = quality.messages[0] || "초점을 맞춰 주세요";
        const shown = throttleMsg(text);
        if (shown) setQualityHint(shown);
        // still observe failed frames for score history continuity
        smartStill.observe(frame, quality);
        timerId = setTimeout(tick, 200);
        return;
      }

      // Lightweight preview object count (not shown as photo)
      let previewObjectCount;
      previewCountTick += 1;
      if (previewCountTick % 3 === 0) {
        try {
          const light = await detectInstances(frame, {
            scales: [640],
            marginRatio: 0.12,
            twoPass: false,
            minConfidenceKeep: 0.22,
          });
          previewObjectCount = (light.detections || []).length;
        } catch {
          /* ignore */
        }
      }

      const stillStatus = smartStill.observe(frame, quality, { previewObjectCount });
      if (stillStatus.captured) {
        const shown = throttleMsg(`좋은 순간 포착 (${stillStatus.stillCount}/${stillStatus.need})`);
        if (shown) setQualityHint(shown);
      } else if (!stillStatus.ready) {
        const shown = throttleMsg(
          `안정된 순간을 담는 중… (${stillStatus.stillCount}/${stillStatus.need})`
        );
        if (shown) setQualityHint(shown);
      }

      // Collect silent stills (B+C) before heavy OCR/API
      if (!stillPhaseDone && !stillStatus.ready) {
        timerId = setTimeout(tick, 180);
        return;
      }

      // Timeout with zero stills → try current frame once if quality ok
      if (!stillPhaseDone && stillStatus.ready && stillStatus.empty) {
        smartStill.stills.push({ canvas: frame, score: quality.score, ts: Date.now(), method: "fallback-live" });
      }
      stillPhaseDone = true;

      totalTries += 1;
      if (totalTries > 12) {
        fail("알약 인식에 실패했습니다. 각인(글자)이 보이게 가까이 비추거나, 표기를 직접 입력해주세요.");
        return;
      }

      try {
        const rankedStills = smartStill.pickRanked();
        const bestStill = rankedStills[0] || { canvas: frame, score: quality.score };
        const analyzeList = rankedStills.length
          ? rankedStills.slice(0, Math.min(3, rankedStills.length))
          : [bestStill];

        const okMsg = throttleMsg(
          analyzeList.length > 1
            ? `선명 컷 ${analyzeList.length}장으로 확인 중…`
            : "선명 컷으로 인식 중…"
        );
        if (okMsg) setQualityHint(okMsg);
        setEnsembleActive(analyzeList.length > 1);

        let pipelineResult = await runSearchOnCanvas(bestStill.canvas);

        // Dual-side fusion path (optional)
        if (dualMode && frontCrop && pipelineResult.results?.[0]?.cropCanvas) {
          pipelineResult = await runVisionSearch(bestStill.canvas, {
            candidateFetcher,
            apiFetch: apiFetchPillIdentification,
            bagHints: getSessionBagHints(),
            candidatePool: getPrescriptionDrugs(),
            frontBack: {
              frontCanvas: frontCrop,
              backCanvas: pipelineResult.results[0].cropCanvas,
            },
            debug: debugMode,
            maxInstances: 1,
            shareByEmbedding: false,
            scales: [640, 960],
            topK: 10,
          });
        }

        // Multi-still ensemble: analyze extra silent stills and fuse votes
        if (analyzeList.length > 1) {
          ensembleBuf.reset();
          ensembleBuf.start();
          const firstBest = (pipelineResult.results || []).filter((d) => d.best);
          if (firstBest.length) {
            lastPipelineForEnsemble = pipelineResult;
            ensembleBuf.addFrame(firstBest);
          }
          for (const still of analyzeList.slice(1)) {
            const extra = await runSearchOnCanvas(still.canvas);
            const hits = (extra.results || []).filter((d) => d.best);
            if (hits.length) {
              lastPipelineForEnsemble = extra;
              ensembleBuf.addFrame(hits);
            }
          }
          if (ensembleBuf.getFrames().length >= 1) {
            const fused = fuseEnsembleVotes(ensembleBuf.getFrames());
            pipelineResult = buildEnsemblePipelineResult(
              lastPipelineForEnsemble || pipelineResult,
              fused
            );
          }
          ensembleBuf.reset();
        }
        setEnsembleActive(false);

        if (stopped || cancelledRef.current || processingRef.current) return;

        const dets = pipelineResult.results || [];
        setPillBoxes(boxesFromDetections(dets, bestStill.canvas.width, bestStill.canvas.height));
        if (debugMode) {
          setDebugInfo({
            ...(pipelineResult.debug || {}),
            smartStill: {
              count: smartStill.stills.length,
              scores: smartStill.stills.map((s) => Number(s.score.toFixed(3))),
              previewCountMode: smartStill.previewObjectCountMode(),
            },
          });
          setMetricsSnap(formatMetricsSummary(getMetrics()));
        }

        // Cross-check preview object count vs final detections
        const previewMode = smartStill.previewObjectCountMode();
        const finalCount = dets.filter((d) => d.best).length || dets.length;
        if (previewMode != null && finalCount > 0 && Math.abs(previewMode - finalCount) >= 2) {
          setAccuracyWarning(
            `실시간 추적(~${previewMode}개)과 최종 결과(${finalCount}개)가 달라 정확도가 낮을 수 있습니다.`
          );
        }

        const withMark = dets.filter((d) => d.mark && d.mark.length >= 2);
        const withBest = dets.filter((d) => {
          if (!d.best) return false;
          const conf = d.fusedConfidence ?? d.best.fusedScore ?? 0;
          const tier = d.matchTier || d.best.matchTier || "";
          if (tier === "exact") return conf >= 0.28;
          if (tier === "partial") return conf >= 0.35;
          if (tier === "color_shape" || tier === "fallback") return conf >= 0.32;
          return conf >= 0.35;
        });
        if (dets.some((d) => d.lowAccuracy)) {
          setAccuracyWarning((prev) => prev || "정확도가 낮을 수 있습니다. 후보를 확인해 주세요.");
        }

        if (withMark.length) {
          setDetectedMarks([...new Set(withMark.map((d) => d.mark))]);
        }

        if (dualMode && !frontCrop && dets[0]?.cropCanvas) {
          const c = document.createElement("canvas");
          c.width = dets[0].cropCanvas.width;
          c.height = dets[0].cropCanvas.height;
          c.getContext("2d").drawImage(dets[0].cropCanvas, 0, 0);
          setFrontCrop(c);
          setCaptureSide("back");
          stillPhaseDone = false;
          smartStill.reset();
          timerId = setTimeout(tick, 400);
          return;
        }

        if (!withMark.length && !withBest.length) {
          emptyTries += 1;
          // Allow one more smart-still cycle
          if (emptyTries >= 3) {
            fail("알약 각인(표기)을 읽지 못했습니다. 글자가 선명하게 보이게 비추거나 직접 입력해주세요.");
            return;
          }
          stillPhaseDone = false;
          smartStill.reset();
          timerId = setTimeout(tick, 220);
          return;
        }

        emptyTries = 0;

        if (withBest.length) {
          // Phase 5 residual: only if still low after multi-still fuse
          const needsEnsemble = withBest.some((d) => shouldRequestEnsemble(d, ensembleCfg));
          if (needsEnsemble && analyzeList.length < 2) {
            lastPipelineForEnsemble = pipelineResult;
            const st = ensembleBuf.addFrame(withBest);
            setEnsembleActive(true);
            const hint = `다른 각도·거리에서 한 번 더 비춰 주세요 (${Math.min(st.frameCount, st.need)}/${st.need})`;
            const shown = throttleMsg(hint);
            if (shown) setQualityHint(shown);
            if (!st.ready) {
              stillPhaseDone = false;
              smartStill.reset();
              timerId = setTimeout(tick, 320);
              return;
            }
            const fused = fuseEnsembleVotes(ensembleBuf.getFrames());
            const merged = buildEnsemblePipelineResult(lastPipelineForEnsemble, fused);
            ensembleBuf.reset();
            setEnsembleActive(false);
            const ok = await finalizePipelineResults(merged);
            if (!ok && !stopped && !cancelledRef.current) {
              processingRef.current = false;
              stillPhaseDone = false;
              smartStill.reset();
              timerId = setTimeout(tick, 260);
            }
            return;
          }

          setEnsembleActive(false);
          const ok = await finalizePipelineResults(pipelineResult);
          if (!ok && !stopped && !cancelledRef.current) {
            processingRef.current = false;
            stillPhaseDone = false;
            smartStill.reset();
            timerId = setTimeout(tick, 260);
          }
          return;
        }

        if (withMark.length) {
          await lookupMarks(withMark.map((d) => ({ mark: d.mark, color: d.color || "" })));
          return;
        }

        timerId = setTimeout(tick, 260);
      } catch (err) {
        console.warn("pipeline tick error", err);
        if (!stopped && !cancelledRef.current && !processingRef.current) {
          timerId = setTimeout(tick, 280);
        }
      }
    };

    timerId = setTimeout(tick, 280);

    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [cameraError, resumeKey, debugMode, dualMode, frontCrop]);

  const statusText = {
    scanning: "알약을 인식하고 있어요",
    loading: "약 정보를 불러오고 있어요",
    found: "알약을 인식했어요",
    results: `${foundPills.length}개 알약을 찾았어요`,
    error: errorMsg,
  }[status];

  if (status === "results") {
    return (
      <div className="flex flex-col h-full pb-28" style={{ backgroundColor: BG }}>
        <div className="px-4 pt-5 pb-3 flex items-center gap-3 bg-white">
          <button onClick={() => setScreen("home")} className="w-[40px] h-[40px] flex items-center justify-center">
            <ChevronLeft size={28} color={BLACK} />
          </button>
          <p className="text-[18px] font-extrabold" style={{ color: BLACK }}>인식된 알약</p>
        </div>

        <div className="px-4 pt-3">
          <p className="text-[14px] font-bold mb-3" style={{ color: GRAY2 }}>
            {foundPills.length}개를 찾았습니다. 확인할 약을 선택하세요.
          </p>
          {accuracyWarning ? (
            <p className="text-[13px] font-bold mb-3 px-3 py-2 rounded-xl" style={{ color: "#92400E", backgroundColor: "#FEF3C7" }}>
              {accuracyWarning}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "560px" }}>
            {foundPills.map((p) => (
              <Card key={p.id} className="w-full px-3 py-3 text-left">
                <button type="button" className="w-full flex items-center gap-3" onClick={() => openPill(p)}>
                  <div className="w-[56px] h-[56px] rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F9FAFB" }}>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[12px] font-bold" style={{ color: GRAY }}>약</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[15px] font-bold leading-tight" style={{ color: BLACK }}>{p.name}</p>
                    <p className="text-[12px] mt-0.5 truncate" style={{ color: GRAY }}>
                      {[p.detectedMark && `표기 ${p.detectedMark}`, p.tag].filter(Boolean).join(" · ")}
                    </p>
                    {matchSourceLabel(p.matchSource) ? (
                      <p
                        className="text-[11px] font-bold mt-1 inline-block px-2 py-0.5 rounded-md"
                        style={{
                          color: p.matchSource === "prescription" ? GREEN : GRAY2,
                          backgroundColor: p.matchSource === "prescription" ? GREEN_BG : "#F3F4F6",
                        }}
                      >
                        {matchSourceLabel(p.matchSource)}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight size={18} color={GRAY} />
                </button>
              </Card>
            ))}
          </div>
          <button
            onClick={resumeScanning}
            className="w-full min-h-[48px] rounded-full font-bold text-[16px] mt-4"
            style={{ backgroundColor: RED, color: "#fff" }}
          >
            다시 인식하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full pb-24" style={{ backgroundColor: "#000" }}>
      <div className="px-4 pt-5 pb-3 flex items-center gap-3">
        <button onClick={() => setScreen("home")} className="w-[40px] h-[40px] flex items-center justify-center">
          <ChevronLeft size={28} color="#fff" />
        </button>
        <p className="text-[18px] font-bold text-white flex-1">알약 촬영</p>
        <button
          onClick={() => {
            setDualMode((v) => !v);
            setFrontCrop(null);
            setCaptureSide("front");
          }}
          className="min-h-[32px] px-3 rounded-full text-[12px] font-bold mr-2"
          style={{
            backgroundColor: dualMode ? "#60A5FA" : "rgba(255,255,255,0.2)",
            color: dualMode ? "#0C4A6E" : "#fff",
          }}
        >
          {dualMode ? (captureSide === "back" ? "뒷면" : "앞면+") : "단면"}
        </button>
        <button
          onClick={() => setDebugMode((v) => !v)}
          className="min-h-[32px] px-3 rounded-full text-[12px] font-bold"
          style={{
            backgroundColor: debugMode ? "#34D399" : "rgba(255,255,255,0.2)",
            color: debugMode ? "#064E3B" : "#fff",
          }}
        >
          Debug
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8" style={{ backgroundColor: BG }}>
            <p className="text-[15px] text-center leading-relaxed" style={{ color: BLACK }}>{cameraError}</p>
            <button
              onClick={openCamera}
              className="min-h-[44px] px-5 rounded-full font-bold text-[15px]"
              style={{ backgroundColor: RED, color: "#fff" }}
            >
              다시 시도
            </button>
          </div>
        ) : (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px]">
            {/* 어두운 비네팅 (카메라 로직 미변경, 시각 레이어만) */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)" }}
            />
            {/* 품질 상태 힌트용 얇은 테두리 (기존 quality/loading 피드백 유지) */}
            <div
              className="absolute inset-0 rounded-3xl pointer-events-none"
              style={{
                border: `2px solid ${
                  status === "loading"
                    ? "rgba(52, 211, 153, 0.55)"
                    : ensembleActive
                      ? "rgba(99, 102, 241, 0.55)"
                      : qualityOk
                        ? "rgba(52, 211, 153, 0.45)"
                        : "rgba(251, 191, 36, 0.55)"
                }`,
              }}
            />
            {/* 흰색 L자 모서리 브래킷 4개 */}
            <div className="absolute top-0 left-0 w-11 h-11 border-t-[4px] border-l-[4px] border-white rounded-tl-xl pointer-events-none" />
            <div className="absolute top-0 right-0 w-11 h-11 border-t-[4px] border-r-[4px] border-white rounded-tr-xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-11 h-11 border-b-[4px] border-l-[4px] border-white rounded-bl-xl pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-11 h-11 border-b-[4px] border-r-[4px] border-white rounded-br-xl pointer-events-none" />
            {/* 중앙 스캔 라인 (정적 배치 — 애니메이션은 별도 확인) */}
            <div
              className="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-[3px] rounded-full pointer-events-none"
              style={{
                background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 100%)",
                boxShadow: "0 0 10px rgba(255,255,255,0.85)",
              }}
            />
            {pillBoxes.map((box, i) => (
              <div
                key={i}
                className="absolute rounded-lg"
                style={{
                  left: `${box.left}%`,
                  top: `${box.top}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  border: "2px solid #34D399",
                  backgroundColor: "rgba(52, 211, 153, 0.15)",
                }}
              >
                {debugMode && (
                  <span
                    className="absolute -top-5 left-0 text-[10px] font-bold px-1 rounded"
                    style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "#34D399", whiteSpace: "nowrap" }}
                  >
                    {(box.confidence * 100).toFixed(0)}% {box.shape || ""} {box.mark || ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {debugMode && (pillBoxes.some((b) => b.cropUrl) || metricsSnap) && (
          <div
            className="absolute left-2 right-2 bottom-2 rounded-xl p-2 overflow-x-auto"
            style={{ backgroundColor: "rgba(0,0,0,0.72)", maxHeight: "120px" }}
          >
            {metricsSnap && (
              <p className="text-[10px] text-white/80 mb-1">
                {Object.entries(metricsSnap)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")}
              </p>
            )}
            <div className="flex gap-2">
              {pillBoxes.filter((b) => b.cropUrl).map((b, i) => (
                <div key={i} className="flex-shrink-0 text-center">
                  <img src={b.cropUrl} alt={`crop-${i}`} className="w-14 h-14 object-cover rounded border border-emerald-400" />
                  {b.maskUrl && (
                    <img src={b.maskUrl} alt={`mask-${i}`} className="w-14 h-8 object-cover rounded mt-1 opacity-80" />
                  )}
                  <p className="text-[9px] text-emerald-300 mt-0.5">{(b.confidence * 100).toFixed(0)}%</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-5 py-4 pb-6" style={{ backgroundColor: CARD }}>
        {status !== "error" ? (
          <div className="text-center">
            <p className="text-[15px] font-bold" style={{ color: BLACK }}>{statusText}</p>
            {detectedMarks.length > 0 && (status === "scanning" || status === "loading") && (
              <p className="text-[12px] mt-1" style={{ color: GRAY }}>
                읽은 표기: {detectedMarks.join(", ")}
              </p>
            )}
            {status === "scanning" && hasPrescriptionContext() && (
              <p className="text-[12px] mt-1 font-bold" style={{ color: GREEN }}>
                처방 목록 {getPrescriptionDrugNames().length}종 우선 매칭 중
              </p>
            )}
            {status === "scanning" && qualityHint && (
              <p
                className="text-[13px] mt-2 font-bold leading-relaxed px-3 py-1.5 rounded-lg inline-block"
                style={{
                  color: qualityOk ? "#065F46" : "#92400E",
                  backgroundColor: qualityOk ? "#D1FAE5" : "#FEF3C7",
                }}
              >
                {qualityHint}
              </p>
            )}
            {status === "scanning" && (
              <p className="text-[12px] mt-2 leading-relaxed" style={{ color: GRAY2 }}>
                {dualMode
                  ? captureSide === "back"
                    ? "앞면을 저장했습니다. 이제 뒷면 각인을 맞춰 주세요"
                    : "앞면+뒷면 모드: 먼저 앞면 각인을 맞춰 주세요"
                  : "흰 배경에 알약을 펼치면, 좋은 순간을 자동으로 담아 인식합니다 (셔터 없음)"}
              </p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-[14px] text-center mb-3" style={{ color: RED }}>{errorMsg}</p>
            <Card className="w-full flex items-center px-3 py-2 gap-2 mb-2">
              <input
                value={manualMark}
                onChange={(e) => setManualMark(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runManualSearch();
                }}
                placeholder="표기 입력 (여러 개는 쉼표로)"
                className="flex-1 text-[15px] outline-none bg-transparent"
                style={{ color: BLACK }}
              />
            </Card>
            <button
              onClick={runManualSearch}
              className="w-full min-h-[48px] rounded-full font-bold text-[16px] mb-2"
              style={{ backgroundColor: RED, color: "#fff" }}
            >
              입력으로 검색
            </button>
            <button
              onClick={resumeScanning}
              className="w-full min-h-[44px] rounded-full font-bold text-[15px]"
              style={{ backgroundColor: BLACK, color: "#fff" }}
            >
              다시 인식하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackPanel({ pill, onDone }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manualName, setManualName] = useState("");
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [consent, setConsent] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [error, setError] = useState("");

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError("");
    try {
      const list = await searchPillList(q);
      setHits(list.slice(0, 8));
      if (!list.length) setError("검색 결과가 없습니다. 아래 직접 입력을 이용해 주세요.");
    } catch {
      setError("검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const submit = (correct, source) => {
    try {
      // PRIVACY: never attach image unless consent; we do not capture frame here by default
      addFeedback({
        predicted: {
          name: pill?.name || "",
          itemSeq: pill?.itemSeq || pill?.id || "",
          matchSource: pill?.matchSource || null,
          confidence: pill?.rerankScore || pill?.fusedScore || 0,
          mark: pill?.detectedMark || pill?.mark || "",
        },
        correct: {
          name: correct.name,
          itemSeq: correct.itemSeq || "",
          source,
        },
        consentImageStore: consent && isFeedbackImageAllowed(),
        imageDataUrl: null,
        features: {
          imprint: pill?.detectedMark || "",
          color: pill?.color || "",
          shape: pill?.shape || "",
        },
        context: {
          prescriptionPoolSize: getPrescriptionDrugNames().length,
          pipeline: "imprint-db",
        },
      });
      setSavedMsg("피드백 감사합니다. 인식 개선에 반영할게요.");
      setOpen(false);
      onDone?.();
    } catch (e) {
      setError(e?.message || "저장에 실패했습니다.");
    }
  };

  if (savedMsg) {
    return (
      <p className="text-[13px] font-bold text-center px-3 py-2 rounded-xl" style={{ color: GREEN, backgroundColor: GREEN_BG }}>
        {savedMsg}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full min-h-[44px] rounded-full font-bold text-[15px]"
        style={{ backgroundColor: "#F3F4F6", color: GRAY2 }}
      >
        이거 아니에요
      </button>
    );
  }

  return (
    <Card className="p-4">
      <p className="text-[15px] font-extrabold mb-2" style={{ color: BLACK }}>정답 약 알려주기</p>
      <p className="text-[12px] mb-3 leading-relaxed" style={{ color: GRAY2 }}>
        인식 결과를 바로잡으면 다음에 더 잘 맞추는 데 도움이 됩니다.
      </p>

      <div className="flex gap-2 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="약 이름 검색"
          className="flex-1 min-h-[44px] px-3 rounded-xl text-[14px] outline-none"
          style={{ backgroundColor: "#F9FAFB", border: `1px solid ${BORDER}`, color: BLACK }}
        />
        <button
          type="button"
          onClick={runSearch}
          className="px-4 rounded-xl font-bold text-[14px]"
          style={{ backgroundColor: RED, color: "#fff" }}
        >
          {searching ? "…" : "검색"}
        </button>
      </div>

      {error && <p className="text-[12px] mb-2" style={{ color: RED }}>{error}</p>}

      <div className="flex flex-col gap-1 mb-3 max-h-[160px] overflow-y-auto">
        {hits.map((h) => (
          <button
            key={h.itemSeq || h.id || h.name}
            type="button"
            onClick={() => submit({ name: h.name, itemSeq: h.itemSeq }, "search")}
            className="text-left px-3 py-2 rounded-xl text-[13px] font-bold"
            style={{ backgroundColor: "#F9FAFB", color: BLACK }}
          >
            {h.name}
          </button>
        ))}
      </div>

      <input
        value={manualName}
        onChange={(e) => setManualName(e.target.value)}
        placeholder="또는 약 이름 직접 입력"
        className="w-full min-h-[44px] px-3 rounded-xl text-[14px] outline-none mb-2"
        style={{ backgroundColor: "#F9FAFB", border: `1px solid ${BORDER}`, color: BLACK }}
      />
      <button
        type="button"
        onClick={() => submit({ name: manualName.trim() }, "manual")}
        disabled={!manualName.trim()}
        className="w-full min-h-[44px] rounded-full font-bold text-[14px] mb-3 disabled:opacity-40"
        style={{ backgroundColor: BLACK, color: "#fff" }}
      >
        직접 입력으로 제출
      </button>

      {isFeedbackImageAllowed() && (
        <label className="flex items-start gap-2 text-[11px] leading-relaxed" style={{ color: GRAY2 }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            개선을 위해 축소 이미지 저장에 동의합니다 (선택). 동의 없이 원본 사진을 서버에 저장하지 않습니다.
          </span>
        </label>
      )}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="w-full mt-3 text-[12px] font-bold underline"
        style={{ color: GRAY }}
      >
        취소
      </button>
    </Card>
  );
}

function FeedbackStatsScreen({ setScreen }) {
  const [stats, setStats] = useState(() => getFeedbackStats());

  const refresh = () => setStats(getFeedbackStats());

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24" style={{ backgroundColor: BG }}>
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 bg-white">
        <button onClick={() => setScreen("home")} className="w-[40px] h-[40px] flex items-center justify-center">
          <ChevronLeft size={28} color={BLACK} />
        </button>
        <p className="text-[18px] font-extrabold" style={{ color: BLACK }}>피드백 통계</p>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-3">
        <Card className="p-4">
          <p className="text-[14px] font-bold" style={{ color: GRAY2 }}>총 피드백</p>
          <p className="text-[28px] font-extrabold" style={{ color: BLACK }}>{stats.total}</p>
          <p className="text-[11px] mt-1" style={{ color: GRAY }}>
            로컬 저장만 사용 · 서버 업로드 없음
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-[15px] font-extrabold mb-2" style={{ color: BLACK }}>가장 많이 틀린 예측 Top 10</p>
          {stats.topWrongPredictions.length === 0 ? (
            <p className="text-[13px]" style={{ color: GRAY }}>아직 데이터가 없습니다.</p>
          ) : (
            stats.topWrongPredictions.map((row, i) => (
              <div key={row.name} className="flex justify-between py-1.5 text-[13px]" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <span style={{ color: BLACK }}>{i + 1}. {row.name}</span>
                <span style={{ color: GRAY2 }}>{row.count}회</span>
              </div>
            ))
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[15px] font-extrabold mb-2" style={{ color: BLACK }}>최근 피드백</p>
          {stats.recent.map((r) => (
            <div key={r.id} className="py-2 text-[12px]" style={{ borderBottom: `1px solid ${BORDER}`, color: GRAY2 }}>
              <span style={{ color: RED }}>{r.predicted || "?"}</span>
              {" → "}
              <span style={{ color: GREEN }}>{r.correct}</span>
            </div>
          ))}
        </Card>

        <button
          type="button"
          onClick={refresh}
          className="w-full min-h-[44px] rounded-full font-bold text-[14px]"
          style={{ backgroundColor: "#F3F4F6", color: BLACK }}
        >
          새로고침
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined" && window.confirm("모든 로컬 피드백을 삭제할까요?")) {
              clearFeedback();
              refresh();
            }
          }}
          className="w-full text-[12px] font-bold underline"
          style={{ color: GRAY }}
        >
          피드백 데이터 지우기 ({getFeedbackCount()}건)
        </button>
      </div>
    </div>
  );
}

function DetailScreen({ setScreen, pill, addToSchedule, detailSource }) {
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    if (!pill || detailSource !== "scan") return;
    const intro = `${pill.name}. ${pill.tag}. ${pill.timing}`;
    const t = setTimeout(() => speak(intro), 400);
    return () => clearTimeout(t);
  }, [pill?.id, pill?.name, detailSource]);

  if (!pill) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28" style={{ backgroundColor: "#FFFFFF" }}>
      {/* 상단: 뒤로가기만 (제목 없음). 기존 TTS 버튼 로직 유지 */}
      <div className="px-4 pt-5 pb-2 flex items-center gap-3 bg-white">
        <button onClick={() => setScreen(detailSource === "search" ? "search" : "home")} className="w-[40px] h-[40px] flex items-center justify-center">
          <ChevronLeft size={28} color={BLACK} />
        </button>
        {detailSource === "scan" && (
          <button onClick={() => speak(`${pill.name}. ${pill.tag}. ${pill.timing}`)} className="ml-auto w-[40px] h-[40px] flex items-center justify-center">
            <Volume2 size={22} color={GRAY2} />
          </button>
        )}
      </div>

      {/* 중앙 약 이미지 */}
      <div className="bg-white px-5 pt-2 pb-6 flex flex-col items-center">
        <div className="w-full h-[200px] flex items-center justify-center">
          {pill.imageUrl ? (
            <img src={pill.imageUrl} alt={pill.name} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[16px] font-bold" style={{ color: GRAY }}>이미지 없음</span>
          )}
        </div>
      </div>

      {/* 회색 카드: 약 이름 + 세부사항 + 기존 상세 섹션 유지 */}
      <div
        className="flex-1 px-5 pt-5 pb-4 rounded-t-[28px]"
        style={{ backgroundColor: DETAIL_CARD_BG }}
      >
        <p className="text-[24px] font-extrabold leading-tight" style={{ color: BLACK }}>{pill.name}</p>
        {pill.entpName && <p className="text-[13px] mt-1" style={{ color: GRAY }}>{pill.entpName}</p>}
        {matchSourceLabel(pill.matchSource) && (
          <p className="text-[11px] font-bold mt-2 inline-block px-2 py-0.5 rounded-md" style={{ color: GREEN, backgroundColor: GREEN_BG }}>
            {matchSourceLabel(pill.matchSource)}
          </p>
        )}

        <p className="text-[15px] font-bold mt-5 mb-3" style={{ color: GRAY2 }}>세부사항</p>

        <Section title="1. 기본 정보">
          <p className="text-[13px] leading-relaxed" style={{ color: GRAY2 }}>
            <b>분류:</b> {pill.tag}
          </p>
        </Section>

        <Section title="2. 복용 방법">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: GRAY2 }}>{pill.timing || "정보 없음"}</p>
        </Section>

        <Section title="3. 효과 및 효능">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: GRAY2 }}>{pill.effect || "정보 없음"}</p>
        </Section>

        <Section title="4. 주의사항">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: GRAY2 }}>{pill.caution || "정보 없음"}</p>
        </Section>

        {pill.durWarning && (
          <Section title="5. 병용 금기">
            <p className="text-[13px] leading-relaxed" style={{ color: RED }}>{pill.durWarning}</p>
          </Section>
        )}

        <div className="pt-2 pb-2">
          <FeedbackPanel pill={pill} />
        </div>

        <button
          onClick={() => { addToSchedule(pill); setRegistered(true); if (detailSource === "scan") speak("복용 관리에 등록되었습니다"); }}
          className="w-full min-h-[52px] rounded-2xl font-bold text-[17px] mt-2"
          style={{ backgroundColor: registered ? GREEN : DETAIL_CTA_BG, color: "#fff" }}
        >
          {registered ? "복용 관리에 등록됨 ✓" : "복용 관리 등록하기"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <p className="text-[14px] font-bold mb-1" style={{ color: BLACK }}>{title}</p>
      {children}
    </div>
  );
}


function ManagementScreen({ setScreen, schedule, addToSchedule, onCameraModeChange }) {
  const [takenIds, setTakenIds] = useState([]);
  const [view, setView] = useState("list"); // list | camera
  const [status, setStatus] = useState("ready"); // scanning | reading | looking | done | error
  const [msg, setMsg] = useState("");
  const [foundNames, setFoundNames] = useState([]);
  const [cameraError, setCameraError] = useState("");
  const [snapUrl, setSnapUrl] = useState("");
  const [qualityHint, setQualityHint] = useState("");
  const [qualityOk, setQualityOk] = useState(true);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const bagBusyRef = useRef(false);
  const bagCancelRef = useRef(false);

  const toggleTaken = (id) => setTakenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const stopCamera = () => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const openCamera = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("카메라를 지원하지 않는 브라우저입니다.");
      return false;
    }
    if (!window.isSecureContext) {
      setCameraError("HTTPS 또는 localhost에서만 카메라를 사용할 수 있습니다.");
      return false;
    }
    setCameraError("");
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {}
      }
      return true;
    } catch {
      setCameraError("카메라 권한을 허용해주세요.");
      return false;
    }
  };

  const captureBagFrame = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return null;
    const canvas = document.createElement("canvas");
    // Prefer upright document-ish crop: full frame scaled
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  };

  const startCameraView = async () => {
    setView("camera");
    onCameraModeChange?.(true);
    setStatus("scanning");
    setMsg("");
    setFoundNames([]);
    setQualityHint("처방전/약봉지를 안내선 안에 맞춰 주세요");
    setQualityOk(true);
    bagCancelRef.current = false;
    bagBusyRef.current = false;
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      setSnapUrl("");
    }
    await openCamera();
  };

  const backToList = () => {
    bagCancelRef.current = true;
    stopCamera();
    setView("list");
    onCameraModeChange?.(false);
    setStatus("ready");
    setMsg("");
    setFoundNames([]);
    setCameraError("");
    setQualityHint("");
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      setSnapUrl("");
    }
  };

  useEffect(() => {
    return () => {
      bagCancelRef.current = true;
      stopCamera();
      onCameraModeChange?.(false);
    };
  }, []);

  const processCapturedCanvas = async (canvas) => {
    setStatus("reading");
    setMsg("문서 보정 → OCR → 구조화 추출 중...");
    try {
      const docResult = await recognizeDocumentPipeline(canvas, {
        searchFn: async (name) => {
          const list = await searchPillList(name);
          return list.map((it) => ({
            ...it,
            ITEM_NAME: it.name,
            ITEM_SEQ: it.itemSeq,
          }));
        },
        debug: false,
      });

      // Persist bag context for pill Vision Search cross-check
      setSessionBagContext(docResult);

      const candidates = docResult.drugNames || docResult.rawCandidates || [];
      const items = docResult.items || [];
      const doseText = (docResult.doses || []).map((d) => d.raw || `${d.value}${d.unit}`).join(", ");
      const freqText = (docResult.frequencies || []).map((f) => f.raw || `1일 ${f.perDay}회`).join(", ");
      const timeText = (docResult.times || []).join(", ");

      if (!candidates.length && !items.length) {
        setStatus("error");
        setMsg("약 이름을 읽지 못했습니다. 밝은 곳에서 다시 촬영해주세요.");
        return;
      }

      const summaryBits = [
        candidates.length ? `약 ${candidates.length}개` : null,
        doseText ? `용량 ${doseText}` : null,
        freqText ? `횟수 ${freqText}` : null,
        timeText ? `시간 ${timeText}` : null,
      ].filter(Boolean);

      setFoundNames(candidates.length ? candidates : items.map((it) => it._matchedName || it.name || it.ITEM_NAME));
      setStatus("looking");
      setMsg(`${summaryBits.join(" · ")} 확인. 정보를 조회해요...`);

      let added = 0;
      const failed = [];
      const seen = new Set();

      const enqueue = async (itemOrName) => {
        const isObj = typeof itemOrName === "object" && itemOrName;
        const name = isObj
          ? itemOrName._matchedName || itemOrName.name || itemOrName.ITEM_NAME
          : itemOrName;
        const seq = isObj ? itemOrName.itemSeq || itemOrName.ITEM_SEQ : null;
        const key = seq || name;
        if (!key || seen.has(key)) return;
        seen.add(key);
        try {
          let detail;
          if (seq) {
            detail = await fetchPillDetailBySeq(seq, name, schedule).catch(() => null);
          }
          if (!detail) {
            const list = await searchPillList(name);
            const top = list[0];
            if (!top) {
              failed.push(name);
              return;
            }
            detail = await fetchPillDetailBySeq(top.itemSeq, top.name, schedule).catch(() => ({
              id: top.itemSeq,
              itemSeq: top.itemSeq,
              name: top.name,
              tag: top.tag || "의약품",
              time: timeText || "처방 정보 확인",
              timing: top.timing || freqText || "복용법 정보 없음",
              effect: top.effect || top.tag || "정보 없음",
              caution: top.caution || "주의사항 정보 없음",
              durWarning: null,
              imageUrl: top.imageUrl || "",
              entpName: top.entpName || "",
            }));
          }
          // Attach structured bag fields onto schedule entry
          detail = {
            ...detail,
            time: detail.time || timeText || "처방 정보 확인",
            timing: [detail.timing, freqText, doseText].filter(Boolean).join(" · ") || detail.timing,
            bagMeta: {
              doses: docResult.doses || [],
              frequencies: docResult.frequencies || [],
              times: docResult.times || [],
            },
          };
          addToSchedule(detail);
          added += 1;
        } catch {
          failed.push(name);
        }
      };

      if (items.length) {
        for (const it of items.slice(0, 8)) await enqueue(it);
      } else {
        for (const name of candidates.slice(0, 8)) await enqueue(name);
      }

      if (added === 0) {
        setStatus("error");
        setMsg("약은 읽었지만 정보를 찾지 못했습니다. 다시 촬영하거나 약 찾기를 이용해주세요.");
        return;
      }

      setStatus("done");
      setMsg(
        failed.length
          ? `${added}개 약을 복용 관리에 추가했습니다. (일부 실패: ${failed.join(", ")})`
          : `${added}개 약을 복용 관리에 추가했습니다.${timeText ? ` · ${timeText}` : ""}`
      );
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMsg("이미지 인식에 실패했습니다. 다시 촬영해주세요.");
    }
  };

  // Phase 2: live QR-style bag/prescription recognition (no shutter)
  useEffect(() => {
    if (view !== "camera" || cameraError) return;
    if (status !== "scanning") return;

    bagCancelRef.current = false;
    let timerId = null;
    let lastKey = "";
    let confirmCount = 0;
    const throttleMsg = createMessageThrottle(450);
    const smartStill = new SmartStillCapture({
      ...getSmartStillConfig(),
      minScore: Math.min(0.38, getSmartStillConfig().minScore),
      timeoutMs: 3500,
    });
    let stillReady = false;

    const tick = async () => {
      if (bagCancelRef.current || bagBusyRef.current) return;
      if (!videoRef.current?.videoWidth) {
        timerId = setTimeout(tick, 200);
        return;
      }

      const frame = captureBagFrame();
      if (!frame) {
        timerId = setTimeout(tick, 200);
        return;
      }

      const quality = evaluateCaptureQuality(frame, { mode: "document" });
      setQualityOk(quality.ok);
      if (!quality.ok) {
        const textMsg = quality.messages[0] || "초점을 맞춰 주세요";
        const shown = throttleMsg(textMsg);
        if (shown) setQualityHint(shown);
        smartStill.observe(frame, quality);
        timerId = setTimeout(tick, 280);
        return;
      }

      const st = smartStill.observe(frame, quality);
      if (st.captured) {
        const shown = throttleMsg(`선명 컷 포착 (${st.stillCount}/${st.need})`);
        if (shown) setQualityHint(shown);
      } else if (!st.ready) {
        const shown = throttleMsg(`문서가 안정되면 자동으로 담아요 (${st.stillCount}/${st.need})`);
        if (shown) setQualityHint(shown);
      }

      if (!stillReady && !st.ready) {
        timerId = setTimeout(tick, 200);
        return;
      }
      if (!stillReady && st.ready && st.empty) {
        smartStill.stills.push({ canvas: frame, score: quality.score, ts: Date.now(), method: "fallback-live" });
      }
      stillReady = true;

      const best = smartStill.pickBest() || { canvas: frame };
      const okHint = throttleMsg("선명 컷으로 글자 읽는 중…");
      if (okHint) setQualityHint(okHint);

      bagBusyRef.current = true;
      try {
        const docResult = await recognizeDocumentPipeline(best.canvas, {
          searchFn: async (name) => {
            const list = await searchPillList(name);
            return list.map((it) => ({
              ...it,
              ITEM_NAME: it.name,
              ITEM_SEQ: it.itemSeq,
            }));
          },
          debug: false,
        });
        if (bagCancelRef.current) return;

        const names = (docResult.drugNames || []).filter(Boolean);
        const items = docResult.items || [];
        if (!names.length && !items.length) {
          stillReady = false;
          smartStill.reset();
          timerId = setTimeout(tick, 700);
          return;
        }

        const key = (names.length ? names : items.map((it) => it._matchedName || it.name || it.ITEM_NAME))
          .slice(0, 6)
          .join("|");
        if (key && key === lastKey) confirmCount += 1;
        else {
          lastKey = key;
          confirmCount = 1;
        }
        setFoundNames(names.length ? names : items.map((it) => it._matchedName || it.name || it.ITEM_NAME));

        if (confirmCount >= 2) {
          bagCancelRef.current = true;
          best.canvas.toBlob((blob) => {
            if (!blob) return;
            setSnapUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return URL.createObjectURL(blob);
            });
          }, "image/jpeg", 0.85);
          stopCamera();
          await processCapturedCanvas(best.canvas);
          return;
        }

        const wait = throttleMsg(`약 이름 확인 중… (${confirmCount}/2)`);
        if (wait) setQualityHint(wait);
        // Re-collect stills for second confirm on a fresh good moment
        stillReady = false;
        smartStill.reset();
      } catch (e) {
        console.warn("[bag-live]", e);
      } finally {
        bagBusyRef.current = false;
      }
      if (!bagCancelRef.current) timerId = setTimeout(tick, 500);
    };

    timerId = setTimeout(tick, 400);
    return () => {
      bagCancelRef.current = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [view, cameraError, status]);

  const retake = async () => {
    bagCancelRef.current = false;
    bagBusyRef.current = false;
    setStatus("scanning");
    setMsg("");
    setFoundNames([]);
    setQualityHint("처방전/약봉지를 안내선 안에 맞춰 주세요");
    setQualityOk(true);
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      setSnapUrl("");
    }
    await openCamera();
  };

  // ---- 카메라: 실시간 인식 (QR 스타일, 셔터 없음) ----
  if (view === "camera") {
    const busy = status === "reading" || status === "looking";
    const live = status === "scanning";
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: "#000" }}>
        <div className="px-4 pt-5 pb-3 flex items-center gap-3">
          <button onClick={backToList} className="w-[40px] h-[40px] flex items-center justify-center">
            <ChevronLeft size={28} color="#fff" />
          </button>
          <p className="text-[18px] font-bold text-white">처방전 / 약봉지 인식</p>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {snapUrl && status !== "scanning" ? (
            <img src={snapUrl} alt="인식 사진" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          )}

          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8" style={{ backgroundColor: BG }}>
              <p className="text-[15px] text-center leading-relaxed" style={{ color: BLACK }}>{cameraError}</p>
              <button
                onClick={openCamera}
                className="min-h-[44px] px-5 rounded-full font-bold text-[15px]"
                style={{ backgroundColor: RED, color: "#fff" }}
              >
                다시 시도
              </button>
            </div>
          ) : live || busy ? (
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[360px] rounded-2xl"
              style={{
                border: `3px solid ${
                  busy ? "#34D399" : qualityOk ? "rgba(52, 211, 153, 0.95)" : "rgba(251, 191, 36, 0.95)"
                }`,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
              }}
            />
          ) : null}
        </div>

        <div className="px-5 py-4" style={{ backgroundColor: CARD }}>
          {live && (
            <>
              <p className="text-[14px] text-center font-bold mb-2" style={{ color: BLACK }}>
                QR처럼 비추기만 하면 자동으로 읽습니다
              </p>
              {qualityHint && (
                <p
                  className="text-[13px] text-center font-bold mb-2 px-3 py-2 rounded-xl"
                  style={{
                    color: qualityOk ? "#065F46" : "#92400E",
                    backgroundColor: qualityOk ? "#D1FAE5" : "#FEF3C7",
                  }}
                >
                  {qualityHint}
                </p>
              )}
              {foundNames.length > 0 && (
                <p className="text-[12px] text-center" style={{ color: GRAY }}>
                  읽는 중: {foundNames.slice(0, 4).join(", ")}
                </p>
              )}
            </>
          )}

          {busy && (
            <p className="text-[15px] text-center font-bold" style={{ color: BLACK }}>
              {msg || "처리 중..."}
            </p>
          )}

          {(status === "done" || status === "error") && (
            <div>
              <p
                className="text-[14px] text-center font-bold mb-2 leading-relaxed"
                style={{ color: status === "error" ? RED : GREEN }}
              >
                {msg}
              </p>
              {foundNames.length > 0 && (
                <p className="text-[12px] text-center mb-3" style={{ color: GRAY }}>
                  인식된 이름: {foundNames.join(", ")}
                </p>
              )}
              <button
                onClick={retake}
                className="w-full min-h-[48px] rounded-full font-bold text-[16px] mb-2"
                style={{ backgroundColor: RED, color: "#fff" }}
              >
                다시 인식하기
              </button>
              <button
                onClick={backToList}
                className="w-full min-h-[44px] rounded-full font-bold text-[15px]"
                style={{ backgroundColor: BLACK, color: "#fff" }}
              >
                복용 관리로 돌아가기
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- 목록 화면 ----
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28" style={{ backgroundColor: "#F5F5F7" }}>
      <div className="px-5 pt-6 pb-3 bg-white">
        <p className="text-[22px] font-extrabold text-center" style={{ color: BLACK }}>복용 관리</p>
      </div>

      {/* 기존 처방전/약봉지 등록 로직·UI 유지 */}
      <div className="px-4 pt-4">
        <Card className="p-4">
          <p className="text-[16px] font-extrabold" style={{ color: BLACK }}>처방전 · 약봉지 등록</p>
          <p className="text-[13px] mt-1 leading-relaxed" style={{ color: GRAY2 }}>
            카메라를 비추면 약 이름을 실시간으로 읽어 복용 관리에 추가합니다.
            등록된 처방 목록은 알약 인식 시 우선 매칭에 사용됩니다.
          </p>
          <button
            onClick={startCameraView}
            className="w-full min-h-[48px] rounded-full font-bold text-[16px] mt-3 flex items-center justify-center gap-2"
            style={{ backgroundColor: RED, color: "#fff" }}
          >
            <Camera size={18} />
            처방전 / 약봉지 실시간 인식
          </button>
          {hasPrescriptionContext() && (
            <div className="mt-3">
              <p className="text-[12px] font-bold" style={{ color: GREEN }}>
                처방 목록 {getPrescriptionDrugNames().length}종 저장됨
              </p>
              <p className="text-[11px] mt-0.5 truncate" style={{ color: GRAY2 }}>
                {getPrescriptionDrugNames().slice(0, 4).join(", ")}
                {getPrescriptionDrugNames().length > 4 ? " …" : ""}
              </p>
              <button
                type="button"
                onClick={() => {
                  clearPrescriptionContext();
                  setFoundNames([]);
                  setMsg("처방 목록을 지웠습니다.");
                }}
                className="mt-2 text-[12px] font-bold underline"
                style={{ color: GRAY2 }}
              >
                처방 목록 지우기
              </button>
            </div>
          )}
        </Card>
      </div>

      {schedule.length === 0 ? (
        <div className="px-4 pt-8 flex flex-col items-center gap-3">
          <p className="text-[15px] text-center" style={{ color: GRAY }}>
            등록된 약이 없습니다.
            <br />
            위 버튼으로 처방전/약봉지를 촬영해보세요.
          </p>
        </div>
      ) : (
        <div className="px-4 pt-4 flex flex-col gap-3">
          <p className="text-[14px] font-bold" style={{ color: GRAY2 }}>
            등록된 약 {schedule.length}개
          </p>
          {schedule.map((p) => {
            const taken = takenIds.includes(p.id);
            return (
              <div
                key={p.id}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border"
                style={{ borderColor: BORDER, opacity: taken ? 0.7 : 1 }}
              >
                <div className="w-[60px] h-[60px] rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F3F4F6" }}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[12px] font-bold" style={{ color: GRAY }}>약</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-extrabold leading-tight truncate" style={{ color: BLACK }}>{p.name}</p>
                  <p className="text-[13px] mt-1 truncate" style={{ color: GRAY2 }}>
                    {(p.timing || "복용법 정보 없음").slice(0, 28)}
                  </p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: GRAY }}>{p.tag}</p>
                </div>
                {/* 기존 takenIds/toggleTaken 상태 로직 유지 — 표시만 스펙형 상태 텍스트 */}
                <button
                  type="button"
                  onClick={() => toggleTaken(p.id)}
                  className="flex-shrink-0 max-w-[96px] text-right"
                  aria-label={taken ? "복용 완료 취소" : "복용 체크"}
                >
                  <span
                    className="text-[13px] font-extrabold leading-snug block"
                    style={{ color: taken ? GREEN : BLACK }}
                  >
                    {taken ? "이미 복용했어요" : "복용 예정"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [activePill, setActivePill] = useState(null);
  const [detailSource, setDetailSource] = useState("search");
  const [schedule, setSchedule] = useState([]);
  const [mgmtCamera, setMgmtCamera] = useState(false);

  const addToSchedule = (pill) => {
    setSchedule((prev) => (prev.find((p) => p.id === pill.id) ? prev : [...prev, pill]));
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-200 p-2">
      <div
        className="relative w-[390px] h-[780px] bg-white rounded-[40px] overflow-hidden shadow-2xl border-[6px]"
        style={{ borderColor: "#222", fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" }}
      >
        {screen === "home" && <HomeScreen setScreen={setScreen} setActivePill={setActivePill} setDetailSource={setDetailSource} schedule={schedule} />}
        {screen === "search" && <SearchScreen setScreen={setScreen} setActivePill={setActivePill} setDetailSource={setDetailSource} schedule={schedule} />}
        {screen === "scan" && <ScanScreen setScreen={setScreen} setActivePill={setActivePill} setDetailSource={setDetailSource} schedule={schedule} />}
        {screen === "detail" && <DetailScreen setScreen={setScreen} pill={activePill} addToSchedule={addToSchedule} detailSource={detailSource} />}
        {screen === "feedbackStats" && <FeedbackStatsScreen setScreen={setScreen} />}
        {screen === "management" && (
          <ManagementScreen
            setScreen={setScreen}
            schedule={schedule}
            addToSchedule={addToSchedule}
            onCameraModeChange={setMgmtCamera}
          />
        )}
        {/* 스캔 화면에서도 하단 네비 표시 (중앙 스캔 버튼 활성 톤) */}
        {screen !== "feedbackStats" && !mgmtCamera && <BottomNav screen={screen} setScreen={setScreen} />}
      </div>
    </div>
  );
}
