import { createClient } from '@supabase/supabase-js';

// Sử dụng biến môi trường từ Vercel, nếu không có thì dùng giá trị mặc định
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://gftfnecqybajtiyutfwb.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmdGZuZWNxeWJhanRpeXV0ZndiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzkyMzUsImV4cCI6MjA5MTY1NTIzNX0.z3JtG-PhBeyrx0h1qms0bEbTj5FT4aTPbL_ISBQqv3Y';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
