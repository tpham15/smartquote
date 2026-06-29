// Vercel Serverless — proxy ảnh tránh CORS/hotlink
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Lấy url từ query — dùng WHATWG URL API thay url.parse()
  const reqUrl = new URL(req.url, `https://${req.headers.host}`);
  const imgUrl = reqUrl.searchParams.get('url');

  if (!imgUrl) return res.status(400).json({ error: 'Missing url param' });

  // Validate URL hợp lệ
  let parsed;
  try {
    parsed = new URL(imgUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Invalid protocol' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Block Google thumbnail (không proxy được)
  if (imgUrl.includes('encrypted-tbn') || imgUrl.includes('gstatic.com/images?q=tbn')) {
    return res.status(403).json({ error: 'Google thumbnail not supported' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(parsed.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/avif,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'Referer': `${parsed.protocol}//${parsed.host}/`,
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'Not an image' });
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout fetching image' });
    }
    return res.status(500).json({ error: err.message });
  }
}
