/** Map quality failure codes → Korean live-scan guidance (QR-style). */

export const QUALITY_MESSAGES = {
  blur: "흔들림이 있어요. 잠깐 멈추고 초점을 맞춰 주세요",
  dark: "너무 어두워요. 밝은 곳으로 옮겨 주세요",
  bright: "너무 밝아요. 빛 반사를 피해서 비춰 주세요",
  framing: "가운데에 맞춰 주세요. 흰 배경 위에 펼쳐 주세요",
  overlap: "알약이 겹쳐 보여요. 조금 펼쳐 주세요",
};

export function messagesForReasons(reasons = [], { soft = false } = {}) {
  const list = [];
  for (const code of reasons) {
    const msg = QUALITY_MESSAGES[code];
    if (msg && !list.includes(msg)) list.push(msg);
  }
  if (!list.length && soft) {
    list.push("카메라에 맞춰 천천히 비춰 주세요");
  }
  return list;
}
