import { z } from "zod";
import { queryKrx } from "./krx_client.js";

export function registerKrxTools(server) {
  for (const [service, name, description] of [
    ["daily", "krx_get_kosdaq_daily", "코스닥 일별 종가·시가·고가·저가·거래량·거래대금·시가총액 조회. 실시간 시세가 아닙니다."],
    ["basic", "krx_get_kosdaq_basic", "코스닥 종목기본정보 조회. KIND 관리종목·거래정지·상장폐지·불성실공시 지정상태를 판정하지 않습니다."],
  ]) {
    server.tool(name, description + " 기준일을 명시하세요. 빈 응답을 0이나 정상 상태로 해석하지 마세요. 인증키는 서버 KRX_API_KEY로만 관리합니다.", {
      stock_code: z.string().regex(/^[0-9A-Z]{6}$/).describe("종목코드 6자리. 코칩=126730"),
      bas_dd: z.string().regex(/^\d{8}$/).describe("조회 기준일 YYYYMMDD. 휴장·미게시 시 NO_DATA, 자동 날짜 변경 없음"),
    }, async args => {
      const value = await queryKrx({ ...args, service });
      return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
        isError: !["OK", "PARTIAL", "NO_DATA", "SYMBOL_NOT_FOUND"].includes(value.status) };
    });
  }
}
