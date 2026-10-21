# KRX 코스닥 연동

## 배포 전 상태

KRX 조회 모듈과 오류처리 단위 테스트를 추가했습니다. 실제 승인 키를 사용한 운영 조회는 아직 검증하지 않았습니다. 배포 후 두 도구를 각각 호출해 서비스별 승인, 실제 응답 필드와 기준일을 확인해야 합니다.

## 설정

1. Vercel의 기존 `matthew-dart-mcp` 프로젝트 → Settings → Environment Variables에 `KRX_API_KEY`를 Secret으로 추가합니다. 값은 KRX에서 승인받은 본인 키이며 채팅·GitHub·HTML에 기록하지 않습니다.
2. 검증할 Preview 환경과 운영 Production 환경을 선택합니다. 기존 `DART_API_KEY`와 접근 게이트 설정은 유지합니다.
3. 이 변경을 배포합니다. 환경변수는 이전 배포에 소급 적용되지 않으므로 새 배포가 필요합니다.
4. MCP 연결에서 도구 목록을 새로 읽어 `krx_get_kosdaq_daily`, `krx_get_kosdaq_basic` 두 도구가 나타나는지 확인합니다.
5. 각 도구에 아래 인수를 전달하고 `status=OK`, `basis_date`, 종목코드, 단위를 확인합니다. 다른 날짜를 원하면 `bas_dd`를 변경합니다.

```json
{"stock_code":"126730","bas_dd":"20260917"}
```

일별 API의 가격·거래대금·시가총액 단위는 원, 수량은 주입니다. `null`은 미확인 값이며 0이 아닙니다. 날짜를 자동으로 과거로 돌리지 않습니다. 빈 응답은 휴장 또는 게시 지연일 수 있으므로 확인 후 이전 거래일을 명시하여 다시 조회하세요.

## 범위와 제한

- 종목기본정보 응답에 BAS_DD가 없으면 PARTIAL로 기본정보를 반환합니다. basis_date=null, date_verification=UNAVAILABLE이며 요청 날짜를 실제 자료 기준일로 대신 넣지 않습니다. 해당 상장주식수를 특정 날짜 시세와 결합해 시가총액 등을 계산하지 마세요. 일별 시세는 날짜 부재 시 계속 DATE_UNAVAILABLE로 차단합니다. 날짜가 명시됐는데 요청일과 다르면 두 서비스 모두 DATE_MISMATCH로 차단합니다.

- 일별 시세 및 종목기본정보만 조회합니다. 실시간 수급·이동평균·PER·PBR은 생성하지 않습니다.
- KIND 관리종목·거래정지·상장폐지·불성실공시는 별도 공식 확인이 필요합니다. 항상 `kind_status=NOT_CHECKED`를 반환하며 시세 조회 성공으로 PASS 처리하지 않습니다.
- 기존 HTML 대시보드는 정적 스냅샷입니다. MCP 추가만으로 열린 HTML이 자동 갱신되지는 않습니다. 도구 조회 결과를 검증한 후 대시보드 재생성 단계가 필요합니다.
- 이 변경은 HTTP 공개 데이터 프록시나 CORS 허용 경로를 신설하지 않습니다. 기존 MCP 접근 제어를 사용합니다.
- 서버는 12초 타임아웃을 적용합니다. 인증키는 HTTPS AUTH_KEY 헤더로만 전송하며 리다이렉트를 따라가지 않습니다. 오류 본문을 그대로 출력하지 않습니다.
- 공식 서비스 ID는 `ksq_bydd_trd`, `ksq_isu_base_info`입니다. 운영 대상은 `https://data-dbg.krx.co.kr/svc/apis/sto/`입니다. 이 환경에서 운영 서버 직접 호출은 네트워크 제한으로 검증하지 못했습니다. 운영 승인 키로 반드시 통합 확인해야 합니다.

## 상태별 조치

| 상태 | 조치 |
| --- | --- |
| CONFIG_REQUIRED | 서버 환경변수 설정 후 새 배포 |
| AUTH_OR_APPROVAL_ERROR | 키·해당 서비스 승인·이용기간 확인 |
| RATE_LIMITED | 호출 중단 후 재시도 |
| NETWORK_ERROR | 네트워크/시간제한 확인 |
| SCHEMA_ERROR / DATE_MISMATCH | 명세·응답 확인 전 데이터 사용 금지 |
| NO_DATA | 휴장·게시 지연 확인, 날짜 명시 재조회 |
| SYMBOL_NOT_FOUND | 시장·코드·상장일 확인 |

## 검증

`node --test test/krx_client.test.js`

테스트 데이터는 가상 fixture이며 코칩의 실제 시장가격 근거가 아닙니다.

공식 자료:
- https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S1.cmd
- https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S2.cmd?BO_ID=hZjGpkllgCBCWqeTsYFj
- https://openapi.krx.co.kr/contents/OPP/USES/service/OPPUSES002_S2.cmd?BO_ID=CifLHplnUFMgpHIMMPXs
- https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO003.jsp
- https://vercel.com/docs/environment-variables
- https://kind.krx.co.kr/
