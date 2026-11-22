// Full-state restore is disabled until authenticated authorization and safe recovery exist.
'use strict';
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  return res.status(503).json({ error: 'استيراد الحالة معطّل مؤقتاً حتى تفعيل الصلاحيات وآلية الاستعادة الآمنة' });
};
