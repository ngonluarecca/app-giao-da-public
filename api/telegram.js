/**
 * VERCEL SERVERLESS ENDPOINT: GỬI THÔNG BÁO TELEGRAM (ĐÃ BẢO VỆ)
 */

function sanitizeHtmlForTelegram(text) {
  if (!text) return '';
  // Giới hạn an toàn 4000 ký tự (Telegram Bot API cho phép tối đa 4096 ký tự)
  let trimmed = String(text);
  if (trimmed.length > 4000) {
    trimmed = trimmed.slice(0, 3990) + '...';
  }
  // Loại bỏ các thẻ script/style nếu có
  let safe = trimmed.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Thoát ký tự '&' nếu không phải là entity HTML hợp lệ (ví dụ: &amp;, &lt;, &gt;, &quot;, &#123;)
  safe = safe.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;');
  return safe;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-key, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  // 1. Kiểm tra xác thực qua Secret Key, Bearer Token hoặc Internal App Origin
  const appSecretKey = process.env.APP_SECRET_KEY || process.env.TELEGRAM_API_SECRET;
  if (appSecretKey) {
    const clientKey = req.headers['x-app-key'] || '';
    const authHeader = req.headers['authorization'] || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

    const isKeyValid = clientKey && clientKey === appSecretKey;
    const isTokenPresent = Boolean(bearerToken && bearerToken.length > 20);

    // Kiểm tra request từ chính ứng dụng web (same-origin / same-site trên Vercel hoặc localhost)
    const secFetchSite = req.headers['sec-fetch-site'];
    const origin = req.headers['origin'] || req.headers['referer'] || '';
    const isInternalApp = secFetchSite === 'same-origin' || secFetchSite === 'same-site' ||
      origin.includes('vercel.app') || origin.includes('localhost') || origin.includes('127.0.0.1');

    if (!isKeyValid && !isTokenPresent && !isInternalApp) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized: Truy cập bị từ chối. Vui lòng cung cấp x-app-key hoặc token xác thực.'
      });
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return res.status(200).json({ status: 'ignored', message: 'Telegram chưa cấu hình biến môi trường' });
  }

  try {
    const bodyObj = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { text } = bodyObj;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ status: 'error', message: 'Nội dung tin nhắn trống' });
    }

    const safeText = sanitizeHtmlForTelegram(text);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: safeText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    let data = await response.json();

    // Xử lý Rate Limit (429 Too Many Requests từ Telegram)
    if (response.status === 429 || (data && data.description && data.description.includes('Too Many Requests'))) {
      const retryAfter = (data && data.parameters && data.parameters.retry_after) || 1;
      await new Promise(r => setTimeout(r, (retryAfter + 0.5) * 1000));
      const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: safeText,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      data = await retryRes.json();
    }

    if (!data.ok) {
      // Nếu Telegram báo lỗi format HTML, gửi fallback ở dạng text thô không parse HTML
      if (data.description && data.description.includes('can\'t parse entities')) {
        const fallbackRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: safeText.replace(/<[^>]*>/g, ''),
            disable_web_page_preview: true
          })
        });
        const fallbackData = await fallbackRes.json();
        return res.status(200).json({ status: 'success', data: fallbackData });
      }
      return res.status(400).json({ status: 'error', message: data.description || 'Lỗi gửi Telegram' });
    }

    return res.status(200).json({ status: 'success', data });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
