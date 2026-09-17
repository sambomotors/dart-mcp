import test from 'node:test';
import assert from 'node:assert/strict';
import { queryKrx, krxNumber } from '../lib/krx_client.js';
const input = {service:'daily', stock_code:'126730', bas_dd:'20260917'};
const row = { BAS_DD:'20260917', ISU_CD:'126730', TDD_CLSPRC:'19,410', ACC_TRDVOL:'0', ACC_TRDVAL:'-', MKTCAP:'170231145660', LIST_SHRS:'8770126' };
const opts = {apiKey:'test-secret', now:new Date('2026-09-17T15:30:00Z')};
const response = (body, status=200) => async()=>({status,ok:status===200,json:async()=>body});
test('missing key never calls network',async()=>{
  const r=await queryKrx(input,{...opts,apiKey:' ',fetchImpl:()=>assert.fail('network')});
  assert.equal(r.status,'CONFIG_REQUIRED');
});
test('exact date, leading zero, header and no credentials in URL',async()=>{
  const r=await queryKrx({...input,stock_code:'000250'},{...opts,fetchImpl:async(url,options)=>{
    assert.equal(url.origin,'https://data-dbg.krx.co.kr');
    assert.equal(url.search,'?basDd=20260917');
    assert.equal(options.headers.AUTH_KEY,'test-secret');
    assert.equal(options.redirect,'error');
    return {status:200,ok:true,json:async()=>({OutBlock_1:[{...row,ISU_CD:'000250'}]})};
  }});
  assert.equal(r.status,'OK'); assert.equal(r.data.close_krw,19410);
  assert.equal(r.data.volume_shares,0); assert.equal(r.data.turnover_krw,null);
  assert.equal(r.kind_status,'NOT_CHECKED'); assert.equal(r.realtime,false);
  assert.ok(!JSON.stringify(r).includes('test-secret'));
});
test('basic information matches short code instead of ISIN',async()=>{
  const r=await queryKrx({...input,service:'basic'},{...opts,fetchImpl:response({OutBlock_1:[{BAS_DD:'20260917',ISU_CD:'KR7126730009',ISU_SRT_CD:'126730',LIST_SHRS:'8770126'}]})});
  assert.equal(r.status,'OK'); assert.equal(r.data.listed_shares,8770126);
});
test('401/403 and application errors are not empty datasets',async()=>{
  for(const status of [401,403,429,500]) {
    const r=await queryKrx(input,{...opts,fetchImpl:response({},status)});
    assert.equal(r.status,status===429?'RATE_LIMITED':status===500?'UPSTREAM_ERROR':'AUTH_OR_APPROVAL_ERROR');
  }
  const r=await queryKrx(input,{...opts,fetchImpl:response({respCode:'401',respMsg:'test-secret'})});
  assert.equal(r.status,'AUTH_OR_APPROVAL_ERROR'); assert.ok(!JSON.stringify(r).includes('test-secret'));
});
test('empty and missing ticker have distinct states; no implied halt',async()=>{
  for(const [rows,status] of [[[],'NO_DATA'],[[{...row,ISU_CD:'000250'}],'SYMBOL_NOT_FOUND']]) {
    const r=await queryKrx(input,{...opts,fetchImpl:response({OutBlock_1:rows})});
    assert.equal(r.status,status); assert.equal(r.kind_status,'NOT_CHECKED');
  }
});
test('malformed payloads, duplicate rows and mismatched dates fail closed',async()=>{
  for(const payload of [null,{}, {OutBlock_1:{}},{OutBlock_1:[null]},{OutBlock_1:[row,row]}])
    assert.equal((await queryKrx(input,{...opts,fetchImpl:response(payload)})).status,'SCHEMA_ERROR');
  assert.equal((await queryKrx(input,{...opts,fetchImpl:response({OutBlock_1:[{...row,BAS_DD:'20260916'}]})})).status,'DATE_MISMATCH');
});
test('invalid calendar dates and future days rejected before request',async()=>{
  for(const bas_dd of ['20260230','20261301','20260919','20091231','2026-09-17'])
    assert.equal((await queryKrx({...input,bas_dd},{...opts,fetchImpl:()=>assert.fail('network')})).status,'INVALID_INPUT');
});
test('network and parsing failures do not leak errors or key',async()=>{
  const r=await queryKrx(input,{...opts,fetchImpl:async()=>{throw Error('test-secret');}});
  assert.equal(r.status,'NETWORK_ERROR'); assert.ok(!JSON.stringify(r).includes('test-secret'));
  const p=await queryKrx(input,{...opts,fetchImpl:async()=>({status:200,ok:true,json:async()=>{throw Error('HTML');}})});
  assert.equal(p.status,'SCHEMA_ERROR');
});
test('missing and imprecise values stay null; genuine zero stays zero',()=>{
  for(const x of [null,undefined,'',' ','-','N/A','abc','9007199254740992']) assert.equal(krxNumber(x),null);
  assert.equal(krxNumber('0'),0); assert.equal(krxNumber('-1.25'),-1.25);
});
