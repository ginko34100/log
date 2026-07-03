// Vercel 서버리스 함수: 네이버 금융 시세 중계 (CORS 없이 같은 도메인에서 호출)
export default async function handler(req, res) {
  const code = String(req.query.code || '').replace(/[^0-9A-Za-z]/g, '');
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.stock.naver.com/'
      }
    });
    if (!r.ok) return res.status(502).json({ error: 'upstream ' + r.status });
    const d = await r.json();
    res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(d);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
