import { useState, useEffect, useRef } from "react";
import { Home, Search, Camera, Clock, ChevronLeft, ChevronRight, Volume2, Check, FileText } from "lucide-react";
import Tesseract from "tesseract.js";

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

async function fetchPillIdentification({ shape, color, mark, itemName, itemSeq } = {}) {
  const query = {
    type: "json", numOfRows: "20", pageNo: "1",
    ...(itemSeq ? { item_seq: itemSeq } : {}),
    ...(itemName ? { item_name: itemName } : {}),
    ...(mark ? { print_front: mark } : {}),
    ...(color ? { color_class1: color } : {}),
    ...(shape ? { drug_shape: shape } : {}),
  };
  const json = await dataGoFetchJson("PILL_IDENTIFICATION", query);
  const items = normalizeItems(json?.body?.items);
  if (!items.length) throw new Error("일치하는 알약 정보를 찾을 수 없습니다");

  let item = items[0];
  if (mark) {
    const upper = String(mark).toUpperCase();
    const scored = items
      .map((it) => {
        const front = String(it.PRINT_FRONT || "").toUpperCase();
        const back = String(it.PRINT_BACK || "").toUpperCase();
        let score = 0;
        if (front === upper || back === upper) score += 100;
        else if (front.includes(upper) || upper.includes(front) || back.includes(upper)) score += 50;
        if (color && String(it.COLOR_CLASS1 || "").includes(color)) score += 20;
        if (shape && String(it.DRUG_SHAPE || "").includes(shape)) score += 10;
        return { it, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) item = scored[0].it;
  }

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
  const [status, setStatus] = useState("scanning"); // scanning | ocr | loading | results | error
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [manualMark, setManualMark] = useState("");
  const [detectedMarks, setDetectedMarks] = useState([]);
  const [foundPills, setFoundPills] = useState([]);
  const [pillBoxes, setPillBoxes] = useState([]);
  const cancelledRef = useRef(false);
  const processingRef = useRef(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const workerRef = useRef(null);
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
    let alive = true;
    cancelledRef.current = false;

    (async () => {
      await openCamera();
      try {
        const worker = await Tesseract.createWorker("eng", 1, {});
        // 여러 알약 표기를 동시에 잡기 위해 sparse text 모드 사용
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
          tessedit_pageseg_mode: "11",
        });
        if (!alive) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
      } catch (err) {
        console.error("OCR 워커 초기화 실패:", err);
      }
    })();

    return () => {
      alive = false;
      cancelledRef.current = true;
      stopCamera();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // 중앙 넓은 영역을 고해상도로 캡처
  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const crop = Math.min(vw, vh) * 0.85;
    const sx = (vw - crop) / 2;
    const sy = (vh - crop) / 2;
    const out = 520;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(video, sx, sy, crop, crop, 0, 0, out, out);
    return canvas;
  };

  // 약봉지 안 알약들을 blob으로 분리 (연결요소 분석)
  const segmentPillRegions = (canvas) => {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];

    // 빠른 분석을 위해 축소 마스크 사용
    const sw = 140;
    const sh = 140;
    const scaleX = w / sw;
    const scaleY = h / sh;
    const small = document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(canvas, 0, 0, sw, sh);
    const img = sctx.getImageData(0, 0, sw, sh);
    const d = img.data;

    // 가장자리 픽셀로 배경색 추정 (약봉지 바탕)
    let br = 0;
    let bg = 0;
    let bb = 0;
    let bn = 0;
    const sampleBorder = (x, y) => {
      const i = (y * sw + x) * 4;
      br += d[i];
      bg += d[i + 1];
      bb += d[i + 2];
      bn += 1;
    };
    for (let x = 0; x < sw; x += 2) {
      sampleBorder(x, 0);
      sampleBorder(x, sh - 1);
    }
    for (let y = 0; y < sh; y += 2) {
      sampleBorder(0, y);
      sampleBorder(sw - 1, y);
    }
    br /= bn || 1;
    bg /= bn || 1;
    bb /= bn || 1;

    // 배경과 색이 충분히 다른 픽셀 = 알약 후보
    const mask = new Uint8Array(sw * sh);
    for (let y = 2; y < sh - 2; y++) {
      for (let x = 2; x < sw - 2; x++) {
        const i = (y * sw + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const dist = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);
        const maxc = Math.max(r, g, b);
        const minc = Math.min(r, g, b);
        const sat = maxc === 0 ? 0 : (maxc - minc) / maxc;
        // 색 차이 크거나, 채도 있는 알약 색
        if (dist > 70 || (sat > 0.22 && maxc > 90)) mask[y * sw + x] = 1;
      }
    }

    // 연결요소 라벨링
    const labels = new Int32Array(sw * sh);
    let label = 0;
    const comps = []; // {minX,minY,maxX,maxY,area}

    const flood = (sx, sy, id) => {
      const stack = [[sx, sy]];
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      let area = 0;
      while (stack.length) {
        const [x, y] = stack.pop();
        const idx = y * sw + x;
        if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
        if (!mask[idx] || labels[idx]) continue;
        labels[idx] = id;
        area += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      return { minX, maxX, minY, maxY, area };
    };

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const idx = y * sw + x;
        if (mask[idx] && !labels[idx]) {
          label += 1;
          comps.push(flood(x, y, label));
        }
      }
    }

    const frameArea = sw * sh;
    const boxes = comps
      .filter((c) => {
        const bw = c.maxX - c.minX + 1;
        const bh = c.maxY - c.minY + 1;
        const ratio = bw / Math.max(bh, 1);
        // 알약 크기/형태 필터 (너무 작거나 전체 배경 blob 제외)
        if (c.area < frameArea * 0.008 || c.area > frameArea * 0.35) return false;
        if (ratio > 2.8 || ratio < 0.35) return false;
        if (bw < 10 || bh < 10) return false;
        return true;
      })
      .sort((a, b) => b.area - a.area)
      .slice(0, 8);

    // 원본 해상도 crop 생성
    const crops = [];
    for (const c of boxes) {
      const pad = 6;
      const x = Math.max(0, Math.floor((c.minX - pad) * scaleX));
      const y = Math.max(0, Math.floor((c.minY - pad) * scaleY));
      const cw = Math.min(w - x, Math.ceil((c.maxX - c.minX + 1 + pad * 2) * scaleX));
      const ch = Math.min(h - y, Math.ceil((c.maxY - c.minY + 1 + pad * 2) * scaleY));
      if (cw < 24 || ch < 24) continue;

      const crop = document.createElement("canvas");
      // OCR용으로 정사각 패딩
      const side = Math.max(cw, ch, 120);
      crop.width = side;
      crop.height = side;
      const cctx = crop.getContext("2d");
      cctx.fillStyle = "#ffffff";
      cctx.fillRect(0, 0, side, side);
      const ox = Math.floor((side - cw) / 2);
      const oy = Math.floor((side - ch) / 2);
      cctx.drawImage(canvas, x, y, cw, ch, ox, oy, cw, ch);

      crops.push({
        canvas: crop,
        box: {
          // UI overlay용 (520 기준 정규화 %)
          left: (x / w) * 100,
          top: (y / h) * 100,
          width: (cw / w) * 100,
          height: (ch / h) * 100,
        },
      });
    }

    // blob이 거의 없으면 2x2 그리드로라도 분리 시도 (약봉지 대응)
    if (crops.length < 2) {
      const grid = [];
      for (let gy = 0; gy < 2; gy++) {
        for (let gx = 0; gx < 2; gx++) {
          const gw = Math.floor(w / 2);
          const gh = Math.floor(h / 2);
          const x = gx * gw;
          const y = gy * gh;
          const crop = document.createElement("canvas");
          crop.width = 200;
          crop.height = 200;
          crop.getContext("2d").drawImage(canvas, x, y, gw, gh, 0, 0, 200, 200);
          grid.push({
            canvas: crop,
            box: {
              left: (x / w) * 100,
              top: (y / h) * 100,
              width: (gw / w) * 100,
              height: (gh / h) * 100,
            },
          });
        }
      }
      return grid;
    }

    return crops;
  };

  // 여러 전처리 버전을 만들어 OCR 성공률을 올림
  const buildPreprocessedCanvases = (source) => {
    const w = source.width;
    const h = source.height;
    const srcCtx = source.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) return [source];
    const src = srcCtx.getImageData(0, 0, w, h);
    const data = src.data;

    const makeFromPixels = (fn) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const v = fn(r, g, b);
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return c;
    };

    const contrast = makeFromPixels((r, g, b) => {
      let y = 0.299 * r + 0.587 * g + 0.114 * b;
      y = (y - 128) * 1.8 + 128;
      return Math.max(0, Math.min(255, y));
    });

    const binary = makeFromPixels((r, g, b) => {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      return y > 145 ? 255 : 0;
    });

    const inverted = makeFromPixels((r, g, b) => {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      return y > 145 ? 0 : 255;
    });

    return [contrast, binary, inverted];
  };

  // 알약 대략 색상 → 공공 API color_class1 값
  const estimatePillColor = (canvas) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    const { width: ww, height: hh } = canvas;
    const img = ctx.getImageData(Math.floor(ww * 0.25), Math.floor(hh * 0.25), Math.floor(ww * 0.5), Math.floor(hh * 0.5));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < img.data.length; i += 16) {
      const rr = img.data[i];
      const gg = img.data[i + 1];
      const bb = img.data[i + 2];
      if (rr + gg + bb < 80) continue;
      r += rr;
      g += gg;
      b += bb;
      n += 1;
    }
    if (!n) return "";
    r /= n;
    g /= n;
    b /= n;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    if (sat < 0.18) {
      if (max > 200) return "하양";
      if (max < 90) return "검정";
      return "회색";
    }
    if (r > 180 && g < 120 && b < 120) return "빨강";
    if (r > 180 && g > 100 && b < 100) return "주황";
    if (r > 180 && g > 150 && b < 120) return "노랑";
    if (r > 170 && g > 100 && b > 130) return "분홍";
    if (g > r && g > b) return g > 150 ? "연두" : "초록";
    if (b > r && b > g) return "파랑";
    if (r > 120 && b > 120 && g < 120) return "보라";
    if (r > 120 && g > 80 && b < 80) return "갈색";
    return "";
  };

  // 단일 crop OCR (전처리 2종만 — 속도/정확도 균형)
  const ocrSingleCrop = async (cropCanvas) => {
    const worker = workerRef.current;
    if (!worker) return { mark: "", color: "", score: 0 };

    const color = estimatePillColor(cropCanvas);
    const variants = buildPreprocessedCanvases(cropCanvas).slice(0, 2);
    const scoreMap = new Map();

    for (const variant of variants) {
      try {
        const result = await worker.recognize(variant);
        const words = result?.data?.words || [];
        if (words.length) {
          for (const w of words) {
            const raw = String(w.text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (raw.length < 3 || raw.length > 12) continue;
            const conf = Number(w.confidence || 0);
            if (conf < 40) continue;
            scoreMap.set(raw, (scoreMap.get(raw) || 0) + conf + raw.length);
          }
        } else {
          const text = (result?.data?.text || "").toUpperCase();
          const candidates = text.match(/[A-Z0-9]{3,12}/g) || [];
          for (const raw of candidates) {
            scoreMap.set(raw, (scoreMap.get(raw) || 0) + 35 + raw.length);
          }
        }
      } catch {}
    }

    const ranked = Array.from(scoreMap.entries()).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { mark: "", color, score: 0 };
    return { mark: ranked[0][0], color, score: ranked[0][1] };
  };

  // 알약 영역 분리 → 각각 OCR (약봉지 다중 알약 핵심)
  const extractMarksWithOcr = async (canvas) => {
    const regions = segmentPillRegions(canvas);
    setPillBoxes(regions.map((r) => r.box));

    const detections = [];
    const seen = new Set();

    for (const region of regions) {
      const { mark, color, score } = await ocrSingleCrop(region.canvas);
      if (!mark || score < 50) continue;
      if (seen.has(mark)) continue;
      seen.add(mark);
      detections.push({ mark, color, score });
      if (detections.length >= 6) break;
    }

    // 분리 실패 시 전체 프레임 fallback
    if (!detections.length) {
      const whole = await ocrSingleCrop(canvas);
      if (whole.mark) detections.push(whole);
    }

    detections.sort((a, b) => b.score - a.score);
    return {
      detections,
      marks: detections.map((d) => d.mark),
    };
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
        list.map((d) =>
          fetchPillData(
            {
              mark: d.mark,
              itemName: d.mark,
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
        processingRef.current = true; // 루프 재개 방지
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
      processingRef.current = true;
      stopCamera();
    } catch (err) {
      if (cancelledRef.current) return;
      setStatus("error");
      setErrorMsg(err.message || "알약을 찾을 수 없습니다");
      processingRef.current = true;
    }
  };

  const runManualSearch = async () => {
    const manual = String(manualMark || "").trim();
    if (!manual) return;
    setErrorMsg("");
    // 쉼표/공백으로 여러 표기 입력 가능
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
    setErrorMsg("");
    setManualMark("");
    processingRef.current = false;
    setStatus("scanning");
    await openCamera();
    setResumeKey((k) => k + 1);
  };

  // 실시간 OCR 루프: 하단 문구는 scanning/loading/error만 사용해 깜빡임 제거
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
    let lastKey = "";
    let confirmCount = 0;
    let lastDetections = [];
    let emptyTries = 0;
    let totalTries = 0;

    const fail = (msg) => {
      stopped = true;
      processingRef.current = true;
      setStatus("error");
      setErrorMsg(msg);
      setDetectedMarks([]);
    };

    const tick = async () => {
      if (stopped || cancelledRef.current || processingRef.current) return;

      if (!workerRef.current || !videoRef.current?.videoWidth) {
        timerId = setTimeout(tick, 120);
        return;
      }

      const frame = captureFrame();
      if (!frame) {
        timerId = setTimeout(tick, 120);
        return;
      }

      totalTries += 1;
      if (totalTries > 12) {
        fail("알약 인식에 실패했습니다. 밝은 곳에서 다시 시도하거나 표기를 직접 입력해주세요.");
        return;
      }

      try {
        const { detections, marks } = await extractMarksWithOcr(frame);
        if (stopped || cancelledRef.current || processingRef.current) return;

        if (!detections.length) {
          emptyTries += 1;
          lastKey = "";
          confirmCount = 0;
          if (emptyTries >= 6) {
            fail("알약을 찾지 못했습니다. 약봉지를 펼쳐 알약이 보이게 한 뒤 다시 시도해주세요.");
            return;
          }
          // status는 scanning 유지 (문구 깜빡임 방지)
          timerId = setTimeout(tick, 200);
          return;
        }

        emptyTries = 0;
        const key = marks.slice().sort().join("|");
        if (key === lastKey) {
          confirmCount += 1;
        } else {
          lastKey = key;
          confirmCount = 1;
          lastDetections = detections;
        }

        if (confirmCount >= 2) {
          setDetectedMarks(marks);
          await lookupMarks(lastDetections.length ? lastDetections : detections);
          return;
        }

        timerId = setTimeout(tick, 180);
      } catch {
        if (!stopped && !cancelledRef.current && !processingRef.current) {
          timerId = setTimeout(tick, 200);
        }
      }
    };

    timerId = setTimeout(tick, 250);

    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [cameraError, resumeKey]);

  const statusText = {
    scanning: "알약을 인식하고 있어요",
    loading: "약 정보를 불러오고 있어요",
    found: "알약을 인식했어요",
    results: `${foundPills.length}개 알약을 찾았어요`,
    error: errorMsg,
  }[status];

  // 여러 알약 결과 목록 화면
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
        <p className="text-[18px] font-bold text-white">알약 촬영</p>
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
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-4" style={{ backgroundColor: CARD }}>
        {status !== "error" ? (
          <div className="text-center">
            <p className="text-[15px] font-bold" style={{ color: BLACK }}>{statusText}</p>
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


// 처방전/약봉지 OCR 텍스트에서 약 이름 후보 추출
function extractDrugNameCandidates(ocrText) {
  const text = String(ocrText || "");
  const found = [];
  const seen = new Set();

  const push = (name) => {
    const n = String(name || "").replace(/\s+/g, "").trim();
    if (!n || n.length < 2 || n.length > 40) return;
    const key = n.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(n);
  };

  const formRe =
    /([가-힣A-Za-z][가-힣A-Za-z0-9]{0,24}(?:정|캡슐|연질캡슐|서방정|필름코팅정|시럽|산|액|주|겔|연고|크림|패치|좌제|환))/g;
  let m;
  while ((m = formRe.exec(text)) !== null) push(m[1]);

  const doseRe = /([가-힣A-Za-z][가-힣A-Za-z0-9]{1,20})\s*(\d+)\s*(mg|MG|밀리그람|밀리그램)/g;
  while ((m = doseRe.exec(text)) !== null) {
    push(m[1]);
    push(`${m[1]}${m[2]}mg`);
  }

  const engRe = /\b([A-Z][A-Z0-9-]{2,16})\b/g;
  const skip = new Set(["THE", "AND", "FOR", "TAB", "CAP", "MG", "ML", "DOS", "DAY", "TAKE", "WITH"]);
  while ((m = engRe.exec(text.toUpperCase())) !== null) {
    if (!skip.has(m[1])) push(m[1]);
  }

  return found.slice(0, 8);
}

function ManagementScreen({ setScreen, schedule, addToSchedule }) {
  const [takenIds, setTakenIds] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | reading | looking | done | error
  const [msg, setMsg] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [foundNames, setFoundNames] = useState([]);
  const fileRef = useRef(null);

  const toggleTaken = (id) => setTakenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const resetScan = () => {
    setStatus("idle");
    setMsg("");
    setFoundNames([]);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const processImageFile = async (file) => {
    if (!file) return;
    setStatus("idle");
    setMsg("");
    setFoundNames([]);
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setStatus("reading");
    setMsg("처방전/약봉지 글자를 읽고 있어요...");

    try {
      const result = await Tesseract.recognize(file, "kor+eng", {});
      const text = result?.data?.text || "";
      const candidates = extractDrugNameCandidates(text);

      if (!candidates.length) {
        setStatus("error");
        setMsg("약 이름을 읽지 못했습니다. 글자가 선명하게 나오게 다시 촬영해주세요.");
        return;
      }

      setFoundNames(candidates);
      setStatus("looking");
      setMsg(`${candidates.length}개 약 이름을 찾았습니다. 정보를 조회해요...`);

      let added = 0;
      const failed = [];

      for (const name of candidates) {
        try {
          const list = await searchPillList(name);
          const top = list[0];
          if (!top) {
            failed.push(name);
            continue;
          }
          const detail = await fetchPillDetailBySeq(top.itemSeq, top.name, schedule).catch(() => ({
            id: top.itemSeq,
            itemSeq: top.itemSeq,
            name: top.name,
            tag: top.tag || "의약품",
            time: "처방 정보 확인",
            timing: top.timing || "복용법 정보 없음",
            effect: top.effect || top.tag || "정보 없음",
            caution: top.caution || "주의사항 정보 없음",
            durWarning: null,
            imageUrl: top.imageUrl || "",
            entpName: top.entpName || "",
          }));
          addToSchedule(detail);
          added += 1;
        } catch {
          failed.push(name);
        }
      }

      if (added === 0) {
        setStatus("error");
        setMsg("약은 읽었지만 공공 API에서 정보를 찾지 못했습니다. 약 찾기로 직접 검색해보세요.");
        return;
      }

      setStatus("done");
      setMsg(
        failed.length
          ? `${added}개 약을 복용 관리에 추가했습니다. (일부 실패: ${failed.join(", ")})`
          : `${added}개 약을 복용 관리에 추가했습니다.`
      );
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMsg("이미지 인식에 실패했습니다. 다시 촬영해주세요.");
    }
  };

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24" style={{ backgroundColor: BG }}>
      <div className="px-5 pt-6 pb-3 bg-white">
        <p className="text-[22px] font-extrabold text-center" style={{ color: BLACK }}>복용 관리</p>
      </div>

      <div className="px-4 pt-4">
        <Card className="p-4">
          <p className="text-[16px] font-extrabold" style={{ color: BLACK }}>처방전 · 약봉지 등록</p>
          <p className="text-[13px] mt-1 leading-relaxed" style={{ color: GRAY2 }}>
            처방전이나 약봉지를 촬영하면 약 이름을 읽어 복용 관리에 추가합니다.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPickFile}
          />

          <button
            onClick={() => fileRef.current?.click()}
            disabled={status === "reading" || status === "looking"}
            className="w-full min-h-[48px] rounded-full font-bold text-[16px] mt-3 flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: RED, color: "#fff" }}
          >
            <FileText size={18} />
            {status === "reading" || status === "looking" ? "인식 중..." : "처방전 / 약봉지 촬영"}
          </button>

          {previewUrl && (
            <div className="mt-3 w-full h-[120px] rounded-xl overflow-hidden" style={{ backgroundColor: "#F9FAFB" }}>
              <img src={previewUrl} alt="촬영 미리보기" className="w-full h-full object-contain" />
            </div>
          )}

          {msg && (
            <p
              className="text-[13px] font-bold mt-3 text-center leading-relaxed"
              style={{ color: status === "error" ? RED : status === "done" ? GREEN : GRAY2 }}
            >
              {msg}
            </p>
          )}

          {foundNames.length > 0 && (status === "looking" || status === "done" || status === "error") && (
            <p className="text-[12px] mt-2 text-center" style={{ color: GRAY }}>
              인식된 이름: {foundNames.join(", ")}
            </p>
          )}

          {(status === "done" || status === "error") && (
            <button
              onClick={resetScan}
              className="w-full min-h-[40px] rounded-full font-bold text-[14px] mt-2"
              style={{ backgroundColor: BLACK, color: "#fff" }}
            >
              다시 촬영하기
            </button>
          )}
        </Card>
      </div>

      {schedule.length === 0 ? (
        <div className="px-4 pt-8 flex flex-col items-center gap-3">
          <p className="text-[15px] text-center" style={{ color: GRAY }}>
            등록된 약이 없습니다.
            <br />
            위 버튼으로 처방전/약봉지를 등록해보세요.
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
          <ManagementScreen setScreen={setScreen} schedule={schedule} addToSchedule={addToSchedule} />
        )}
        {screen !== "scan" && <BottomNav screen={screen} setScreen={setScreen} />}
      </div>
    </div>
  );
}
