/* Vercel serverless function: GET /api/config
 * Exposes ONLY the Supabase project URL and the publishable (anon) key to the browser.
 * Accepts the variable names you set yourself or the ones the Vercel–Supabase integration creates. */
module.exports = (req, res) => {
  const env = process.env;
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  // Safety net: never hand a secret key to browsers, even if one was put in the wrong variable.
  const looksSecret = /^sb_secret_/.test(supabaseKey) || (() => {
    try { return JSON.parse(Buffer.from(supabaseKey.split('.')[1] || '', 'base64').toString()).role === 'service_role'; } catch (e) { return false; }
  })();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (looksSecret) { res.statusCode = 500; res.end(JSON.stringify({ error: 'A secret Supabase key was configured as the public key. Use the publishable/anon key.' })); return; }
  res.statusCode = 200;
  res.end(JSON.stringify(supabaseUrl && supabaseKey ? { supabaseUrl, supabaseKey } : {}));
};
