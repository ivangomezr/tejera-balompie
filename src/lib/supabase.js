import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Si no hay variables de entorno, exportamos un cliente mock
// para que la app funcione con datos de prueba sin Supabase
const isMock = !supabaseUrl || !supabaseKey

const mockClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ error: { message: 'Supabase no configurado aún' } }),
    signOut: async () => ({}),
  },
  from: () => ({
    select: async () => ({ data: [], error: null }),
    insert: async () => ({ data: null, error: null }),
    update: async () => ({ data: null, error: null }),
    delete: async () => ({ data: null, error: null }),
  }),
}

export function tokenSesion() {
  try { return JSON.parse(localStorage.getItem('tj_admin_auth'))?.token || null } catch { return null }
}

// Las políticas RLS leen esta cabecera para saber quién hace cada petición
function fetchConSesion(input, init = {}) {
  const headers = new Headers(init.headers)
  const token = tokenSesion()
  if (token) headers.set('x-sesion-token', token)
  return fetch(input, { ...init, headers })
}

export const supabase = isMock
  ? mockClient
  : createClient(supabaseUrl, supabaseKey, { global: { fetch: fetchConSesion } })

export const SUPABASE_READY = !isMock
