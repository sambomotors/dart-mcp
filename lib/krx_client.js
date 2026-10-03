// KRX credentials never leave the server except in the official AUTH_KEY header.
const BASE = "https://data-dbg.krx.co.kr/svc/apis/sto/";
const SERVICES = {
  daily: "ksq_bydd_trd",
  basic: "ksq_isu_base_info",
};
const SOURCES = {
  daily: "https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S2.cmd?BO_ID=hZjGpkllgCBCWqeTsYFj",
  basic: "https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S2.cmd?BO_ID=CifLHplnUFMgpHIMMPXs",
};
const MESSAGES = {
  CONFIG_REQUIRED: "Vercel 서버 환경변수 KRX_API_KEY를 등록한 뒤 새 배포가 필요합니다.",
  INVALID_INPUT: "코스닥 종목코드 6자리와 실제 날짜 YYYYMMDD를 입력하세요. 미래 날짜는 조회할 수 없습니다.",
  AUTH_OR_APPROVAL_ERROR: "KRX 인증키, 해당 API별 이용 승인 및 이용기간을 확인하세요.",
  RATE_LIMITED: "KRX 호출 한도에 도달했습니다. 잠시 후 다시 조회하세요.",
  UPSTREAM_ERROR: "KRX 응답 오류입니다. 원문 오류나 인증키를 노출하지 않습니다.",
  NETWORK_ERROR: "KRX 연결 또는 제한시간(12초) 내 응답에 실패했습니다.",
  SCHEMA_ERROR: "KRX 응답 형식이 예상과 다릅니다. 정상 데이터로 사용하지 마세요.",
  DATE_MISMATCH: "반환된 자료의 기준일이 요청일과 다릅니다. 요청일 시세로 사용하지 마세요.",
  DATE_UNAVAILABLE: "응답에 기준일(BAS_DD)이 없거나 비어 있습니다. 날짜 불일치와 구분하며 요청일 자료로 확정하지 않습니다.",
  PARTIAL: "종목기본정보 조회 완료. 응답에 기준일이 없어 요청일 기준의 역사적 정보로 확정할 수 없습니다. 반환 정보를 시세와 같은 날짜로 결합하지 마세요.",
  NO_DATA: "해당 날짜에 자료가 없습니다. 휴장·미게시 여부를 확인하세요. 거래정지나 상장폐지를 뜻하지 않습니다.",
  SYMBOL_NOT_FOUND: "해당 날짜의 코스닥 자료에서 종목을 찾지 못했습니다. 시장·상장일·종목코드를 확인하세요.",
  OK: "요청 기준일의 자료입니다. 실시간 시세 또는 현재 KIND 지정상태 확인 결과가 아닙니다.",
};
function kstToday(now) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10).replaceAll("-", "");
}
function validDate(s) {
  if (!/^\d{8}$/.test(s)) return false;
  const d = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10).replaceAll("-", "") === s;
}
export function krxNumber(value) {
  if (value == null || String(value).trim() === "" || String(value).trim() === "-") return null;
  const s = String(value).trim().replaceAll(",", "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
}
function shortCode(row) {
  // Basic information uses ISU_SRT_CD, daily trade uses ISU_CD.
  const value = row.ISU_SRT_CD ?? row.ISU_CD;
  return typeof value === "string" && /^[0-9A-Z]{6}$/.test(value) ? value : null;
}
export async function queryKrx({ service, stock_code, bas_dd }, {
  apiKey = process.env.KRX_API_KEY,
  fetchImpl = globalThis.fetch,
  now = new Date(),
} = {}) {
  const meta = {
    source: "KRX Open API", source_url: SOURCES[service] ?? null,
    stock_code, requested_date: bas_dd, retrieved_at: now.toISOString(),
    realtime: false, kind_status: "NOT_CHECKED", kind_url: "https://kind.krx.co.kr/",
  };
  const result = (status, extra = {}) => ({ ...meta, status, message: MESSAGES[status], ...extra });
  if (!Object.hasOwn(SERVICES, service) || typeof stock_code !== "string" ||
      !/^[0-9A-Z]{6}$/.test(stock_code) || typeof bas_dd !== "string" ||
      !validDate(bas_dd) || bas_dd > kstToday(now) || bas_dd < "20100104") {
    return result("INVALID_INPUT");
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) return result("CONFIG_REQUIRED");
  let payload;
  try {
    const url = new URL(BASE + SERVICES[service]);
    url.searchParams.set("basDd", bas_dd);
    const response = await fetchImpl(url, {
      headers: { AUTH_KEY: apiKey.trim(), Accept: "application/json" },
      signal: AbortSignal.timeout(12000), redirect: "error",
    });
    if ([401, 403].includes(response.status)) return result("AUTH_OR_APPROVAL_ERROR");
    if (response.status === 429) return result("RATE_LIMITED");
    if (!response.ok) return result("UPSTREAM_ERROR", { http_status: response.status });
    try { payload = await response.json(); }
    catch { return result("SCHEMA_ERROR"); }
  } catch { return result("NETWORK_ERROR"); }
  if (!payload || typeof payload !== "object") return result("SCHEMA_ERROR");
  const code = String(payload.respCode ?? "");
  if (["401", "403"].includes(code)) return result("AUTH_OR_APPROVAL_ERROR");
  if (code === "429") return result("RATE_LIMITED");
  if (code && !["0", "00", "000", "200"].includes(code)) return result("UPSTREAM_ERROR");
  if (!Array.isArray(payload.OutBlock_1)) return result("SCHEMA_ERROR");
  const rows = payload.OutBlock_1;
  if (!rows.length) return result("NO_DATA");
  if (rows.some(row => !row || typeof row !== "object" || !shortCode(row))) return result("SCHEMA_ERROR");
  const matches = rows.filter(row => shortCode(row) === stock_code);
  if (!matches.length) return result("SYMBOL_NOT_FOUND");
  if (matches.length !== 1) return result("SCHEMA_ERROR");
  const row = matches[0];
  const dateDiagnostics = {
    date_field_present: Object.hasOwn(row, "BAS_DD"),
    returned_date: /^[0-9/-]{8,10}$/.test(String(row.BAS_DD ?? "")) ? String(row.BAS_DD) : null,
    date_value_type: row.BAS_DD === null ? "null" : typeof row.BAS_DD,
    response_fields: ["BAS_DD", "ISU_CD", "ISU_SRT_CD", "ISU_NM", "LIST_DD", "LIST_SHRS"].filter(k => Object.hasOwn(row, k)),
  };
  const dateMissing = row.BAS_DD == null || String(row.BAS_DD).trim() === "";
  if (dateMissing && service !== "basic") {
    return result("DATE_UNAVAILABLE", dateDiagnostics);
  }
  if (!dateMissing && (typeof row.BAS_DD !== "string" || !validDate(row.BAS_DD))) {
    return result("SCHEMA_ERROR", dateDiagnostics);
  }
  if (!dateMissing && row.BAS_DD !== bas_dd) return result("DATE_MISMATCH", dateDiagnostics);
  // Return only allowlisted fields; upstream messages/headers are never echoed.
  const basicFields = ["ISU_CD", "ISU_SRT_CD", "ISU_NM", "ISU_ABBRV", "ISU_ENG_NM",
    "LIST_DD", "MKT_TP_NM", "SECUGRP_NM", "SECT_TP_NM", "KIND_STKCERT_TP_NM", "PARVAL", "LIST_SHRS"];
  const dailyFields = ["ISU_CD", "ISU_NM", "MKT_NM", "SECT_TP_NM", "TDD_CLSPRC",
    "CMPPREVDD_PRC", "FLUC_RT", "TDD_OPNPRC", "TDD_HGPRC", "TDD_LWPRC", "ACC_TRDVOL", "ACC_TRDVAL", "MKTCAP", "LIST_SHRS"];
  const fields = service === "daily" ? dailyFields : basicFields;
  const raw = Object.fromEntries(fields.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]]));
  const numbers = service === "daily" ? {
    close_krw: krxNumber(row.TDD_CLSPRC), change_krw: krxNumber(row.CMPPREVDD_PRC),
    change_pct: krxNumber(row.FLUC_RT), open_krw: krxNumber(row.TDD_OPNPRC),
    high_krw: krxNumber(row.TDD_HGPRC), low_krw: krxNumber(row.TDD_LWPRC),
    volume_shares: krxNumber(row.ACC_TRDVOL), turnover_krw: krxNumber(row.ACC_TRDVAL),
    market_cap_krw: krxNumber(row.MKTCAP), listed_shares: krxNumber(row.LIST_SHRS),
  } : { listed_shares: krxNumber(row.LIST_SHRS) };
  return result(dateMissing ? "PARTIAL" : "OK", {
    basis_date: dateMissing ? null : row.BAS_DD,
    date_verification: dateMissing ? "UNAVAILABLE" : "MATCHED",
    data: numbers, raw_fields: raw,
    missing_fields: Object.keys(numbers).filter(k => numbers[k] === null) });
}
