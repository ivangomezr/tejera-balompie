import { supabase } from './supabase'

const KEY_AUTH = 'tj_admin_auth'
const KEY_JUGADOR = 'tj_jugador_activo'

// Lo guardado aquí solo decide qué muestra la interfaz. Quien valida contraseñas,
// roles y caducidad es el servidor (ver supabase/migrations/*_auth_servidor.sql).
function leerSesion() {
  try {
    const raw = localStorage.getItem(KEY_AUTH)
    if (!raw) return null
    const sesion = JSON.parse(raw)
    if (!sesion.token || !sesion.rol || !(new Date(sesion.expira_en).getTime() > Date.now())) {
      limpiarSesion()
      return null
    }
    return sesion
  } catch { return null }
}

function limpiarSesion() {
  try {
    localStorage.removeItem(KEY_AUTH)
    localStorage.removeItem(KEY_JUGADOR)
  } catch { }
}

// Las versiones anteriores guardaban aquí la fila completa del jugador, con su hash.
try {
  const guardado = JSON.parse(localStorage.getItem(KEY_JUGADOR))
  if (guardado?.clave_hash) {
    delete guardado.clave_hash
    localStorage.setItem(KEY_JUGADOR, JSON.stringify(guardado))
  }
} catch { }

export const adminAuth = {
  // Valida la contraseña (de jugador, admin o superadmin) en el servidor.
  login: async (jugadorId, clave) => {
    try {
      const { data, error } = await supabase.rpc('iniciar_sesion', {
        p_jugador_id: jugadorId,
        p_clave: clave,
      })
      if (error || !data) {
        console.error('Error iniciando sesión:', error)
        return { ok: false, errorConexion: true }
      }
      if (!data.ok) {
        return {
          ok: false,
          bloqueado: data.bloqueado === true,
          fallos: data.fallos ?? null,
          maxFallos: data.max_fallos,
          reintentarEn: data.reintentar_en ?? null,
        }
      }
      localStorage.setItem(KEY_AUTH, JSON.stringify({
        token: data.token,
        rol: data.rol,
        expira_en: data.expira_en,
      }))
      return { ok: true, rol: data.rol }
    } catch (err) {
      console.error('Error iniciando sesión:', err)
      return { ok: false, errorConexion: true }
    }
  },

  // Comprueba la sesión contra el servidor y actualiza el rol guardado.
  // Devuelve 'valida', 'invalida' o 'desconocido' (sin conexión: la PWA sigue funcionando).
  verificarSesion: async () => {
    const sesion = leerSesion()
    if (!sesion) return 'invalida'
    try {
      const { data, error } = await supabase.rpc('validar_sesion', { p_token: sesion.token })
      if (error || !data) return 'desconocido'
      if (!data.valida) {
        limpiarSesion()
        return 'invalida'
      }
      localStorage.setItem(KEY_AUTH, JSON.stringify({
        token: sesion.token,
        rol: data.rol,
        expira_en: data.expira_en,
      }))
      return 'valida'
    } catch { return 'desconocido' }
  },

  isLogged: () => leerSesion() !== null,

  isSuperAdmin: () => leerSesion()?.rol === 'superadmin',

  logout: () => {
    const sesion = leerSesion()
    limpiarSesion()
    if (sesion) {
      Promise.resolve(supabase.rpc('cerrar_sesion', { p_token: sesion.token })).catch(() => { })
    }
  },

  getJugador: () => {
    try {
      const v = localStorage.getItem(KEY_JUGADOR)
      return v ? JSON.parse(v) : null
    } catch { return null }
  },

  setJugador: (jugador) => {
    try { localStorage.setItem(KEY_JUGADOR, JSON.stringify(jugador)) } catch { }
  }
}
