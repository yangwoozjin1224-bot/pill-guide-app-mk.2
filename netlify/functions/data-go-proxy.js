const ENDPOINTS = {
  PILL_IDENTIFICATION:
    "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService02/getMdcinGrnIdntfcInfoList02",
  DRUG_EFFICACY: "https://apis.data.go.kr/B551182/msupCmpnMcareInfoService/getMsupCmpnMcareInq",
  DUR_INFO: "https://apis.data.go.kr/1471000/DURPrdlstInfoService03/getUsjntTabooInfoList03",
  EASY_DRUG_INFO: "https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList",
};

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

exports.handler = async function handler(event) {
  try {
    const qs = event.queryStringParameters || {};
    const action = qs.action;
    if (!action || !ENDPOINTS[action]) {
      return jsonResponse(400, { error: "Missing or invalid action" });
    }

    const apiKey =
      process.env.DATA_GO_API_KEY ||
      process.env.VITE_API_KEY ||
      process.env.REACT_APP_API_KEY ||
      process.env.API_KEY;

    if (!apiKey || apiKey === "YOUR_SERVICE_KEY") {
      return jsonResponse(500, {
        error: "DATA_GO_API_KEY is not configured in Netlify environment variables.",
      });
    }

    const baseUrl = ENDPOINTS[action];
    const params = { ...qs };
    delete params.action;

    // data.go.kr가 요구하는 serviceKey를 서버에서만 붙입니다.
    params.serviceKey = apiKey;

    const query = new URLSearchParams(params).toString();
    const url = `${baseUrl}?${query}`;

    const res = await fetch(url);
    const bodyText = await res.text();

    // API가 XML/JSON 등으로 내려올 수 있으니 최대한 안전하게 처리
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = { raw: bodyText };
    }

    return jsonResponse(res.status, parsed);
  } catch (err) {
    console.error("[data-go-proxy]", err);
    return jsonResponse(500, { error: "Proxy failed" });
  }
};

