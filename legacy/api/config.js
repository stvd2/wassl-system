'use strict';

module.exports = function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseClientKey: process.env.SUPABASE_CLIENT_KEY || ''
  });
};
