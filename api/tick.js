// api/tick.js — 한투 REST 1초 폴링용: 체결/호가 스냅샷 (자가 테스트: ?debug=1)
// 필요 환경변수: KIS_APPKEY, KIS_APPSECRET, KIS_ENV (flow.js와 공유)

let tokenCache = { token: null, expires: 0 };
async function getToken(BASE, K, S) {
  if (tokenCache.token && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch(`${BASE}/oauth2/tokenP`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: K, appsecret: S }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + (j.error_description || j.msg1 || 'failed'));
  tokenCache = { token: j.access_token, expires: Date.now() + (parseInt(j.expires_in || 86400, 10) - 300) * 1000 };
  return tokenCache.token;
}
async function kis(BASE, K, S, path, trId, params) {
  const token = await getToken(BASE, K, S);
  const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}`,
      appkey: K, appsecret: S, tr_id: trId, custtype: 'P' },
  });
  return r.json();
}
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
// 키 이름을 관대하게 탐색 (응답 버전 차이 대응)
const findNum = (o, subs) => {
  if (!o) return null;
  const k = Object.keys(o).find(k => subs.every(s => k.toLowerCase().includes(s)));
  return k ? num(o[k]) : null;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const K = process.env.KIS_APPKEY, S = process.env.KIS_APPSECRET;
  if (!K || !S) return res.status(500).json({ ok: false, error: 'env KIS_APPKEY/KIS_APPSECRET not set' });
  const BASE = process.env.KIS_ENV === 'demo'
    ? 'https://openapivts.koreainvestment.com:29443'
    : 'https://openapi.koreainvestment.com:9443';
  const code = /^[A-Za-z0-9]{6}$/.test(req.query.code || '') ? req.query.code : '000660';
  const debug = req.query.debug === '1';

  try {
    // ① 현재가/누적 (FHKST01010100) + ② 호가/예상체결 (FHKST01010200) 병렬
    const [p, a] = await Promise.all([
      kis(BASE, K, S, '/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code }),
      kis(BASE, K, S, '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', 'FHKST01010200',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code }),
    ]);
    const po = p.output || {};
    const ao = a.output1 || a.output || {};
    const out = {
      ok: p.rt_cd === '0',
      code,
      price:    num(po.stck_prpr),
      changePct:num(po.prdy_ctrt),
      acmlVol:  num(po.acml_vol),            // 누적 거래량
      acmlAmt:  num(po.acml_tr_pbmn),        // 누적 거래대금(원)
      strength: num(po.cttr) ?? findNum(po, ['rltv']) ?? findNum(po, ['cttr']),  // 체결강도
      totalAsk: num(ao.total_askp_rsqn),     // 매도호가 총잔량
      totalBid: num(ao.total_bidp_rsqn),     // 매수호가 총잔량
      asOf: new Date().toISOString(),
    };
    if (debug) out.sample = { price: po, asking: ao, rt: [p.rt_cd, a.rt_cd], msg: [p.msg1, a.msg1] };
    res.setHeader('Cache-Control', 'no-store');
    return res.status(out.ok ? 200 : 502).json(out);
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e.message) });
  }
}
