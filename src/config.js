// Public configuration, baked in at build time. None of these values are
// secrets: they all end up in the browser anyway. Set them in
// `.env.production` (committed) or as GitHub Actions variables; see README.
const env = import.meta.env

export const config = {
  googleClientId: env.VITE_GOOGLE_CLIENT_ID || '',
  supabaseUrl: env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
}

const NAMES = {
  googleClientId: 'VITE_GOOGLE_CLIENT_ID',
  supabaseUrl: 'VITE_SUPABASE_URL',
  supabaseAnonKey: 'VITE_SUPABASE_ANON_KEY',
}

export const missingConfig = Object.keys(NAMES)
  .filter((key) => !config[key])
  .map((key) => NAMES[key])
