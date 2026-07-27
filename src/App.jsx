import { useState, useEffect, useRef } from "react";
import { Home, Search, Camera, Clock, ChevronLeft, ChevronRight, Volume2, AlarmClock, FileText, Check } from "lucide-react";
import Tesseract from "tesseract.js";

// ---- Design tokens ----
const BLUE = "#1E5AA8";
const BLUE_DARK = "#164A8C";
const WHITE = "#FFFFFF";
const BLACK = "#111111";
const GRAY = "#6B7280";
const BORDER = "#D6E3F3";

const API_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_KEY) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_KEY) ||
  "YOUR_SERVICE_KEY";

const HAS_API_KEY = !!API_KEY && API_KEY !== "YOUR_SERVICE_KEY";

const API_ENDPOINTS = {
  PILL_IDENTIFICATION:
    "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03",
  DRUG_EFFICACY:
    "https://apis.data.go.kr/B551182/msupCmpnMcareInfoService/getMsupCmpnMcareInq",
  DUR_INFO:
    "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03",
  EASY_DRUG_INFO:
    "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
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
  } catch {
    // local fallback
  }

  if (!HAS_API_KEY) {
    throw new Error(
      "공공데이터 API 서비스 키가 설정되어 있지 않습니다. .env에 VITE_API_KEY(또는 REACT_APP_API_KEY)를 넣어주세요."
    );
  }

  const baseUrl = API_ENDPOINTS[action];
  if (!baseUrl) throw new Error(`Unknown API action: ${action}`);

  const directQuery = new URLSearchParams({ ...query, serviceKey: API_KEY });
  const res = await fetch(`${baseUrl}?${directQuery.toString()}`);
  if (!res.ok) throw new Error("공공 API 호출 실패");
  return await res.json();
}

// ---- 이름 검색: e약은요 + 낱알식별 목록 병합 ----
async function searchPillList(itemName) {
  const q = String(itemName || "").trim();
  if (!q) return [];

  const map = new Map();

  try {
    const easy = await dataGoFetchJson("EASY_DRUG_INFO", {
      type: "json",
      numOfRows: "30",
      pageNo: "1",
      itemName: q,
    });
    for (const it of normalizeItems(easy?.body?.items)) {
      const id = String(it.itemSeq || it.ITEM_SEQ || "");
      if (!id) continue;
      map.set(id, {
        id,
        itemSeq: id,
        name: it.itemName || it.ITEM_NAME || "이름 없음",
        entpName: it.entpName || it.ENTP_NAME || "",
        tag: "의약품",
        effect: it.efcyQesitm || "",
        timing: it.useMethodQesitm || "",
        caution: it.atpnWarnQesitm || it.atpnQesitm || "",
        imageUrl: it.itemImage || it.ITEM_IMAGE || "",
      });
    }
  } catch (err) {
    console.warn("[searchPillList] e약은요 검색 실패:", err);
  }

  try {
    const idnt = await dataGoFetchJson("PILL_IDENTIFICATION", {
      type: "json",
      numOfRows: "30",
      pageNo: "1",
      item_name: q,
    });
    for (const it of normalizeItems(idnt?.body?.items)) {
      const id = String(it.ITEM_SEQ || it.itemSeq || "");
      if (!id) continue;
      const prev = map.get(id) || {};
      map.set(id, {
        ...prev,
        id,
        itemSeq: id,
        name: it.ITEM_NAME || it.itemName || prev.name || "이름 없음",
        entpName: it.ENTP_NAME || it.entpName || prev.entpName || "",
        tag: it.CLASS_NAME || prev.tag || "의약품",
        chart: it.CHART || "",
        imageUrl: it.ITEM_IMAGE || it.itemImage || prev.imageUrl || "",
        mark: it.PRINT_FRONT || "",
        shape: it.DRUG_SHAPE || "",
        color: it.COLOR_CLASS1 || "",
      });
    }
  } catch (err) {
    console.warn("[searchPillList] 낱알식별 검색 실패:", err);
  }

  return Array.from(map.values());
}

async function fetchPillIdentification({ shape, color, mark, itemName, itemSeq } = {}) {
  const query = {
    type: "json",
    numOfRows: "10",
    pageNo: "1",
    ...(itemSeq ? { item_seq: itemSeq } : {}),
    ...(itemName ? { item_name: itemName } : {}),
    ...(mark ? { print_front: mark } : {}),
    ...(color ? { color_class1: color } : {}),
    ...(shape ? { drug_shape: shape } : {}),
  };

  const json = await dataGoFetchJson("PILL_IDENTIFICATION", query);
  const items = normalizeItems(json?.body?.items);
  if (!items.length) throw new Error("일치하는 알약 정보를 찾을 수 없습니다");

  // print_front 검색이 넓게 나올 수 있어 mark가 있으면 우선 필터
  let item = items[0];
  if (mark) {
    const upper = String(mark).toUpperCase();
    const matched = items.find((it) =>
      String(it.PRINT_FRONT || "")
        .toUpperCase()
        .includes(upper)
    );
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

async function fetchDrugEfficacy(itemSeq) {
  try {
    const json = await dataGoFetchJson("DRUG_EFFICACY", { type: "json", itemSeq });
    const item = normalizeItems(json?.body?.items)?.[0];
    return { efficacyTag: item?.CLASS_NAME || item?.EE_DOC_DATA || "분류 정보 없음" };
  } catch {
    return { efficacyTag: "분류 정보 없음" };
  }
}

async function fetchDurWarning(itemSeq, currentItemSeqs = []) {
  if (!currentItemSeqs.length) return { hasWarning: false, message: "" };
  try {
    const json = await dataGoFetchJson("DUR_INFO", {
      type: "json",
      itemSeq,
      itemSeqs: currentItemSeqs.join(","),
    });
    const items = normalizeItems(json?.body?.items);
    if (!items.length) return { hasWarning: false, message: "" };
    const messages = items
      .map((it) =>
        it.MIXTURE_ITEM_NAME ? `${it.MIXTURE_ITEM_NAME}와(과) 병용 주의` : it.PROHBT_CONTENT
      )
      .filter(Boolean);
    return { hasWarning: messages.length > 0, message: messages.join(" · ") };
  } catch {
    return { hasWarning: false, message: "" };
  }
}

async function fetchEasyDrugInfo(itemSeq, itemName) {
  try {
    const query = {
      type: "json",
      numOfRows: "1",
      pageNo: "1",
      ...(itemSeq ? { itemSeq } : {}),
      ...(itemName ? { itemName } : {}),
    };
    const json = await dataGoFetchJson("EASY_DRUG_INFO", query);
    const item = normalizeItems(json?.body?.items)?.[0];
    return {
      usageText: item?.useMethodQesitm || item?.USE_METHOD_EASY || "복용법 정보 없음",
      cautionText: item?.atpnWarnQesitm || item?.atpnQesitm || item?.ATPN_EASY || "주의사항 정보 없음",
      effectText: item?.efcyQesitm || "",
      name: item?.itemName || "",
      imageUrl: item?.itemImage || "",
    };
  } catch {
    return { usageText: "복용법 정보 없음", cautionText: "주의사항 정보 없음", effectText: "" };
  }
}

async function fetchPillData(params = {}, currentSchedule = []) {
  const identification = await fetchPillIdentification(params);
  const { itemSeq } = identification;
  const currentItemSeqs = currentSchedule.map((m) => m.itemSeq).filter(Boolean);

  const [efficacy, dur, easyInfo] = await Promise.all([
    fetchDrugEfficacy(itemSeq),
    fetchDurWarning(itemSeq, currentItemSeqs),
    fetchEasyDrugInfo(itemSeq, identification.itemName),
  ]);

  return {
    id: itemSeq,
    itemSeq,
    name: identification.itemName || easyInfo.name,
    tag: efficacy.efficacyTag !== "분류 정보 없음" ? efficacy.efficacyTag : identification.tag,
    time: "처방 정보 확인",
    timing: easyInfo.usageText,
    effect: easyInfo.effectText || efficacy.efficacyTag,
    caution: dur.hasWarning
      ? `${easyInfo.cautionText} · [병용주의] ${dur.message}`
      : easyInfo.cautionText,
    durWarning: dur.hasWarning ? dur.message : null,
    imageUrl: identification.imageUrl || easyInfo.imageUrl,
  };
}

async function fetchPillDetailBySeq(itemSeq, nameHint = "", currentSchedule = []) {
  const currentItemSeqs = currentSchedule.map((m) => m.itemSeq).filter(Boolean);
  const [efficacy, dur, easyInfo, idnt] = await Promise.all([
    fetchDrugEfficacy(itemSeq),
    fetchDurWarning(itemSeq, currentItemSeqs),
    fetchEasyDrugInfo(itemSeq, nameHint),
    fetchPillIdentification({ itemSeq, itemName: nameHint }).catch(() => null),
  ]);

  return {
    id: itemSeq,
    itemSeq,
    name: idnt?.itemName || easyInfo.name || nameHint || "알약",
    tag: efficacy.efficacyTag !== "분류 정보 없음" ? efficacy.efficacyTag : idnt?.tag || "의약품",
    time: "처방 정보 확인",
    timing: easyInfo.usageText,
    effect: easyInfo.effectText || efficacy.efficacyTag,
    caution: dur.hasWarning
      ? `${easyInfo.cautionText} · [병용주의] ${dur.message}`
      : easyInfo.cautionText,
    durWarning: dur.hasWarning ? dur.message : null,
    imageUrl: idnt?.imageUrl || easyInfo.imageUrl,
  };
}

const CATEGORIES = [
  "두통",
  "치통",
  "감기",
  "소화불량",
  "근육통",
  "알레르기",
  "비타민",
  "고혈압",
];

function speak(text) {
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ko-KR";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.error("TTS error", e);
  }
}

function BigButton({ children, onClick, className = "", outline = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full min-h-[64px] font-bold text-[20px] flex items-center justify-center gap-2 active:opacity-90 ${className}`}
      style={{
        backgroundColor: outline ? WHITE : BLUE,
        color: outline ? BLUE : WHITE,
        border: `2px solid ${BLUE}`,
      }}
    >
      {children}
    </button>
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
    <div className="absolute bottom-0 left-0 right-0 bg-white border-t flex items-center justify-around py-2" style={{ borderColor: BORDER }}>
      {items.map((it) => {
        const Icon = it.icon;
        const active = screen === it.key;
        return (
          <button
            key={it.key}
            onClick={() => setScreen(it.key)}
            className="flex flex-col items-center gap-0.5 py-1 px-2 min-h-[56px] justify-center"
          >
            <Icon size={24} color={active ? BLUE : GRAY} strokeWidth={active ? 2.75 : 2} />
            <span className="text-[12px] font-semibold" style={{ color: active ? BLUE : GRAY }}>
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HomeScreen({ setScreen, schedule }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24 bg-white">
      <div className="px-5 pt-6 pb-4" style={{ backgroundColor: BLUE }}>
        <p className="text-[24px] font-extrabold text-white">양우진 님</p>
        <p className="text-[15px] mt-1" style={{ color: "#D6E8FF" }}>
          오늘도 건강한 하루 보내세요
        </p>
      </div>

      <div className="px-5 pt-5">
        <button
          onClick={() => setScreen("search")}
          className="w-full min-h-[60px] border-2 flex items-center px-4 gap-3 text-left bg-white"
          style={{ borderColor: BLUE }}
        >
          <Search size={24} color={BLUE} />
          <span className="text-[18px]" style={{ color: GRAY }}>
            약 이름을 검색해보세요
          </span>
        </button>
      </div>

      <div className="px-5 pt-5">
        <button
          onClick={() => setScreen("scan")}
          className="w-full p-5 text-left"
          style={{ backgroundColor: BLUE }}
        >
          <p className="text-[26px] font-extrabold text-white leading-snug">알약 촬영하기</p>
          <p className="text-[16px] mt-2 leading-relaxed" style={{ color: "#D6E8FF" }}>
            카메라에 알약을 비추면 이름과 복용법을 알려드립니다
          </p>
          <div
            className="mt-4 w-full min-h-[56px] flex items-center justify-center font-bold text-[20px]"
            style={{ backgroundColor: WHITE, color: BLUE }}
          >
            촬영하러 가기
          </div>
        </button>
      </div>

      <div className="px-5 pt-4">
        <button
          onClick={() => setScreen("management")}
          className="w-full p-4 flex items-center gap-3 border-2 bg-white"
          style={{ borderColor: BLUE }}
        >
          <div
            className="w-[48px] h-[48px] flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: BLUE }}
          >
            <Clock size={24} color={WHITE} />
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-[20px] font-extrabold text-black">복용 관리</p>
            <p className="text-[14px] mt-0.5" style={{ color: GRAY }}>
              {schedule.length > 0 ? `${schedule.length}개 등록됨` : "등록된 약이 없습니다"}
            </p>
          </div>
          <ChevronRight size={22} color={BLUE} />
        </button>
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
      if (!list.length) {
        setErrorMsg("검색 결과가 없습니다. 다른 이름으로 다시 검색해보세요.");
      } else {
        setResults(list);
      }
    } catch (err) {
      setErrorMsg(err.message || "검색에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (item) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const detail = await fetchPillDetailBySeq(item.itemSeq, item.name, schedule);
      setDetailSource("search");
      setActivePill(detail);
      setScreen("detail");
    } catch (err) {
      // 상세 API 일부가 실패해도 목록 데이터로 상세 표시
      setDetailSource("search");
      setActivePill({
        id: item.itemSeq,
        itemSeq: item.itemSeq,
        name: item.name,
        tag: item.tag || "의약품",
        time: "처방 정보 확인",
        timing: item.timing || "복용법 정보 없음",
        effect: item.effect || item.tag || "정보 없음",
        caution: item.caution || "주의사항 정보 없음",
        durWarning: null,
        imageUrl: item.imageUrl || "",
      });
      setScreen("detail");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full pb-24 bg-white">
      <div className="px-5 pt-6 pb-3 flex items-center gap-3" style={{ backgroundColor: BLUE }}>
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color={WHITE} />
        </button>
        <p className="text-[22px] font-extrabold text-white">약 찾기</p>
      </div>

      <div className="px-5 pt-4">
        <div className="w-full min-h-[60px] border-2 flex items-center px-3 gap-2 bg-white" style={{ borderColor: BLUE }}>
          <Search size={22} color={BLUE} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) runSearch(query);
            }}
            placeholder="약 이름을 입력하세요"
            className="flex-1 text-[18px] outline-none bg-transparent text-black"
          />
          <button
            onClick={() => runSearch(query)}
            className="min-h-[44px] px-3 font-bold text-[16px]"
            style={{ backgroundColor: BLUE, color: WHITE }}
          >
            검색
          </button>
        </div>

        {loading && (
          <p className="text-[15px] font-bold mt-3 text-center" style={{ color: BLUE }}>
            검색 중...
          </p>
        )}
        {errorMsg && !loading && (
          <p className="text-[15px] font-bold mt-3 text-center text-black">{errorMsg}</p>
        )}
      </div>

      {!results.length && !loading && (
        <div className="px-5 pt-5 overflow-y-auto">
          <p className="text-[16px] font-bold text-black mb-3">증상 / 키워드</p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setQuery(c);
                  runSearch(c);
                }}
                className="min-h-[56px] border-2 flex items-center justify-center px-2 py-2 bg-white"
                style={{ borderColor: BLUE }}
              >
                <span className="text-[16px] font-bold text-black">{c}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="px-5 pt-4 overflow-y-auto flex-1">
          <p className="text-[15px] font-bold mb-2" style={{ color: GRAY }}>
            검색 결과 {results.length}건
          </p>
          <div className="flex flex-col gap-2 pb-4">
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => openDetail(p)}
                className="w-full min-h-[72px] border-2 flex items-center gap-3 px-3 py-2 text-left bg-white"
                style={{ borderColor: BLUE }}
              >
                <div
                  className="w-[52px] h-[52px] flex-shrink-0 flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: BLUE }}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain bg-white" />
                  ) : (
                    <span className="text-white text-[12px] font-bold">약</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[17px] font-bold text-black leading-tight">{p.name}</p>
                  <p className="text-[13px] mt-1 truncate" style={{ color: GRAY }}>
                    {[p.entpName, p.tag].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <ChevronRight size={20} color={BLUE} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScanScreen({ setScreen, setActivePill, setDetailSource, schedule }) {
  const [status, setStatus] = useState("idle"); // idle | scanning | ocr | loading | error
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [manualMark, setManualMark] = useState("");
  const cancelledRef = useRef(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = () => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const openCamera = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("이 브라우저에서는 카메라를 지원하지 않습니다.");
      return false;
    }
    if (!window.isSecureContext) {
      setCameraError("카메라는 HTTPS 또는 localhost에서만 동작합니다.");
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
        } catch (playErr) {
          console.warn("카메라 자동재생 실패:", playErr);
        }
      }
      return true;
    } catch (err) {
      console.error("카메라 접근 실패:", err);
      setCameraError("카메라 권한을 허용한 뒤 다시 시도해주세요.");
      return false;
    }
  };

  useEffect(() => {
    openCamera();
    return () => stopCamera();
  }, []);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return null;

    const targetW = 640;
    const scale = vw > targetW ? targetW / vw : 1;
    const w = Math.max(1, Math.floor(vw * scale));
    const h = Math.max(1, Math.floor(vh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.filter = "grayscale(1) contrast(1.7)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = "none";
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

  const runDetection = async ({ overrideMark = "" } = {}) => {
    cancelledRef.current = false;
    setErrorMsg("");

    const manual = String(overrideMark || "").trim();
    if (manual) {
      try {
        setStatus("loading");
        const data = await fetchPillData({ mark: manual, itemName: manual }, schedule);
        if (cancelledRef.current) return;
        setDetailSource("scan");
        setActivePill(data);
        setScreen("detail");
      } catch (err) {
        setStatus("error");
        setErrorMsg(err.message || "알약 정보를 찾을 수 없습니다");
      }
      return;
    }

    try {
      setStatus("scanning");
      const frame = captureFrame();
      if (!frame) throw new Error("카메라가 아직 준비되지 않았습니다.");

      setStatus("ocr");
      const mark = await extractMarkWithOcr(frame);
      if (cancelledRef.current) return;
      if (!mark) {
        setStatus("error");
        setErrorMsg("표기를 읽지 못했습니다. 아래에 직접 입력해주세요.");
        return;
      }

      setStatus("loading");
      const data = await fetchPillData({ mark, itemName: mark }, schedule);
      if (cancelledRef.current) return;
      setDetailSource("scan");
      setActivePill(data);
      setScreen("detail");
    } catch (err) {
      if (cancelledRef.current) return;
      setStatus("error");
      setErrorMsg(err.message || "알약 정보를 찾을 수 없습니다");
    }
  };

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const statusText = {
    idle: "알약을 가운데에 맞춘 뒤 촬영하세요",
    scanning: "촬영 중...",
    ocr: "표기 인식 중...",
    loading: "약 정보 조회 중...",
    error: errorMsg,
  }[status];

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-5 pt-6 pb-3 flex items-center gap-3" style={{ backgroundColor: BLUE }}>
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color={WHITE} />
        </button>
        <p className="text-[20px] font-bold text-white">알약 촬영</p>
      </div>

      <div className="flex-1 relative overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 bg-white">
            <p className="text-[16px] text-black text-center leading-relaxed">{cameraError}</p>
            <button
              onClick={openCamera}
              className="min-h-[48px] px-5 font-bold text-[16px]"
              style={{ backgroundColor: BLUE, color: WHITE }}
            >
              카메라 다시 켜기
            </button>
          </div>
        ) : (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] h-[240px]"
            style={{ border: `3px solid ${BLUE}`, boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
          />
        )}
      </div>

      <div className="px-5 py-4 bg-white border-t" style={{ borderColor: BORDER }}>
        <p className="text-[15px] text-center font-bold text-black mb-3">{statusText}</p>

        {status === "error" && (
          <div className="mb-3">
            <input
              value={manualMark}
              onChange={(e) => setManualMark(e.target.value)}
              placeholder="알약 표기 직접 입력"
              className="w-full min-h-[52px] border-2 px-3 text-[17px] outline-none mb-2 text-black"
              style={{ borderColor: BLUE }}
            />
            <BigButton onClick={() => runDetection({ overrideMark: manualMark })}>
              입력으로 검색
            </BigButton>
          </div>
        )}

        <BigButton
          onClick={() => runDetection()}
          className={status === "ocr" || status === "loading" || status === "scanning" ? "opacity-60 pointer-events-none" : ""}
        >
          {status === "idle" || status === "error" ? "촬영하기" : "처리 중..."}
        </BigButton>
      </div>
    </div>
  );
}

function InfoBlock({ label, content }) {
  return (
    <div className="w-full border-2 px-4 py-4 text-left bg-white" style={{ borderColor: BLUE }}>
      <p className="text-[15px] font-bold mb-1" style={{ color: BLUE }}>
        {label}
      </p>
      <p className="text-[18px] font-bold text-black leading-snug whitespace-pre-wrap">{content}</p>
    </div>
  );
}

function DetailScreen({ setScreen, pill, addToSchedule, detailSource }) {
  const [registered, setRegistered] = useState(false);

  // 스캔으로 들어온 경우에만 자동 TTS
  useEffect(() => {
    if (!pill || detailSource !== "scan") return;
    const intro = `${pill.name}. ${pill.tag}. ${pill.timing}`;
    const t = setTimeout(() => speak(intro), 400);
    return () => clearTimeout(t);
  }, [pill?.id, pill?.name, detailSource]);

  if (!pill) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28 bg-white">
      <div className="px-5 pt-6 pb-3 flex items-center gap-3" style={{ backgroundColor: BLUE }}>
        <button
          onClick={() => setScreen(detailSource === "search" ? "search" : "home")}
          className="w-[44px] h-[44px] flex items-center justify-center"
        >
          <ChevronLeft size={30} color={WHITE} />
        </button>
        <p className="text-[18px] font-bold text-white">
          {detailSource === "scan" ? "촬영 결과" : "검색 결과"}
        </p>
        {detailSource === "scan" && (
          <button
            onClick={() => speak(`${pill.name}. ${pill.tag}. ${pill.timing}`)}
            className="ml-auto w-[44px] h-[44px] flex items-center justify-center"
            aria-label="음성으로 듣기"
          >
            <Volume2 size={24} color={WHITE} />
          </button>
        )}
      </div>

      <div className="px-5 pt-4 flex flex-col items-center">
        <div
          className="w-full h-[160px] flex items-center justify-center overflow-hidden border-2"
          style={{ borderColor: BLUE, backgroundColor: WHITE }}
        >
          {pill.imageUrl ? (
            <img src={pill.imageUrl} alt={pill.name} className="w-full h-full object-contain" />
          ) : (
            <span className="text-[18px] font-bold" style={{ color: BLUE }}>
              이미지 없음
            </span>
          )}
        </div>
        <p className="text-[28px] font-extrabold text-black mt-4 text-center leading-tight">{pill.name}</p>
        <span
          className="text-[14px] font-bold px-3 py-1 mt-2"
          style={{ backgroundColor: BLUE, color: WHITE }}
        >
          {pill.tag}
        </span>
      </div>

      <div className="px-5 pt-5 flex flex-col gap-3">
        <InfoBlock label="복용법" content={pill.timing || "정보 없음"} />
        <InfoBlock label="약효" content={pill.effect || "정보 없음"} />
        <InfoBlock label="주의사항" content={pill.caution || "정보 없음"} />
        {pill.durWarning && <InfoBlock label="병용 주의" content={pill.durWarning} />}
      </div>

      <div className="px-5 pt-5">
        <BigButton
          onClick={() => {
            addToSchedule(pill);
            setRegistered(true);
            if (detailSource === "scan") speak("복용 관리에 등록되었습니다");
          }}
        >
          {registered ? (
            <>
              <Check size={22} /> 복용 관리에 등록됨
            </>
          ) : (
            <>
              <AlarmClock size={22} /> 복용 관리 등록
            </>
          )}
        </BigButton>
      </div>
    </div>
  );
}

function ManagementScreen({ setScreen, schedule }) {
  const [ocrDone, setOcrDone] = useState(false);
  const [takenIds, setTakenIds] = useState([]);

  const toggleTaken = (id) => {
    setTakenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const takenCount = schedule.filter((p) => takenIds.includes(p.id)).length;

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24 bg-white">
      <div className="px-5 pt-6 pb-3 flex items-center gap-3" style={{ backgroundColor: BLUE }}>
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color={WHITE} />
        </button>
        <p className="text-[22px] font-extrabold text-white">복용 관리</p>
      </div>

      {schedule.length > 0 && (
        <div className="px-5 pt-4">
          <div className="w-full px-5 py-4 flex items-center justify-between" style={{ backgroundColor: BLUE }}>
            <p className="text-[16px] font-bold text-white">오늘의 복용 현황</p>
            <p className="text-[20px] font-extrabold text-white">
              {takenCount} / {schedule.length}
            </p>
          </div>
        </div>
      )}

      <div className="px-5 pt-4">
        <div className="w-full border-2 px-4 py-4 bg-white" style={{ borderColor: BLUE }}>
          <p className="text-[14px] mb-3" style={{ color: GRAY }}>
            처방전이나 약봉지 사진으로 등록할 수 있습니다
          </p>
          <BigButton
            outline
            onClick={() => setOcrDone(true)}
          >
            <FileText size={22} color={BLUE} /> 처방전 / 약봉지로 등록
          </BigButton>
          {ocrDone && (
            <p className="text-[14px] text-center mt-3 font-bold text-black">
              처방전에서 약 3종이 자동 등록되었습니다
            </p>
          )}
        </div>
      </div>

      <div className="px-5 pt-5">
        <p className="text-[16px] font-bold text-black mb-3">
          등록된 약 {schedule.length > 0 ? `${schedule.length}개` : ""}
        </p>

        {schedule.length === 0 ? (
          <div
            className="w-full border-2 flex flex-col items-center justify-center gap-2 py-10 px-4 bg-white"
            style={{ borderColor: BLUE }}
          >
            <p className="text-[16px] text-black text-center leading-relaxed">
              아직 등록된 약이 없습니다.
              <br />
              알약을 촬영하거나 검색 후 등록해보세요.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {schedule.map((p) => {
              const taken = takenIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  className="w-full border-2 flex items-center gap-3 px-3 py-3 bg-white"
                  style={{ borderColor: BLUE, opacity: taken ? 0.55 : 1 }}
                >
                  <div
                    className="w-[48px] h-[48px] flex-shrink-0 flex items-center justify-center overflow-hidden"
                    style={{ backgroundColor: BLUE }}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-contain bg-white" />
                    ) : (
                      <span className="text-white text-[12px] font-bold">약</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[17px] font-bold text-black leading-tight truncate">{p.name}</p>
                    <p className="text-[13px] mt-1 truncate" style={{ color: GRAY }}>
                      {p.timing}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleTaken(p.id)}
                    className="min-h-[40px] px-3 flex-shrink-0 font-bold text-[14px]"
                    style={{
                      backgroundColor: taken ? WHITE : BLUE,
                      color: taken ? BLUE : WHITE,
                      border: `2px solid ${BLUE}`,
                    }}
                  >
                    {taken ? (
                      <>
                        <Check size={14} className="inline" /> 완료
                      </>
                    ) : (
                      "체크"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [activePill, setActivePill] = useState(null);
  const [detailSource, setDetailSource] = useState("search"); // search | scan
  const [schedule, setSchedule] = useState([]);

  const addToSchedule = (pill) => {
    setSchedule((prev) => (prev.find((p) => p.id === pill.id) ? prev : [...prev, pill]));
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-200 p-4">
      <div
        className="relative w-[390px] h-[780px] bg-white overflow-hidden shadow-xl border-8"
        style={{ borderColor: "#111", fontFamily: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" }}
      >
        {screen === "home" && <HomeScreen setScreen={setScreen} schedule={schedule} />}
        {screen === "search" && (
          <SearchScreen
            setScreen={setScreen}
            setActivePill={setActivePill}
            setDetailSource={setDetailSource}
            schedule={schedule}
          />
        )}
        {screen === "scan" && (
          <ScanScreen
            setScreen={setScreen}
            setActivePill={setActivePill}
            setDetailSource={setDetailSource}
            schedule={schedule}
          />
        )}
        {screen === "detail" && (
          <DetailScreen
            setScreen={setScreen}
            pill={activePill}
            addToSchedule={addToSchedule}
            detailSource={detailSource}
          />
        )}
        {screen === "management" && <ManagementScreen setScreen={setScreen} schedule={schedule} />}
        {screen !== "scan" && <BottomNav screen={screen} setScreen={setScreen} />}
      </div>
    </div>
  );
}
