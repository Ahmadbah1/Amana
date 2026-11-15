import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY doivent être définies (.env en local, Variables GitHub en production).');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
