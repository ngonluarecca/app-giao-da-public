export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    },
    responseLimit: '10mb'
  }
};

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-app-key, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const gasUrl = process.env.GAS_BACKEND_URL;
  if (!gasUrl) {
    return res.status(500).json({
      status: 'error',
      message: 'Chưa cấu hình biến môi trường GAS_BACKEND_URL trên Vercel Settings -> Environment Variables.'
    });
  }

  // 1. Kiểm tra xác thực qua Secret Key hoặc Bearer Token
  const appSecretKey = process.env.APP_SECRET_KEY || process.env.GAS_SECRET_KEY;
  if (appSecretKey) {
    const isPublicAction = req.method === 'GET' && req.query && req.query.action === 'getConfig';
    if (!isPublicAction) {
      const clientKey = req.headers['x-app-key'] || '';
      const authHeader = req.headers['authorization'] || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';

      const isKeyValid = clientKey && clientKey === appSecretKey;
      const isTokenPresent = Boolean(bearerToken && bearerToken.length > 20);

      if (!isKeyValid && !isTokenPresent) {
        return res.status(401).json({
          status: 'error',
          message: 'Unauthorized: Truy cập bị từ chối. Vui lòng cung cấp x-app-key hoặc token xác thực.'
        });
      }
    }
  }

  try {
    if (req.method === 'GET') {
      const urlObj = new URL(gasUrl);
      for (const [key, value] of Object.entries(req.query || {})) {
        urlObj.searchParams.set(key, value);
      }

      // Đính kèm secret_key khi gọi sang Google Apps Script để GAS kiểm tra
      if (appSecretKey) {
        urlObj.searchParams.set('secret_key', appSecretKey);
      }

      const response = await fetch(urlObj.toString(), {
        method: 'GET',
        redirect: 'follow'
      });
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (req.query && req.query.action === 'getConfig' && data && data.data) {
          if (process.env.GOOGLE_CLIENT_ID) {
            data.data.googleClientId = data.data.googleClientId || process.env.GOOGLE_CLIENT_ID;
          }
        }
        return res.status(200).json(data);
      } catch (pErr) {
        console.error('GAS GET response is not JSON:', text);
        return res.status(500).json({ status: 'error', message: 'Google Apps Script trả về lỗi: ' + text.slice(0, 300) });
      }
    } 
    
    if (req.method === 'POST') {
      let payloadObj = req.body;
      if (typeof payloadObj === 'string') {
        try {
          payloadObj = JSON.parse(payloadObj);
        } catch (_) {}
      }

      // Đính kèm secret_key vào payload khi gửi sang Google Apps Script
      if (appSecretKey && typeof payloadObj === 'object' && payloadObj !== null) {
        payloadObj.secret_key = appSecretKey;
      }

      const payloadString = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);
      const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: payloadString,
        redirect: 'follow'
      });
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        return res.status(200).json(data);
      } catch (pErr) {
        console.error('GAS POST response is not JSON:', text);
        return res.status(500).json({ status: 'error', message: 'Google Apps Script POST trả về lỗi: ' + text.slice(0, 300) });
      }
    }

    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  } catch (err) {
    console.error('[Vercel Proxy Error]:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Lỗi Vercel Proxy kết nối Google Apps Script: ' + err.message
    });
  }
}
