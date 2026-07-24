import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

/**
 * Lazy-initialized Supabase clients to prevent build-time errors
 * when environment variables are missing.
 */

let _supabase = null;
export const getSupabase = () => {
    if (_supabase) return _supabase;
    if (!supabaseUrl || !supabaseAnonKey) return null;
    try {
        _supabase = createClient(supabaseUrl, supabaseAnonKey);
        return _supabase;
    } catch (e) {
        console.error("Supabase client init error:", e.message);
        return null;
    }
};

let _supabaseAdmin = null;
export const getSupabaseAdmin = () => {
    if (_supabaseAdmin) return _supabaseAdmin;
    if (!supabaseUrl || (!supabaseSecretKey && !supabaseAnonKey)) return null;
    try {
        _supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey || supabaseAnonKey);
        return _supabaseAdmin;
    } catch (e) {
        console.error("Supabase admin client init error:", e.message);
        return null;
    }
};
