// api/flow.js — 한국투자증권 투자자별 매매동향 프록시 (자가 테스트 내장)
//
// 설정 (폰에서도 가능):
//   Vercel 대시보드 → 프로젝트 → Settings → Environment Variables
//     KIS_APPKEY    = 앱키
//     KIS_APPSECRET = 앱시크릿
//     KIS_ENV       = real   (모의투자면 demo)
//   저장 후 Deployments → 최신 배포 → Redeploy
//
// 자가 테스트: 폰 브라우저에서  https://내앱.vercel.app/api/flow?debug=1
//   → 어떤 엔드포인트가 성공/실패했는지, 원본 응답 샘플까지 JSON으로 보여줌.
//   그 화면을 복사해서 보내주면 파서를 확정할 수 있음.

let tokenCache = { token: null, expires: 0 };

async function getToken(BASE, APPKEY, APPSECRET) {
  if (tokenCache.token && tokenCache.expires > Date.now() + 60_000) return tokenCache.token;
  const r = await fetch(`${BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: APPKEY, appsecret: APPSECRET }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('token: ' + (j.error_description || j.msg1 || JSON.stringify(j).slice(0, 120)));
  tokenCache = {
    token: j.access_token,
    expires: Date.now() + (parseInt(j.expires_in || 86400, 10) - 300) * 1000,
  };
  return tokenCache.token;
}

// 시도할 후보들 (위에서부터; 성공하는 첫 번째를 사용)
const CANDIDATES = [
  { label: '시장별 투자자매매동향(시세)',
    path: '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market',
    trId: 'FHPTJ04030000',
    params: { fid_input_iscd: '0001', fid_input_iscd_2: 'KSP' } },
  { label: '시장별 투자자매매동향(파라미터 변형)',
    path: '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market',
    trId: 'FHPTJ04030000',
    params: { FID_INPUT_ISCD: '0001', FID_INPUT_ISCD_2: 'KSP' } },
  { label: '종목별 투자자 동향(442580, 일별)',
    path: '/uapi/domestic-stock/v1/quotations/inquire-investor',
    trId: 'FHKST01010900',
    params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '442580' } },
];

async function callKis(BASE, APPKEY, APPSECRET, cand) {
  const token = await getToken(BASE, APPKEY, APPSECRET);
  const qs = new URLSearchParams(cand.params).toString();
  const r = await fetch(`${BASE}${cand.path}?${qs}`, {
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${token}`,
      'appkey': APPKEY, 'appsecret': APPSECRET,
      'tr_id': cand.trId, 'custtype': 'P',
    },
  });
  return r.json();
}

// 개인/외국인/기관 순매수를 추출 — 실제 응답 필드 확인됨 (2026-07 debug)
// 금액: {prsn|frgn|orgn}_ntby_tr_pbmn (단위: 백만원) → 억원으로 변환해 반환
function extractRows(j) {
  const outs = [j.output, j.output1, j.output2].filter(Boolean);
  const arr = outs.flatMap(o => Array.isArray(o) ? o : [o]);
  if (!arr.length) return [];
  const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const first = arr[0];
  // 케이스 A(확정): 금액 필드 직접 매칭, 없으면 수량 폴백
  const grab = p => num(first[`${p}_ntby_tr_pbmn`]) ?? num(first[`${p}_ntby_qty`]);
  const A = { 개인: grab('prsn'), 외국인: grab('frgn'), 기관: grab('orgn') };
  if (Object.values(A).some(v => v != null)) {
    return Object.entries(A)
      .filter(([, v]) => v != null)
      .map(([name, v]) => ({ name, net: Math.round(v / 100 * 10) / 10 }));   // 백만원 → 억원
  }
  // 케이스 B: 투자자 이름이 행으로 오는 형태 (폴백)
  const rows = [];
  for (const o of arr) {
    const label = String(o.invr_cls_name || o.invst_nm || o.investor || o.mbcr_name || '');
    const netKey = Object.keys(o).find(k => k.toLowerCase().includes('ntby'));
    const net = netKey ? num(o[netKey]) : null;
    if (net == null) continue;
    if (label.includes('개인')) rows.push({ name: '개인', net });
    else if (label.includes('외국')) rows.push({ name: '외국인', net });
    else if (label.includes('기관')) rows.push({ name: '기관', net });
  }
  return rows;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const APPKEY = process.env.KIS_APPKEY, APPSECRET = process.env.KIS_APPSECRET;
  const debug = req.query.debug === '1';
  if (!APPKEY || !APPSECRET) {
    return res.status(500).json({ ok: false, error: 'Vercel 환경변수 KIS_APPKEY / KIS_APPSECRET 가 없음. Settings → Environment Variables 에 추가 후 Redeploy.' });
  }
  const BASE = process.env.KIS_ENV === 'demo'
    ? 'https://openapivts.koreainvestment.com:29443'
    : 'https://openapi.koreainvestment.com:9443';

  const report = [];
  for (const cand of CANDIDATES) {
    try {
      const j = await callKis(BASE, APPKEY, APPSECRET, cand);
      const okRt = j.rt_cd === '0';
      const rows = okRt ? extractRows(j) : [];
      report.push({
        label: cand.label, trId: cand.trId,
        rt_cd: j.rt_cd, msg: j.msg1 || null,
        parsedRows: rows,
        sample: debug ? (j.output || j.output1 || j.output2 || j) : undefined,
      });
      if (okRt && rows.length) {
        if (debug) return res.status(200).json({ ok: true, used: cand.label, rows, report });
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        return res.status(200).json({ ok: true, market: 'KOSPI', used: cand.label, rows, asOf: new Date().toISOString() });
      }
    } catch (e) {
      report.push({ label: cand.label, error: String(e.message) });
      if (String(e.message).includes('token')) break;   // 토큰 자체가 안 되면 전부 무의미
    }
  }
  return res.status(debug ? 200 : 502).json({ ok: false, error: '모든 후보 실패 — debug=1 결과를 공유해주세요', report });
}
