// api/price.js — Vercel 서버리스 함수
// 네이버 모바일 증권 API를 프록시해서 CORS 없이 브라우저에 시세를 전달한다.
// 호출: /api/price?code=442580  →  { code, name, price }

export default async function handler(req, res) {
  const { code } = req.query;

  // 6자리 영숫자(신형 코드 0162Z0 포함)만 허용
  if (!/^[A-Za-z0-9]{6}$/.test(code || '')) {
    return res.status(400).json({ error: 'invalid code' });
  }

  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'application/json',
      },
    });
    if (!r.ok) throw new Error(`naver ${r.status}`);
    const j = await r.json();

    // closePrice: "131,355" 형태 → 숫자로
    const raw = j.closePrice ?? j.currentPrice ?? j.nv;
    const price = parseFloat(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(price) || price <= 0) throw new Error('no price');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    return res.status(200).json({ code, name: j.stockName ?? null, price });
  } catch (e) {
    return res.status(502).json({ error: 'quote fetch failed', detail: String(e.message) });
  }
}
