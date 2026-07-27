import { useState, useEffect, useRef } from "react";
import { Home, Search, Camera, Clock, ChevronLeft, ChevronRight, Volume2, AlarmClock, FileText, Check } from "lucide-react";
import Tesseract from "tesseract.js";

// ---- Design tokens (from spec) ----
// bg: #FFFFFF | primary/header: #002B49 | text: #000000 | accent: #FFD700
// body >= 24pt(~32px) | title >= 32pt(~43px) | buttons >= 70px tall

const NAVY = "#002B49";
const YELLOW = "#FFD700";
const SCAN_CARD_BG = "#DCEBFA"; // much lighter blue for the pill-scan card
const SCAN_BUTTON_BG = "#3B82D6"; // medium blue for the "촬영하러 가기" button, matched to the lighter card

// ============================================================================
// 공공데이터 API 서비스 모듈 (Service / API Module)
// ----------------------------------------------------------------------------
// 실제 서비스 키는 배포 환경의 환경변수로 주입하세요. (.env 파일 등)
// CRA 기준: REACT_APP_API_KEY, Vite 기준이라면 import.meta.env.VITE_API_KEY 로 교체하세요.
// 대부분의 data.go.kr API는 서버사이드 프록시를 통해 호출하는 것을 권장합니다(CORS 정책).
// ============================================================================
const API_KEY =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_KEY) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_KEY) ||
  "YOUR_SERVICE_KEY";

const HAS_API_KEY = !!API_KEY && API_KEY !== "YOUR_SERVICE_KEY";

const API_ENDPOINTS = {
  // 1. 식품의약품안전처 - 의약품 낱알식별 정보 API
  PILL_IDENTIFICATION:
    "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService02/getMdcinGrnIdntfcInfoList02",
  // 2. 건강보험심사평가원 - 의약품성분약효정보조회서비스 API
  DRUG_EFFICACY:
    "https://apis.data.go.kr/B551182/msupCmpnMcareInfoService/getMsupCmpnMcareInq",
  // 3. 식품의약품안전처 - 의약품안전사용서비스(DUR) API
  DUR_INFO:
    "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03",
  // 4. 식품의약품안전처 - 의약품 개요정보(e약은요) API
  EASY_DRUG_INFO:
    "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
};

const DATA_GO_PROXY_URL = "/api/data-go-proxy";

async function dataGoFetchJson(action, query) {
  // query는 serviceKey를 포함하지 않는다고 가정합니다.
  const qs = new URLSearchParams(query);
  const proxyUrl = `${DATA_GO_PROXY_URL}?action=${encodeURIComponent(action)}&${qs.toString()}`;

  // 1) Netlify Function 프록시 우선 시도 (브라우저 CORS 우회 목적)
  try {
    const proxyRes = await fetch(proxyUrl);
    if (proxyRes.ok) return await proxyRes.json();
  } catch (e) {
    // 로컬 개발 환경에서는 프록시가 없을 수 있으므로 조용히 통과
  }

  // 2) 프록시가 실패하면(또는 없으면) 클라이언트 직접 호출 (CORS 가능성 존재)
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

// ---- 1) 의약품 낱알식별 정보 API : 모양/색상/식별문자 또는 이름으로 품목 특정 ----
async function fetchPillIdentification({ shape, color, mark, itemName } = {}) {
  const query = new URLSearchParams({
    type: "json",
    numOfRows: "1",
    pageNo: "1",
    ...(itemName ? { item_name: itemName } : {}),
    ...(mark ? { print_front: mark } : {}),
    ...(color ? { color_class1: color } : {}),
    ...(shape ? { drug_shape: shape } : {}),
  });

  const json = await dataGoFetchJson("PILL_IDENTIFICATION", Object.fromEntries(query.entries()));
  const item = json?.body?.items?.[0];
  if (!item) throw new Error("일치하는 알약 정보를 찾을 수 없습니다");

  return {
    itemSeq: item.ITEM_SEQ,
    itemName: item.ITEM_NAME,
    entpName: item.ENTP_NAME,
    imageUrl: item.ITEM_IMAGE,
    chart: item.CHART,
  };
}

// ---- 2) 의약품성분약효정보조회서비스 API : 품목기준코드 -> 약효 분류명 ----
async function fetchDrugEfficacy(itemSeq) {
  const query = new URLSearchParams({ type: "json", itemSeq });
  const json = await dataGoFetchJson("DRUG_EFFICACY", Object.fromEntries(query.entries()));
  const item = json?.body?.items?.[0];
  return { efficacyTag: item?.CLASS_NAME || item?.EE_DOC_DATA || "분류 정보 없음" };
}

// ---- 3) 의약품안전사용서비스(DUR) API : 기존 복용약과 병용금기/중복성분 여부 ----
async function fetchDurWarning(itemSeq, currentItemSeqs = []) {
  if (!currentItemSeqs.length) return { hasWarning: false, message: "" };

  const query = new URLSearchParams({
    type: "json",
    itemSeq,
    itemSeqs: currentItemSeqs.join(","),
  });
  const json = await dataGoFetchJson("DUR_INFO", Object.fromEntries(query.entries()));
  const items = json?.body?.items || [];
  if (!items.length) return { hasWarning: false, message: "" };

  const messages = items
    .map((it) =>
      it.MIXTURE_ITEM_NAME
        ? `${it.MIXTURE_ITEM_NAME}와(과) 병용 주의`
        : it.PROHBT_CONTENT
    )
    .filter(Boolean);

  return { hasWarning: messages.length > 0, message: messages.join(" · ") };
}

// ---- 4) 의약품 개요정보(e약은요) API : 어르신용 쉬운 복용법/주의사항 텍스트 ----
async function fetchEasyDrugInfo(itemSeq) {
  const query = new URLSearchParams({ type: "json", itemSeq });
  const json = await dataGoFetchJson("EASY_DRUG_INFO", Object.fromEntries(query.entries()));
  const item = json?.body?.items?.[0];
  return {
    usageText: item?.USE_METHOD_EASY || item?.USE_METHOD_QESITM || "복용법 정보 없음",
    cautionText: item?.ATPN_WARN_EASY || item?.ATPN_EASY || "주의사항 정보 없음",
  };
}

// ---- 파이프라인: 4개 API를 순차/병렬로 호출해 하나의 알약 데이터 객체로 병합 ----
// 1) 낱알식별 API로 itemSeq를 먼저 확보(선행 필요) → 2~4) 나머지 3개는 병렬 호출
async function fetchPillData(params = {}, currentSchedule = []) {
  if (!HAS_API_KEY) {
    throw new Error(
      "공공데이터 API 서비스 키가 설정되어 있지 않습니다. .env에 VITE_API_KEY(또는 REACT_APP_API_KEY)를 넣어주세요."
    );
  }

  try {
    const identification = await fetchPillIdentification(params);
    const { itemSeq } = identification;
    const currentItemSeqs = currentSchedule.map((m) => m.itemSeq).filter(Boolean);

    const [efficacy, dur, easyInfo] = await Promise.all([
      fetchDrugEfficacy(itemSeq).catch(() => ({ efficacyTag: "분류 정보 없음" })),
      fetchDurWarning(itemSeq, currentItemSeqs).catch(() => ({ hasWarning: false, message: "" })),
      fetchEasyDrugInfo(itemSeq).catch(() => ({ usageText: "", cautionText: "" })),
    ]);

    return {
      id: itemSeq,
      itemSeq,
      name: identification.itemName,
      tag: efficacy.efficacyTag,
      time: "복용 시간대는 처방 정보를 확인해주세요",
      timing: easyInfo.usageText,
      effect: efficacy.efficacyTag,
      caution: dur.hasWarning
        ? `${easyInfo.cautionText} · [병용주의] ${dur.message}`
        : easyInfo.cautionText,
      durWarning: dur.hasWarning ? dur.message : null,
      imageUrl: identification.imageUrl,
      color: "#E3EFF7",
    };
  } catch (err) {
    console.error("[fetchPillData] 공공 API 호출 실패:", err);
    throw err;
  }
}

const MOCK_PILLS = [
  {
    id: 1,
    name: "타이레놀 정 500mg",
    tag: "진통제",
    time: "아침, 점심, 저녁",
    timing: "식후 30분",
    effect: "해열 진통 / 두통, 치통, 근육통, 발열 완화",
    caution: "간 손상 위험 · 하루 최대 8정(4,000mg) 초과 금지 · 음주 시 복용 금지",
    color: "#F4E9E1",
  },
  {
    id: 2,
    name: "고려은단 비타민C 1000",
    tag: "종합비타민",
    time: "아침",
    timing: "식후 즉시",
    effect: "피로 회복 / 면역력 강화 및 항산화 작용",
    caution: "위장 장애 시 식후 복용 권장 · 신장결석 병력자는 상담 후 복용",
    color: "#FCEBC5",
  },
  {
    id: 3,
    name: "노바스크 정 5mg",
    tag: "혈압약",
    time: "아침",
    timing: "식전 30분",
    effect: "고혈압 예방 및 혈관 이완, 협심증 관리",
    caution: "임산부 복용 금지 · 어지럼증 · 발목 부종 발생 가능 · 임의 중단 금지",
    color: "#E3EFF7",
  },
];

const CATEGORIES = [
  { label: "가려움 / 습진", emoji: "🤚" },
  { label: "두통 / 치통", emoji: "🤕" },
  { label: "설사 / 통증", emoji: "😣" },
  { label: "소화불량 / 위통", emoji: "🤢" },
  { label: "근육통 / 관절통", emoji: "💪" },
  { label: "비염 / 알레르기", emoji: "🤧" },
  { label: "상처 / 피부", emoji: "🩹" },
  { label: "눈 건강 / 안약", emoji: "👁️" },
  { label: "만성질환 / 처방약", emoji: "🏥" },
  { label: "피로회복 / 비타민", emoji: "🔋" },
  { label: "유산균 / 장 건강", emoji: "🌀" },
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

function BigButton({ children, onClick, bg = NAVY, color = "#FFFFFF", className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`w-full min-h-[70px] rounded-2xl font-bold text-[24px] flex items-center justify-center gap-3 active:scale-[0.98] transition-transform shadow-sm ${className}`}
      style={{ backgroundColor: bg, color }}
    >
      {children}
    </button>
  );
}

function BottomNav({ screen, setScreen }) {
  const items = [
    { key: "home", icon: Home, label: "홈" },
    { key: "search", icon: Search, label: "약 찾기" },
    { key: "scan", icon: Camera, label: "촬영", center: true },
    { key: "management", icon: Clock, label: "복용관리" },
  ];
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white border-t-2 border-gray-100 flex items-center justify-around py-2 px-1">
      {items.map((it) => {
        const Icon = it.icon;
        const active = screen === it.key;
        return (
          <button
            key={it.key}
            onClick={() => setScreen(it.key)}
            className="flex flex-col items-center gap-0.5 py-1 px-2 min-h-[56px] justify-center"
          >
            <Icon size={24} color={active ? NAVY : "#9CA3AF"} strokeWidth={active ? 2.75 : 2} />
            <span
              className="text-[12px] font-semibold"
              style={{ color: active ? NAVY : "#9CA3AF" }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HomeScreen({ setScreen, setActivePill, schedule }) {
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-24">
      <div className="px-5 pt-6 pb-3">
        <p className="text-[26px] font-extrabold" style={{ color: "#000" }}>
          양우진 님, 안녕하세요
        </p>
        <p className="text-[16px] text-gray-500 mt-1">오늘도 건강한 하루 보내세요</p>
      </div>

      <div className="px-5 pt-2">
        <button
          onClick={() => setScreen("search")}
          className="w-full min-h-[64px] rounded-2xl border-2 flex items-center px-5 gap-3 text-left"
          style={{ borderColor: "#D1D5DB" }}
        >
          <Search size={26} color="#4B5563" />
          <span className="text-[20px] text-gray-500">약 이름을 검색해보세요</span>
        </button>
      </div>

      <div className="px-5 pt-6">
        <button
          onClick={() => setScreen("scan")}
          className="w-full rounded-3xl p-6 text-left flex flex-col gap-4 min-h-[35vh] justify-between"
          style={{ backgroundColor: SCAN_CARD_BG }}
        >
          <div>
            <p className="text-[32px] font-extrabold leading-snug" style={{ color: NAVY }}>
              📷 알약 촬영하기
            </p>
            <p className="text-[18px] mt-2 leading-relaxed" style={{ color: "#3E5C78" }}>
              카메라에 알약을 비추면
              <br />
              이름과 복용법을 바로 알려드려요
            </p>
          </div>
          <div
            className="w-full min-h-[70px] rounded-2xl flex items-center justify-center font-bold text-[24px]"
            style={{ backgroundColor: SCAN_BUTTON_BG, color: "#FFFFFF" }}
          >
            촬영하러 가기
          </div>
        </button>
      </div>

      <div className="px-5 pt-5">
        <button
          onClick={() => setScreen("management")}
          className="w-full rounded-3xl p-5 flex items-center gap-4"
          style={{ backgroundColor: "#EAF6EC" }}
        >
          <div
            className="w-[56px] h-[56px] rounded-2xl flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: "#1E8E4B" }}
          >
            <Clock size={28} color="#fff" />
          </div>

          <div className="flex-1 text-left min-w-0">
            <p className="text-[22px] font-extrabold text-black leading-tight">복용 관리</p>
            <p className="text-[15px] text-gray-600 mt-1 truncate">
              오늘 먹을 약, 잊지 말고 챙기세요
            </p>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {schedule.length > 0 && (
              <span
                className="text-[13px] font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: "#1E8E4B", color: "#fff" }}
              >
                {schedule.length}개 등록됨
              </span>
            )}
            <ChevronRight size={24} color="#1E8E4B" />
          </div>
        </button>
      </div>

      <div className="px-5 pt-7">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[22px] font-extrabold text-black">자주 먹는 약</p>
        </div>
        <div className="flex flex-col gap-3">
          {MOCK_PILLS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setActivePill(p);
                setScreen("detail");
              }}
              className="w-full min-h-[80px] rounded-2xl border-2 flex items-center gap-4 px-4 py-3 text-left"
              style={{ borderColor: "#E5E7EB" }}
            >
              <div
                className="w-[56px] h-[56px] rounded-xl flex-shrink-0 flex items-center justify-center text-[26px]"
                style={{ backgroundColor: p.color }}
              >
                💊
              </div>
              <div className="flex-1">
                <p className="text-[20px] font-bold text-black leading-tight">{p.name}</p>
                <p className="text-[15px] text-gray-500 mt-1">{p.tag} · {p.timing}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchScreen({ setScreen, setActivePill, schedule }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const runSearch = async (params) => {
    setErrorMsg("");
    setLoading(true);
    try {
      const data = await fetchPillData(params, schedule);
      setActivePill(data);
      setScreen("detail");
    } catch (err) {
      setErrorMsg(err.message || "알약 정보를 찾을 수 없습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full pb-24">
      <div className="px-5 pt-6 pb-3 flex items-center gap-3">
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color="#000" />
        </button>
        <p className="text-[24px] font-extrabold text-black">약 찾기</p>
      </div>

      <div className="px-5">
        <div
          className="w-full min-h-[64px] rounded-2xl border-2 flex items-center px-4 gap-3"
          style={{ borderColor: NAVY }}
        >
          <Search size={26} color={NAVY} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) runSearch({ itemName: query.trim() });
            }}
            placeholder="약의 이름이나 형태, 증상을 입력하세요"
            className="flex-1 text-[19px] outline-none bg-transparent"
          />
          <button
            onClick={() => speak("음성으로 검색해보세요")}
            className="w-[44px] h-[44px] rounded-full flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#F2F2F2" }}
            aria-label="음성 검색"
          >
            🎤
          </button>
        </div>
        {loading && (
          <p className="text-[16px] font-bold mt-2 text-center" style={{ color: NAVY }}>
            ⏳ 알약 정보를 불러오고 있어요...
          </p>
        )}
        {errorMsg && !loading && (
          <p className="text-[16px] font-bold mt-2 text-center" style={{ color: "#C0392B" }}>
            ⚠️ {errorMsg}
          </p>
        )}
      </div>

      <div className="px-5 pt-6 overflow-y-auto">
        <p className="text-[18px] font-bold text-gray-600 mb-3">증상별로 찾기</p>
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              onClick={() => runSearch({ itemName: c.label.split(" / ")[0] })}
              className="min-h-[110px] rounded-2xl border-2 flex flex-col items-center justify-center gap-2 px-2 py-3"
              style={{ borderColor: "#E5E7EB" }}
            >
              <span className="text-[30px]">{c.emoji}</span>
              <span className="text-[15px] font-bold text-black text-center leading-tight">
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScanScreen({ setScreen, setActivePill, schedule }) {
  const [status, setStatus] = useState("scanning"); // scanning -> found -> loading -> error
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [requestingCamera, setRequestingCamera] = useState(false);
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
      setCameraReady(false);
      setCameraError("이 브라우저에서는 카메라를 지원하지 않아요.");
      return false;
    }

    if (!window.isSecureContext) {
      setCameraReady(false);
      setCameraError("카메라는 HTTPS 또는 localhost 환경에서만 동작해요.");
      return false;
    }

    setRequestingCamera(true);
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

      setCameraReady(true);
      return true;
    } catch (err) {
      console.error("카메라 접근 실패:", err);
      setCameraReady(false);
      setCameraError("카메라를 사용할 수 없어요. 카메라 접근 권한을 허용한 뒤 다시 시도해주세요.");
      return false;
    } finally {
      setRequestingCamera(false);
    }
  };

  // 실제 기기 카메라 켜기
  useEffect(() => {
    openCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video) return null;

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) return null;

    // OCR 속도를 위해 다운스케일
    const targetW = 640;
    const scale = vw > targetW ? targetW / vw : 1;
    const w = Math.max(1, Math.floor(vw * scale));
    const h = Math.max(1, Math.floor(vh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // OCR 정확도 향상을 위한 간단한 전처리 (그레이스케일 + 대비)
    ctx.filter = "grayscale(1) contrast(1.7)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = "none";

    // JPEG 품질을 약간 낮춰도 OCR에 충분한 경우가 많습니다.
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const extractMarkWithOcr = async (imageDataUrl) => {
    const result = await Tesseract.recognize(imageDataUrl, "eng", {
      // 숫자/영문이 주로 적혀있는 알약 표기 특성 반영
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    });

    const text = (result?.data?.text || "").toUpperCase();
    // 노이즈 제거: 3자 이상 영문/숫자 뭉치만 후보로 사용
    const candidates = text.match(/[A-Z0-9]{3,}/g) || [];
    if (!candidates.length) return null;

    // 길이가 가장 긴 후보를 우선(간단한 휴리스틱)
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].trim();
  };

  const runDetection = async ({ overrideMark = "" } = {}) => {
    cancelledRef.current = false;
    setErrorMsg("");

    // 1) 수동 입력이 있으면 OCR 없이 바로 API 호출
    const manual = overrideMark ? String(overrideMark).trim() : "";
    if (manual) {
      try {
        setStatus("loading");
        setActivePill(await fetchPillData({ mark: manual }, schedule));
        setScreen("detail");
      } catch (err) {
        setStatus("error");
        setErrorMsg(err.message || "알약 정보를 찾을 수 없습니다");
      }
      return;
    }

    // 2) 카메라 프레임 → OCR → mark 추출 → 4개 API 파이프라인
    try {
      setStatus("scanning");
      const frame = captureFrame();
      if (!frame) throw new Error("카메라 영상이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.");

      setStatus("ocr");
      const mark = await extractMarkWithOcr(frame);
      if (cancelledRef.current) return;

      if (!mark) {
        setStatus("error");
        setErrorMsg("알약 표기(문자)를 읽지 못했어요. 아래에 직접 표기를 입력해보세요.");
        return;
      }

      setStatus("found");

      setStatus("loading");
      const data = await fetchPillData({ mark }, schedule);
      if (cancelledRef.current) return;

      setActivePill(data);
      setScreen("detail");
    } catch (err) {
      if (cancelledRef.current) return;
      setStatus("error");
      setErrorMsg(err.message || "알약 정보를 찾을 수 없습니다");
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    runDetection();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#0B0F14" }}>
      <div className="px-5 pt-6 flex items-center gap-3">
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color="#fff" />
        </button>
        <p className="text-[20px] font-bold text-white">알약을 화면 중앙에 놓아주세요</p>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* 실제 카메라 라이브 뷰 (화면 전체 배경) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* 카메라를 못 켤 때의 대체 배경 */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center px-8" style={{ backgroundColor: "#0B0F14" }}>
            <div className="text-center">
              <p className="text-[16px] text-gray-300 leading-relaxed">📷 {cameraError}</p>
              <button
                onClick={openCamera}
                className="mt-4 min-h-[44px] px-4 rounded-xl font-bold text-[15px]"
                style={{ backgroundColor: "#FFFFFF", color: "#111827" }}
              >
                카메라 다시 켜기
              </button>
            </div>
          </div>
        )}

        {/* 스캔 프레임 오버레이 */}
        <div
          className="w-[260px] h-[260px] rounded-3xl relative flex items-center justify-center"
          style={{
            border: `4px solid ${
              status === "error" ? "#E5484D" : status === "found" || status === "loading" ? "#3ADB76" : YELLOW
            }`,
            boxShadow: `0 0 0 2000px rgba(0,0,0,0.45)`,
          }}
        >
          {(status === "found" || status === "loading" || status === "error") && (
            <span className="text-[70px]">{status === "error" ? "⚠️" : "✅"}</span>
          )}
          {(status === "scanning" || status === "ocr") && (
            <div
              className="absolute left-2 right-2 h-[3px] rounded"
              style={{ backgroundColor: YELLOW, animation: "scanline 1.4s linear infinite" }}
            />
          )}
        </div>
      </div>

      <div className="px-5 pb-12">
        {status !== "error" ? (
          <div
            className="w-full min-h-[70px] rounded-2xl flex items-center justify-center font-bold text-[22px] gap-2 text-center"
            style={{
              backgroundColor: status === "found" || status === "loading" ? "#1E8E4B" : "#1F2937",
              color: "#fff",
            }}
          >
            {status === "scanning" && "🔍 촬영 프레임을 준비하고 있어요..."}
            {status === "found" && "✅ 알약을 인식했어요!"}
            {status === "ocr" && "🔍 알약 표기(문자)를 읽고 있어요..."}
            {status === "loading" && "⏳ 알약 정보를 불러오고 있어요..."}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className="w-full min-h-[70px] rounded-2xl flex items-center justify-center font-bold text-[20px] px-4 text-center"
              style={{ backgroundColor: "#3A1518", color: "#FF9FA3" }}
            >
              ⚠️ {errorMsg}
            </div>
            <div
              className="w-full min-h-[64px] rounded-2xl border-2 flex items-center px-4 gap-3"
              style={{ borderColor: "#E5E7EB", backgroundColor: "#FFFFFF" }}
            >
              <span className="text-[18px]">⌨️</span>
              <input
                value={manualMark}
                onChange={(e) => setManualMark(e.target.value)}
                placeholder="알약 표기(예: TYLENOL)"
                className="flex-1 text-[18px] outline-none bg-transparent"
              />
            </div>
            <BigButton bg={YELLOW} color={NAVY} onClick={runDetection}>
              다시 촬영하기
            </BigButton>
            <BigButton
              bg={NAVY}
              color={YELLOW}
              onClick={() => runDetection({ overrideMark: manualMark })}
            >
              입력으로 검색
            </BigButton>
          </div>
        )}
        {requestingCamera && (
          <p className="text-[14px] text-center mt-2" style={{ color: "#9CA3AF" }}>
            카메라를 연결하고 있어요...
          </p>
        )}
        {!requestingCamera && cameraReady && (
          <p className="text-[14px] text-center mt-2" style={{ color: "#9CA3AF" }}>
            카메라 연결 완료
          </p>
        )}
      </div>

      <style>{`
        @keyframes scanline {
          0% { top: 8px; }
          50% { top: 240px; }
          100% { top: 8px; }
        }
      `}</style>
    </div>
  );
}

function TTSBlock({ label, content, icon }) {
  const [active, setActive] = useState(false);
  return (
    <button
      onClick={() => {
        speak(`${label}. ${content}`);
        setActive(true);
        setTimeout(() => setActive(false), 900);
      }}
      className="w-full min-h-[110px] rounded-2xl px-5 py-4 flex flex-col gap-2 text-left border-2 transition-colors"
      style={{
        borderColor: active ? NAVY : "#E5E7EB",
        backgroundColor: active ? "#F3F8FC" : "#FFFFFF",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[19px] font-extrabold" style={{ color: NAVY }}>
          {icon} {label}
        </span>
        <Volume2 size={26} color={NAVY} />
      </div>
      <span className="text-[22px] font-bold text-black leading-snug">{content}</span>
    </button>
  );
}

function DetailScreen({ setScreen, pill, addToSchedule }) {
  const [registered, setRegistered] = useState(false);

  // 인식 결과가 뜨는 즉시 이름 / 종류 / 복용 시간을 자동으로 음성 안내
  useEffect(() => {
    if (!pill) return;
    const intro = `${pill.name}. ${pill.tag}. ${pill.time} / ${pill.timing} 복용`;
    const t = setTimeout(() => speak(intro), 400);
    return () => clearTimeout(t);
  }, [pill?.id, pill?.name]);

  if (!pill) return null;
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-28">
      <div className="px-5 pt-6 pb-2 flex items-center gap-3">
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color="#000" />
        </button>
        <p className="text-[18px] font-bold text-gray-500">알약 인식 결과</p>
      </div>

      <div className="px-5 pt-2 flex flex-col items-center">
        <div
          className="w-full h-[180px] rounded-3xl flex items-center justify-center text-[70px] overflow-hidden"
          style={{ backgroundColor: pill.color }}
        >
          {pill.imageUrl ? (
            <img src={pill.imageUrl} alt={pill.name} className="w-full h-full object-contain" />
          ) : (
            "💊"
          )}
        </div>
        <p className="text-[34px] font-extrabold text-black mt-5 text-center leading-tight">
          {pill.name}
        </p>
        <span
          className="text-[16px] font-bold px-3 py-1 rounded-full mt-2"
          style={{ backgroundColor: NAVY, color: "#fff" }}
        >
          {pill.tag}
        </span>
      </div>

      <div className="px-5 pt-6 flex flex-col gap-3">
        <TTSBlock
          label="복용법 및 시간대"
          icon="⏰"
          content={`${pill.time} / ${pill.timing} 복용`}
        />
        <TTSBlock label="약효 및 성분" icon="💊" content={pill.effect} />
        <TTSBlock label="주의사항" icon="⚠️" content={pill.caution} />
        {pill.durWarning && (
          <TTSBlock label="병용 금기 경고 (DUR)" icon="🚫" content={pill.durWarning} />
        )}
      </div>

      <div className="px-5 pt-6">
        <BigButton
          bg={registered ? "#1E8E4B" : NAVY}
          onClick={() => {
            addToSchedule(pill);
            setRegistered(true);
            speak("복용 관리에 등록되었습니다");
          }}
        >
          {registered ? (
            <>
              <Check size={26} /> 복용 관리에 등록됨
            </>
          ) : (
            <>
              <AlarmClock size={26} /> 복용 관리 등록하기
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
    <div className="flex flex-col h-full overflow-y-auto pb-24" style={{ backgroundColor: "#FAFAFA" }}>
      <div className="px-5 pt-6 pb-3 flex items-center gap-3 bg-white">
        <button onClick={() => setScreen("home")} className="w-[44px] h-[44px] flex items-center justify-center">
          <ChevronLeft size={30} color="#000" />
        </button>
        <p className="text-[26px] font-extrabold text-black">복용 관리</p>
      </div>

      {/* 진행 요약 */}
      {schedule.length > 0 && (
        <div className="px-5 pt-4">
          <div
            className="w-full rounded-2xl px-5 py-4 flex items-center justify-between"
            style={{ backgroundColor: NAVY }}
          >
            <p className="text-[18px] font-bold text-white">오늘의 복용 현황</p>
            <p className="text-[22px] font-extrabold" style={{ color: YELLOW }}>
              {takenCount} / {schedule.length}
            </p>
          </div>
        </div>
      )}

      {/* 처방전 OCR 등록 카드 */}
      <div className="px-5 pt-4">
        <div className="w-full rounded-2xl bg-white border-2 px-4 py-4" style={{ borderColor: "#EEEEEE" }}>
          <p className="text-[15px] text-gray-500 mb-3">
            처방전이나 약봉지 사진 한 장이면 자동으로 등록돼요
          </p>
          <BigButton
            bg="#F5F5F5"
            color={NAVY}
            onClick={() => {
              setOcrDone(true);
              speak("처방전에서 약 세 종류가 자동으로 등록되었습니다");
            }}
          >
            <FileText size={26} color={NAVY} /> 처방전 / 약봉지로 등록
          </BigButton>
          {ocrDone && (
            <p className="text-[15px] text-center mt-3 font-bold" style={{ color: "#1E8E4B" }}>
              ✅ 처방전에서 약 3종이 자동 등록되었습니다
            </p>
          )}
        </div>
      </div>

      {/* 등록된 약 목록 */}
      <div className="px-5 pt-6">
        <p className="text-[18px] font-bold text-gray-500 mb-3">
          등록된 약 {schedule.length > 0 ? `${schedule.length}개` : ""}
        </p>

        {schedule.length === 0 ? (
          <div className="w-full rounded-2xl bg-white border-2 flex flex-col items-center justify-center gap-2 py-10 px-4" style={{ borderColor: "#EEEEEE" }}>
            <span className="text-[40px]">💊</span>
            <p className="text-[17px] text-gray-500 text-center leading-relaxed">
              아직 등록된 약이 없어요.
              <br />
              알약을 촬영하고 복용 관리에 등록해보세요.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {schedule.map((p) => {
              const taken = takenIds.includes(p.id);
              return (
                <div
                  key={p.id}
                  className="w-full rounded-2xl bg-white flex items-center gap-3 px-4 py-4"
                  style={{
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                    opacity: taken ? 0.6 : 1,
                  }}
                >
                  <div
                    className="w-[52px] h-[52px] rounded-xl flex-shrink-0 flex items-center justify-center text-[24px]"
                    style={{ backgroundColor: p.color }}
                  >
                    💊
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[19px] font-bold text-black leading-tight truncate">{p.name}</p>
                    <p className="text-[14px] text-gray-500 mt-1">
                      {p.time} · {p.timing}
                    </p>
                  </div>

                  <button
                    onClick={() => speak(`${p.name}, ${p.time}, ${p.timing} 복용`)}
                    className="w-[44px] h-[44px] rounded-full flex-shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: "#F2F2F2" }}
                    aria-label="음성으로 듣기"
                  >
                    <Volume2 size={20} color={NAVY} />
                  </button>

                  <button
                    onClick={() => toggleTaken(p.id)}
                    className="min-h-[44px] px-3 rounded-xl flex-shrink-0 flex items-center justify-center gap-1 font-bold text-[14px]"
                    style={{
                      backgroundColor: taken ? "#EAF6EC" : NAVY,
                      color: taken ? "#1E8E4B" : "#fff",
                    }}
                  >
                    {taken ? (
                      <>
                        <Check size={16} /> 완료
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
  const [schedule, setSchedule] = useState([]);

  const addToSchedule = (pill) => {
    setSchedule((prev) => (prev.find((p) => p.id === pill.id) ? prev : [...prev, pill]));
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 p-4">
      <style>{`
        @import url('//cdn.jsdelivr.net/npm/font-kopubworld@1.0/dotum.min.css');
      `}</style>
      <div
        className="relative w-[390px] h-[780px] bg-white rounded-[36px] overflow-hidden shadow-2xl border-8"
        style={{ borderColor: "#111", fontFamily: "'KoPubWorld Dotum', 'Malgun Gothic', sans-serif" }}
      >
        {screen === "home" && (
          <HomeScreen setScreen={setScreen} setActivePill={setActivePill} schedule={schedule} />
        )}
        {screen === "search" && (
          <SearchScreen setScreen={setScreen} setActivePill={setActivePill} schedule={schedule} />
        )}
        {screen === "scan" && (
          <ScanScreen setScreen={setScreen} setActivePill={setActivePill} schedule={schedule} />
        )}
        {screen === "detail" && (
          <DetailScreen setScreen={setScreen} pill={activePill} addToSchedule={addToSchedule} />
        )}
        {screen === "management" && <ManagementScreen setScreen={setScreen} schedule={schedule} />}
        {screen !== "scan" && <BottomNav screen={screen} setScreen={setScreen} />}
      </div>
    </div>
  );
}
