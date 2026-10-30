/* M Learning App — optional online-mode configuration.
 * On Vercel, leave this empty: the app reads SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or the
 * NEXT_PUBLIC_/ANON_KEY names created by the Vercel–Supabase integration) from /api/config.
 * On any other static host, fill these in. Use ONLY the publishable/anon key — it is public by
 * design and protected by the database rules. NEVER put the service_role / secret key here.
 * Leave both empty to run in local (single-device) mode. */
window.ML_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
