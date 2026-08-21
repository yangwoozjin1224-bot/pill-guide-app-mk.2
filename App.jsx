import { useState, useEffect, useRef } from "react";
import { Home, Search, Camera, Clock, ChevronLeft, ChevronRight, Volume2, Check } from "lucide-react";
import {
  runVisionSearch,
  recognizeDocumentPipeline,
  terminateOcrWorker,
  getSessionBagHints,
  setSessionBagContext,
} from "./vision/pipeline.js";
import { formatMetricsSummary, getMetrics } from "./vision/metrics.js";

// ---- Design tokens (reference images) ----
const RED = "#E53E3E";
const RED_LIGHT = "#FFF5F5";
const BG = "#F5F5F7";
const CARD = "#FFFFFF";
const BLACK = "#1A1A1A";
const GRAY = "#9CA3AF";
const GRAY2 = "#6B7280";
const BORDER = "#E8E8E8";
const GREEN = "#059669";
const GREEN_BG = "#ECFDF5";
const BLUE_CARD = "#EFF6FF";

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

/** Vision Search candidate pool — imprint / name guided (never color-only). */
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
  if (!uniqueMarks.length && !nameQ) return [];

  const map = new Map();

  const pull = async (query) => {
    try {
      const json = await dataGoFetchJson("PILL_IDENTIFICATION", {
        type: "json",
        numOfRows: "15",
        pageNo: "1",
        ...query,
      });
      for (const it of normalizeItems(json?.body?.items)) {
        const id = String(it.ITEM_SEQ || "");
        if (!id || map.has(id)) continue;
        map.set(id, {
          itemSeq: id,
          name: it.ITEM_NAME || "",
          itemName: it.ITEM_NAME || "",
          entpName: it.ENTP_NAME || "",
          imageUrl: it.ITEM_IMAGE || "",
          tag: it.CLASS_NAME || "의약품",
          mark: it.PRINT_FRONT || "",
          PRINT_FRONT: it.PRINT_FRONT || "",
          PRINT_BACK: it.PRINT_BACK || "",
          shape: it.DRUG_SHAPE || "",
          DRUG_SHAPE: it.DRUG_SHAPE || "",
          color: it.COLOR_CLASS1 || "",
          COLOR_CLASS1: it.COLOR_CLASS1 || "",
        });
      }
    } catch (err) {
      console.warn("Top candidates fetch failed", err);
    }
  };

  for (const m of uniqueMarks) {
    await pull({ print_front: m });
    if (color) await pull({ print_front: m, color_class1: color });
  }
  if (nameQ) {
    await pull({ item_name: nameQ });
    try {
      const list = await searchPillList(nameQ);
      for (const it of list) {
        const id = String(it.itemSeq || it.id || "");
        if (!id || map.has(id)) continue;
        map.set(id, {
          itemSeq: id,
          name: it.name || "",
          itemName: it.name || "",
          entpName: it.entpName || "",
          imageUrl: it.imageUrl || "",
          tag: it.tag || "의약품",
          mark: it.mark || "",
          PRINT_FRONT: it.mark || "",
          PRINT_BACK: "",
          shape: it.shape || "",
          DRUG_SHAPE: it.shape || "",
          color: it.color || "",
          COLOR_CLASS1: it.color || "",
        });
      }
    } catch {
      /* ignore */
    }
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
  { label: "가려움 / 물집", emoji: "🤚", q: "가려움" },
  { label: "두통 / 치통", emoji: "🤕", q: "두통" },
  { label: "설사통 / 통증", emoji: "😣", q: "설사" },
  { label: "소화불량 / 위통", emoji: "🤢", q: "소화불량" },
  { label: "근육통 / 관절통", emoji: "💪", q: "근육통" },
  { label: "비염 / 알레르기", emoji: "🤧", q: "알레르기" },
  { label: "상처 / 피부질환", emoji: "🩹", q: "피부" },
  { label: "눈 건강 / 안약", emoji: "👁️", q: "안약" },
  { label: "만성질환 / 처방약", emoji: "🏥", q: "고혈압" },
  { label: "피로회복 / 비타민", emoji: "🔋", q: "비타민" },
  { label: "유산균 / 장 건강", emoji: "🌀", q: "유산균" },
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
  const items = [
    { key: "home", icon: Home, label: "홈" },
    { key: "search", icon: Search, label: "약 찾기" },
    { key: "scan", icon: Camera, label: "촬영" },
    { key: "management", icon: Clock, label: "복용관리" },
  ];
  return (
    <div
      className="absolute bottom-0 left-0 right-0 bg-white border-t flex items-center justify-around py-2"
      style={{ borderColor: BORDER }}
    >
      {items.map((it) => {
        const Icon = it.icon;
        const active = screen === it.key;
        return (
          <button
            key={it.key}
            onClick={() => setScreen(it.key)}
            className="flex flex-1 flex-col items-center justify-center gap-1 min-h-[56px] py-1"
          >
            <Icon
              size={24}
              color={active ? BLACK : GRAY}
              strokeWidth={active ? 2.6 : 1.8}
            />
            <span className="text-[11px] font-medium" style={{ color: GRAY }}>
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Screens ----

function HomeScreen({ setScreen, setActivePill, setDetailSource, schedule }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24" style={{ backgroundColor: BG }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-4 flex items-center justify-between bg-white">
        <p className="text-[22px] font-extrabold" style={{ color: BLACK }}>양우진 님</p>
        <span className="text-[20px]" style={{ color: GRAY }}>•••</span>
      </div>

      <div className="px-4 pt-4">
        {/* Search bar */}
        <Card className="w-full flex items-center px-4 py-3 gap-3" onClick={() => setScreen("search")}>
          <span className="text-[16px]" style={{ color: GRAY }}>검색하기</span>
          <Search size={20} color={GRAY} className="ml-auto" />
        </Card>
      </div>

      {/* Scan card */}
      <div className="px-4 pt-4">
        <Card
          className="w-full p-5 text-left"
          style={{ background: "linear-gradient(135deg, #E8F5E9 0%, #E3F2FD 100%)" }}
          onClick={() => setScreen("scan")}
        >
          <p className="text-[22px] font-extrabold leading-snug" style={{ color: BLACK }}>알약 촬영하기</p>
          <p className="text-[14px] mt-1 leading-relaxed" style={{ color: GRAY2 }}>
            알약을 카메라로 촬영하면 종류와 복용 방법을 자동으로 찾아드려요.
          </p>
          <div
            className="mt-4 w-[160px] min-h-[44px] rounded-full flex items-center justify-center font-bold text-[16px]"
            style={{ backgroundColor: RED, color: "#fff" }}
          >
            촬영하러 가기
          </div>
        </Card>
      </div>

      {/* Management card */}
      <div className="px-4 pt-3">
        <Card
          className="w-full p-5 text-left"
          style={{ background: "linear-gradient(135deg, #F3E8FF 0%, #EDE9FE 100%)" }}
          onClick={() => setScreen("management")}
        >
          <p className="text-[20px] font-extrabold" style={{ color: BLACK }}>복용 관리</p>
          <p className="text-[14px] mt-1" style={{ color: GRAY2 }}>
            오늘 먹을 약, 잊지 말고 챙기세요
          </p>
          <div
            className="mt-4 w-[160px] min-h-[44px] rounded-full flex items-center justify-center font-bold text-[16px]"
            style={{ backgroundColor: RED, color: "#fff" }}
          >
            복용 기록하기
          </div>
        </Card>
      </div>

      {/* 자주 먹는 약 */}
      <div className="px-4 pt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[18px] font-extrabold" style={{ color: BLACK }}>자주 먹는 약</p>
          <span className="text-[13px] font-semibold" style={{ color: RED }}>전체 확인</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {schedule.length === 0 && (
            <Card className="min-w-[140px] p-4 flex flex-col items-center justify-center gap-2">
              <p className="text-[13px] text-center" style={{ color: GRAY }}>등록된 약이 없어요</p>
            </Card>
          )}
          {schedule.map((p) => (
            <Card
              key={p.id}
              className="min-w-[140px] max-w-[160px] p-3 flex flex-col items-center gap-2 flex-shrink-0"
              onClick={() => {
                setDetailSource("search");
                setActivePill(p);
                setScreen("detail");
              }}
            >
              <div className="w-[80px] h-[80px] rounded-xl overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F9FAFB" }}>
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[14px] font-bold" style={{ color: GRAY }}>이미지 없음</span>
                )}
              </div>
              <p className="text-[14px] font-bold text-center leading-tight" style={{ color: BLACK }}>{p.name.length > 12 ? p.name.slice(0, 12) + "…" : p.name}</p>
              <p className="text-[12px]" style={{ color: GRAY }}>{p.tag}</p>
            </Card>
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
    <div className="flex flex-col h-full pb-24" style={{ backgroundColor: BG }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-3 flex items-center gap-3 bg-white">
        <button onClick={() => setScreen("home")} className="w-[40px] h-[40px] flex items-center justify-center">
          <ChevronLeft size={28} color={BLACK} />
        </button>
        <p className="text-[20px] font-extrabold" style={{ color: BLACK }}>약 찾기</p>
      </div>

      {/* Search input */}
      <div className="px-4 pt-3">
        <Card className="w-full flex items-center px-4 py-3 gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) runSearch(query); }}
            placeholder="약의 이름이나 형태, 증상을 입력해주세요"
            className="flex-1 text-[15px] outline-none bg-transparent"
            style={{ color: BLACK }}
          />
          <button onClick={() => runSearch(query)}>
            <Search size={20} color={GRAY} />
          </button>
        </Card>
        {loading && <p className="text-[14px] font-bold mt-2 text-center" style={{ color: RED }}>검색 중...</p>}
        {errorMsg && !loading && <p className="text-[14px] mt-2 text-center" style={{ color: GRAY2 }}>{errorMsg}</p>}
      </div>

      {/* Categories or results */}
      {!results.length && !loading ? (
        <div className="px-4 pt-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            {CATEGORIES.map((c) => (
              <Card
                key={c.label}
                className="flex flex-col items-center justify-center gap-2 py-4 px-2"
                onClick={() => { setQuery(c.q); runSearch(c.q); }}
              >
                <span className="text-[32px]">{c.emoji}</span>
                <span className="text-[12px] font-bold text-center leading-tight" style={{ color: BLACK }}>{c.label}</span>
              </Card>
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

    // Only accept hits with imprint-matched best (blocks color-only false positives)
    const hits = (pipelineResult.results || []).filter(
      (r) => r.best && (r.fusedConfidence ?? r.best.fusedScore ?? 0) >= 0.35
    );
    const marks = [...new Set(hits.map((r) => r.mark).filter(Boolean))];
    setDetectedMarks(marks);

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
            return { ...detail, detectedMark: r.mark, rerankScore: best.rerankScore };
          }
          return fetchPillData(
            { mark: r.mark, color: r.color, shape: r.shape },
            schedule
          ).then((p) => ({ ...p, detectedMark: r.mark }));
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

    let timerId = null;
    let stopped = false;
    let emptyTries = 0;
    let totalTries = 0;
    let lastMarkKey = "";
    let confirmCount = 0;

    const fail = (msg) => {
      stopped = true;
      processingRef.current = true;
      setStatus("error");
      setErrorMsg(msg);
      setDetectedMarks([]);
    };

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

      totalTries += 1;
      if (totalTries > 14) {
        fail("알약 인식에 실패했습니다. 각인(글자)이 보이게 가까이 찍거나, 표기를 직접 입력해주세요.");
        return;
      }

      try {
        let pipelineResult = await runVisionSearch(frame, {
          candidateFetcher,
          bagHints: getSessionBagHints(),
          frontBack: null,
          debug: debugMode,
          maxInstances: 6,
          shareByEmbedding: true,
          scales: [640, 960],
          minConfidenceKeep: 0.2,
          twoPass: true,
          topK: 10,
        });

        // Dual-side fusion: once front is saved, re-run with front+back crops
        if (dualMode && frontCrop && pipelineResult.results?.[0]?.cropCanvas) {
          pipelineResult = await runVisionSearch(frame, {
            candidateFetcher,
            bagHints: getSessionBagHints(),
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
        if (stopped || cancelledRef.current || processingRef.current) return;

        const dets = pipelineResult.results || [];
        setPillBoxes(boxesFromDetections(dets, frame.width, frame.height));
        if (debugMode) {
          setDebugInfo(pipelineResult.debug);
          setMetricsSnap(formatMetricsSummary(getMetrics()));
        }

        const withMark = dets.filter((d) => d.mark && d.mark.length >= 2);
        const withBest = dets.filter(
          (d) => d.best && (d.fusedConfidence ?? d.best.fusedScore ?? 0) >= 0.35
        );

        if (withMark.length) {
          setDetectedMarks([...new Set(withMark.map((d) => d.mark))]);
        }

        // Dual-side: stash front crop once, then search with front+back fusion
        if (dualMode && !frontCrop && dets[0]?.cropCanvas) {
          const c = document.createElement("canvas");
          c.width = dets[0].cropCanvas.width;
          c.height = dets[0].cropCanvas.height;
          c.getContext("2d").drawImage(dets[0].cropCanvas, 0, 0);
          setFrontCrop(c);
          setCaptureSide("back");
          timerId = setTimeout(tick, 400);
          return;
        }

        if (!withMark.length && !withBest.length) {
          emptyTries += 1;
          lastMarkKey = "";
          confirmCount = 0;
          if (emptyTries >= 8) {
            fail("알약 각인(표기)을 읽지 못했습니다. 글자가 선명하게 보이게 찍거나 직접 입력해주세요.");
            return;
          }
          timerId = setTimeout(tick, 220);
          return;
        }

        emptyTries = 0;
        const key = (withBest.length ? withBest : withMark)
          .map((d) => d.mark)
          .filter(Boolean)
          .sort()
          .join("|");

        if (key && key === lastMarkKey) confirmCount += 1;
        else {
          lastMarkKey = key;
          confirmCount = 1;
        }

        // withBest: accept on first solid match; mark-only: need 2 frames
        const needConfirm = withBest.length ? 1 : 2;
        if (confirmCount < needConfirm) {
          timerId = setTimeout(tick, 240);
          return;
        }

        if (withBest.length) {
          const ok = await finalizePipelineResults(pipelineResult);
          if (!ok && !stopped && !cancelledRef.current) {
            processingRef.current = false;
            confirmCount = 0;
            lastMarkKey = "";
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
      <div className="flex flex-col h-full pb-6" style={{ backgroundColor: BG }}>
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
          <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "560px" }}>
            {foundPills.map((p) => (
              <Card key={p.id} className="w-full flex items-center gap-3 px-3 py-3 text-left" onClick={() => openPill(p)}>
                <div className="w-[56px] h-[56px] rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F9FAFB" }}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[12px] font-bold" style={{ color: GRAY }}>약</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold leading-tight" style={{ color: BLACK }}>{p.name}</p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: GRAY }}>
                    {[p.detectedMark && `표기 ${p.detectedMark}`, p.tag].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <ChevronRight size={18} color={GRAY} />
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
    <div className="flex flex-col h-full" style={{ backgroundColor: "#000" }}>
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
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] rounded-3xl overflow-hidden"
            style={{
              border: `3px solid ${status === "loading" ? "#34D399" : "rgba(255,255,255,0.75)"}`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
            }}
          >
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

      <div className="px-5 py-4" style={{ backgroundColor: CARD }}>
        {status !== "error" ? (
          <div className="text-center">
            <p className="text-[15px] font-bold" style={{ color: BLACK }}>{statusText}</p>
            {detectedMarks.length > 0 && (status === "scanning" || status === "loading") && (
              <p className="text-[12px] mt-1" style={{ color: GRAY }}>
                읽은 표기: {detectedMarks.join(", ")}
              </p>
            )}
            {status === "scanning" && (
              <p className="text-[12px] mt-2 leading-relaxed" style={{ color: GRAY2 }}>
                {dualMode
                  ? captureSide === "back"
                    ? "앞면을 저장했습니다. 이제 뒷면 각인을 맞춰 주세요"
                    : "앞면+뒷면 모드: 먼저 앞면 각인을 맞춰 주세요"
                  : "Vision Search: 알약 글자(각인)가 선명하게 보이도록 가까이 맞춰 주세요"}
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
    <div className="flex flex-col h-full overflow-y-auto pb-28" style={{ backgroundColor: BG }}>
      <div className="px-4 pt-5 pb-3 flex items-center gap-3 bg-white">
        <button onClick={() => setScreen(detailSource === "search" ? "search" : "home")} className="w-[40px] h-[40px] flex items-center justify-center">
          <ChevronLeft size={28} color={BLACK} />
        </button>
        {detailSource === "scan" && (
          <button onClick={() => speak(`${pill.name}. ${pill.tag}. ${pill.timing}`)} className="ml-auto w-[40px] h-[40px] flex items-center justify-center">
            <Volume2 size={22} color={RED} />
          </button>
        )}
      </div>

      {/* Pill image */}
      <div className="bg-white px-5 pt-2 pb-5">
        <div className="w-full h-[180px] rounded-2xl overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F9FAFB" }}>
          {pill.imageUrl ? (
            <img src={pill.imageUrl} alt={pill.name} className="w-full h-full object-contain" />
          ) : (
            <span className="text-[16px] font-bold" style={{ color: GRAY }}>이미지 없음</span>
          )}
        </div>
        <p className="text-[24px] font-extrabold mt-4 leading-tight" style={{ color: BLACK }}>{pill.name}</p>
        {pill.entpName && <p className="text-[13px] mt-1" style={{ color: GRAY }}>{pill.entpName}</p>}
      </div>

      {/* Details */}
      <div className="px-4 pt-4">
        <Card className="p-5">
          <p className="text-[16px] font-extrabold mb-3" style={{ color: BLACK }}>세부사항</p>

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
        </Card>
      </div>

      <div className="px-4 pt-4 pb-4">
        <button
          onClick={() => { addToSchedule(pill); setRegistered(true); if (detailSource === "scan") speak("복용 관리에 등록되었습니다"); }}
          className="w-full min-h-[52px] rounded-full font-bold text-[17px]"
          style={{ backgroundColor: registered ? GREEN : RED, color: "#fff" }}
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
  const [status, setStatus] = useState("ready"); // ready | reading | looking | done | error
  const [msg, setMsg] = useState("");
  const [foundNames, setFoundNames] = useState([]);
  const [cameraError, setCameraError] = useState("");
  const [snapUrl, setSnapUrl] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);

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

  const startCameraView = async () => {
    setView("camera");
    onCameraModeChange?.(true);
    setStatus("ready");
    setMsg("");
    setFoundNames([]);
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      setSnapUrl("");
    }
    await openCamera();
  };

  const backToList = () => {
    stopCamera();
    setView("list");
    onCameraModeChange?.(false);
    setStatus("ready");
    setMsg("");
    setFoundNames([]);
    setCameraError("");
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      setSnapUrl("");
    }
  };

  useEffect(() => {
    return () => {
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

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setStatus("error");
      setMsg("카메라가 아직 준비되지 않았습니다.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 미리보기용
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (snapUrl) URL.revokeObjectURL(snapUrl);
      setSnapUrl(URL.createObjectURL(blob));
    }, "image/jpeg", 0.9);

    stopCamera();
    await processCapturedCanvas(canvas);
  };

  const retake = async () => {
    setStatus("ready");
    setMsg("");
    setFoundNames([]);
    if (snapUrl) {
      URL.revokeObjectURL(snapUrl);
      setSnapUrl("");
    }
    await openCamera();
  };

  // ---- 카메라 촬영 화면 (실시간 인식 X, 버튼으로 1장 촬영) ----
  if (view === "camera") {
    const busy = status === "reading" || status === "looking";
    return (
      <div className="flex flex-col h-full" style={{ backgroundColor: "#000" }}>
        <div className="px-4 pt-5 pb-3 flex items-center gap-3">
          <button onClick={backToList} className="w-[40px] h-[40px] flex items-center justify-center">
            <ChevronLeft size={28} color="#fff" />
          </button>
          <p className="text-[18px] font-bold text-white">처방전 / 약봉지 촬영</p>
        </div>

        <div className="flex-1 relative overflow-hidden">
          {snapUrl && status !== "ready" ? (
            <img src={snapUrl} alt="촬영 사진" className="absolute inset-0 w-full h-full object-cover" />
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
          ) : status === "ready" ? (
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[360px] rounded-2xl"
              style={{ border: "3px solid rgba(255,255,255,0.75)", boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
            />
          ) : null}
        </div>

        <div className="px-5 py-4" style={{ backgroundColor: CARD }}>
          {status === "ready" && (
            <>
              <p className="text-[14px] text-center font-bold mb-3" style={{ color: BLACK }}>
                처방전/약봉지를 맞춘 뒤 촬영하세요
              </p>
              <button
                onClick={takePhoto}
                className="w-full min-h-[52px] rounded-full font-bold text-[17px]"
                style={{ backgroundColor: RED, color: "#fff" }}
              >
                촬영하기
              </button>
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
                다시 촬영하기
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
    <div className="flex flex-col h-full overflow-y-auto pb-24" style={{ backgroundColor: BG }}>
      <div className="px-5 pt-6 pb-3 bg-white">
        <p className="text-[22px] font-extrabold text-center" style={{ color: BLACK }}>복용 관리</p>
      </div>

      <div className="px-4 pt-4">
        <Card className="p-4">
          <p className="text-[16px] font-extrabold" style={{ color: BLACK }}>처방전 · 약봉지 등록</p>
          <p className="text-[13px] mt-1 leading-relaxed" style={{ color: GRAY2 }}>
            카메라를 켜고 촬영하면 약 이름을 읽어 복용 관리에 추가합니다.
          </p>
          <button
            onClick={startCameraView}
            className="w-full min-h-[48px] rounded-full font-bold text-[16px] mt-3 flex items-center justify-center gap-2"
            style={{ backgroundColor: RED, color: "#fff" }}
          >
            <Camera size={18} />
            처방전 / 약봉지 촬영
          </button>
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
              <Card key={p.id} className="w-full flex items-center gap-3 px-4 py-3" style={{ opacity: taken ? 0.5 : 1 }}>
                <div className="w-[60px] h-[60px] rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#F9FAFB" }}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[12px] font-bold" style={{ color: GRAY }}>약</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-bold leading-tight truncate" style={{ color: BLACK }}>{p.name}</p>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: GRAY }}>{p.tag}</p>
                  <p className="text-[12px]" style={{ color: GRAY }}>{(p.timing || "").slice(0, 30)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleTaken(p.id)}
                    className="min-h-[36px] px-3 rounded-full font-bold text-[13px] flex items-center gap-1"
                    style={{
                      backgroundColor: taken ? GREEN_BG : RED_LIGHT,
                      color: taken ? GREEN : RED,
                    }}
                  >
                    {taken ? (<><Check size={14} /> 복용완료</>) : "복용 체크"}
                  </button>
                </div>
              </Card>
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
        {screen === "management" && (
          <ManagementScreen
            setScreen={setScreen}
            schedule={schedule}
            addToSchedule={addToSchedule}
            onCameraModeChange={setMgmtCamera}
          />
        )}
        {screen !== "scan" && !mgmtCamera && <BottomNav screen={screen} setScreen={setScreen} />}
      </div>
    </div>
  );
}
