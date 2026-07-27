import { useState, useEffect, useRef } from "react";
import { Home, Search, Camera, Clock, ChevronLeft, ChevronRight, Volume2, Check } from "lucide-react";
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
    type: "json", numOfRows: "10", pageNo: "1",
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
    const matched = items.find((it) => String(it.PRINT_FRONT || "").toUpperCase().includes(upper));
    if (matched) item = matched;
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
        <div className="flex items-center gap-2">
          <span className="text-[28px]">🏥</span>
          <p className="text-[22px] font-extrabold" style={{ color: BLACK }}>양우진 님</p>
        </div>
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
  const [status, setStatus] = useState("scanning"); // scanning | ocr | loading | found | error
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [manualMark, setManualMark] = useState("");
  const [detectedMark, setDetectedMark] = useState("");
  const cancelledRef = useRef(false);
  const ocrBusyRef = useRef(false);
  const processingRef = useRef(false);
  const lastMarkRef = useRef("");
  const confirmCountRef = useRef(0);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

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
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
    openCamera();
    return () => stopCamera();
  }, []);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const scale = video.videoWidth > 640 ? 640 / video.videoWidth : 1;
    const w = Math.floor(video.videoWidth * scale);
    const h = Math.floor(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.filter = "grayscale(1) contrast(1.7)";
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const extractMarkWithOcr = async (imageDataUrl) => {
    const result = await Tesseract.recognize(imageDataUrl, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    });
    const text = (result?.data?.text || "").toUpperCase();
    const candidates = text.match(/[A-Z0-9]{3,}/g) || [];
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].trim();
  };

  const lookupMark = async (mark) => {
    processingRef.current = true;
    setStatus("loading");
    setDetectedMark(mark);
    try {
      const data = await fetchPillData({ mark, itemName: mark }, schedule);
      if (cancelledRef.current) return;
      setStatus("found");
      setDetailSource("scan");
      setActivePill(data);
      setScreen("detail");
    } catch (err) {
      if (cancelledRef.current) return;
      setStatus("error");
      setErrorMsg(err.message || "알약을 찾을 수 없습니다");
      processingRef.current = false;
      lastMarkRef.current = "";
      confirmCountRef.current = 0;
    }
  };

  const runManualSearch = async () => {
    const manual = String(manualMark || "").trim();
    if (!manual) return;
    setErrorMsg("");
    await lookupMark(manual);
  };

  // 실시간 OCR 루프: 2.5초마다 프레임 분석, 동일 표기 2회 연속이면 API 조회
  useEffect(() => {
    if (cameraError) return;

    cancelledRef.current = false;
    processingRef.current = false;
    lastMarkRef.current = "";
    confirmCountRef.current = 0;
    setStatus("scanning");

    const intervalId = setInterval(async () => {
      if (cancelledRef.current || processingRef.current || ocrBusyRef.current) return;

      const frame = captureFrame();
      if (!frame) return;

      ocrBusyRef.current = true;
      setStatus("ocr");
      try {
        const mark = await extractMarkWithOcr(frame);
        if (cancelledRef.current || processingRef.current) return;

        if (!mark) {
          lastMarkRef.current = "";
          confirmCountRef.current = 0;
          setDetectedMark("");
          setStatus("scanning");
          return;
        }

        setDetectedMark(mark);
        if (mark === lastMarkRef.current) {
          confirmCountRef.current += 1;
        } else {
          lastMarkRef.current = mark;
          confirmCountRef.current = 1;
        }

        if (confirmCountRef.current >= 2) {
          clearInterval(intervalId);
          await lookupMark(mark);
          return;
        }

        setStatus("scanning");
      } catch {
        if (!cancelledRef.current && !processingRef.current) setStatus("scanning");
      } finally {
        ocrBusyRef.current = false;
      }
    }, 2500);

    return () => {
      cancelledRef.current = true;
      clearInterval(intervalId);
    };
  }, [cameraError]);

  const statusText = {
    scanning: "실시간으로 알약을 인식하고 있어요...",
    ocr: "알약 표기를 읽고 있어요...",
    loading: "알약 정보를 불러오고 있어요...",
    found: "알약을 인식했어요!",
    error: errorMsg,
  }[status];

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
          <>
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] rounded-3xl relative"
              style={{
                border: `3px solid ${status === "found" || status === "loading" ? "#34D399" : "rgba(255,255,255,0.75)"}`,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
              }}
            >
              {(status === "scanning" || status === "ocr") && (
                <div
                  className="absolute left-3 right-3 h-[2px] rounded"
                  style={{ backgroundColor: "#fff", animation: "scanline 1.4s linear infinite" }}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="px-5 py-4" style={{ backgroundColor: CARD }}>
        {status !== "error" ? (
          <div className="text-center">
            <p className="text-[15px] font-bold" style={{ color: BLACK }}>{statusText}</p>
            {detectedMark && status !== "loading" && status !== "found" && (
              <p className="text-[13px] mt-1" style={{ color: GRAY2 }}>
                인식된 표기: {detectedMark}
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
                placeholder="알약 표기 직접 입력"
                className="flex-1 text-[15px] outline-none bg-transparent"
                style={{ color: BLACK }}
              />
            </Card>
            <button
              onClick={runManualSearch}
              className="w-full min-h-[48px] rounded-full font-bold text-[16px]"
              style={{ backgroundColor: RED, color: "#fff" }}
            >
              입력으로 검색
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes scanline {
          0% { top: 12px; }
          50% { top: 200px; }
          100% { top: 12px; }
        }
      `}</style>
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

function ManagementScreen({ setScreen, schedule }) {
  const [takenIds, setTakenIds] = useState([]);
  const toggleTaken = (id) => setTakenIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24" style={{ backgroundColor: BG }}>
      <div className="px-5 pt-6 pb-3 bg-white">
        <p className="text-[22px] font-extrabold text-center" style={{ color: BLACK }}>복용 관리</p>
      </div>

      {schedule.length === 0 ? (
        <div className="px-4 pt-8 flex flex-col items-center gap-3">
          <span className="text-[48px]">💊</span>
          <p className="text-[15px] text-center" style={{ color: GRAY }}>등록된 약이 없습니다.<br />촬영 또는 검색으로 약을 등록해보세요.</p>
        </div>
      ) : (
        <div className="px-4 pt-4 flex flex-col gap-3">
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
                    {taken ? <><Check size={14} /> 복용완료</> : "복용 체크"}
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
        {screen === "management" && <ManagementScreen setScreen={setScreen} schedule={schedule} />}
        {screen !== "scan" && <BottomNav screen={screen} setScreen={setScreen} />}
      </div>
    </div>
  );
}
