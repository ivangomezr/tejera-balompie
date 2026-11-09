/**
 * Store — conecta con Supabase si las variables de entorno están definidas,
 * o usa localStorage como fallback para desarrollo local sin Supabase.
 */
import { supabase } from './supabase'
import { jugadoresIniciales, partidosIniciales, statsIniciales, clasificacionInicial } from './mockData'

const USE_SUPABASE = !!(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_URL !== 'https://XXXXXXXXXXXXXXXX.supabase.co'
)

// ---- LocalStorage fallback ----
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback }
  catch { return fallback }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { }
}

let _jugadores = load('tj_jugadores', jugadoresIniciales)
let _partidos = load('tj_partidos', partidosIniciales)
let _stats = load('tj_stats', statsIniciales)
let _clasificacion = load('tj_clasificacion', clasificacionInicial)
// _temporada: la que se está viendo. _temporadaPorDefecto: la en curso o, si no hay, la última jugada
let _temporada = null
let _temporadaPorDefecto = null
let _temporadas = []

let listeners = []
const notify = () => listeners.forEach(fn => fn())

// ---- Supabase helpers ----
async function sbFetch(table, select = '*', filters = {}) {
  let q = supabase.from(table).select(select)
  Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v) })
  const { data, error } = await q
  if (error) console.error(error)
  return data || []
}

// ---- Log de actividad ----
function getJugadorActivo() {
  try { return JSON.parse(localStorage.getItem('tj_jugador_activo')) } catch { return null }
}

async function log(accion, entidad, detalle = '') {
  let jugador = null
  try {
    const raw = localStorage.getItem('tj_jugador_activo')
    if (raw) jugador = JSON.parse(raw)
  } catch { }

  const entrada = {
    jugador_id: jugador?.id || null,
    jugador_nombre: jugador?.nombre || 'Sistema',
    accion,
    entidad,
    detalle: detalle || '',
  }

  if (USE_SUPABASE) {
    try {
      await supabase.from('activity_log').insert(entrada)
    } catch (e) {
      console.error('Error guardando log:', e)
    }
  } else {
    try {
      const logs = load('tj_log', [])
      save('tj_log', [{
        id: Date.now(),
        ...entrada,
        created_at: new Date().toISOString()
      }, ...logs].slice(0, 200))
    } catch { }
  }
}

// Partidos, estadísticas y clasificación de una temporada (o de todas si no hay ninguna)
async function cargarDatosTemporada(tid) {
  const filtro = tid ? { temporada_id: tid } : {}
  const [partidos, stats, clasificacion] = await Promise.all([
    sbFetch('partidos', '*', filtro),
    sbFetch('estadisticas', '*', filtro),
    sbFetch('clasificacion', '*', filtro),
  ])
  _partidos = partidos.map(p => ({ ...p, jugado: p.jugado || false, mvp_jugador_id: p.mvp_jugador_id || null }))
  _stats = stats.map(s => ({ id: s.id, jugador_id: s.jugador_id, partido_id: s.partido_id, goles: s.goles, asistencias: s.asistencias, tarjetas_amarillas: s.tarjetas_amarillas, tarjetas_rojas: s.tarjetas_rojas, paradas: s.paradas || 0, goles_encajados: s.goles_encajados || 0 }))
  _clasificacion = clasificacion.sort((a, b) => (a.grupo || '').localeCompare(b.grupo || '') || a.pos - b.pos)
}

// ---- Store público ----
export const store = {
  subscribe(fn) {
    listeners.push(fn)
    return () => { listeners = listeners.filter(l => l !== fn) }
  },

  // =====================
  // GETTERS (síncronos — usan caché local)
  // =====================
  getJugadores() { return [..._jugadores] },
  getPartidos() { return [..._partidos] },
  getStats() { return [..._stats] },
  getClasificacion() { return [..._clasificacion] },

  getStatsPartido(partido_id) {
    return _stats.filter(s => s.partido_id === partido_id)
  },
  getStatsTotalesJugador(jugador_id) {
    const ss = _stats.filter(s => s.jugador_id === jugador_id)
    return {
      partidos: ss.length,
      goles: ss.reduce((a, s) => a + s.goles, 0),
      asistencias: ss.reduce((a, s) => a + s.asistencias, 0),
      tarjetas_amarillas: ss.reduce((a, s) => a + s.tarjetas_amarillas, 0),
      tarjetas_rojas: ss.reduce((a, s) => a + s.tarjetas_rojas, 0),
    }
  },

  // =====================
  // INIT — carga datos desde Supabase al arrancar
  // =====================
  async init() {
    if (!USE_SUPABASE) return

    // Todas las temporadas: primero la en curso; si no hay, la última jugada
    const { data: temporadas } = await supabase.from('temporadas').select('*')
    _temporadas = (temporadas || []).sort((x, y) =>
      (Number(y.activa) - Number(x.activa)) || ((y.año || 0) - (x.año || 0)) || (y.id - x.id))
    _temporadaPorDefecto = _temporadas[0] || null
    _temporada = _temporadaPorDefecto

    const [jugadores] = await Promise.all([
      sbFetch('jugadores'),  // jugadores son globales, no por temporada
      cargarDatosTemporada(_temporada?.id),
    ])

    _jugadores = jugadores.map(j => ({ id: j.id, nombre: j.nombre, posicion: j.posicion, dorsal: j.dorsal, foto_url: j.foto_url, estado: j.estado, estado_desc: j.estado_desc || null }))

    notify()
  },

  // =====================
  // JUGADORES
  // =====================
  async addJugador(j) {
    if (USE_SUPABASE) {
      const { data } = await supabase.from('jugadores').insert({ nombre: j.nombre, posicion: j.posicion, dorsal: j.dorsal }).select().single()
      if (data) { _jugadores = [..._jugadores, { id: data.id, nombre: data.nombre, posicion: data.posicion, dorsal: data.dorsal }] }
    } else {
      const id = Math.max(0, ..._jugadores.map(x => x.id)) + 1
      _jugadores = [..._jugadores, { ...j, id }]
      save('tj_jugadores', _jugadores)
    }
    await log('➕ Añadió', 'Jugador', j.nombre)
    notify()
  },
  async updateJugador(id, data) {
    if (USE_SUPABASE) await supabase.from('jugadores').update({ nombre: data.nombre, posicion: data.posicion, dorsal: data.dorsal, foto_url: data.foto_url || null, estado: data.estado || 'disponible', estado_desc: data.estado_desc || null }).eq('id', id)
    _jugadores = _jugadores.map(j => j.id === id ? { ...j, ...data } : j)
    if (!USE_SUPABASE) save('tj_jugadores', _jugadores)
    const j = _jugadores.find(x => x.id === id)
    await log('✏️ Editó', 'Jugador', j?.nombre || String(id))
    notify()
  },
  async deleteJugador(id) {
    if (USE_SUPABASE) await supabase.from('jugadores').delete().eq('id', id)
    _jugadores = _jugadores.filter(j => j.id !== id)
    _stats = _stats.filter(s => s.jugador_id !== id)
    if (!USE_SUPABASE) { save('tj_jugadores', _jugadores); save('tj_stats', _stats) }
    const j = _jugadores.find(x => x.id === id)
    await log('🗑️ Eliminó', 'Jugador', j?.nombre || String(id))
    notify()
  },

  // =====================
  // PARTIDOS
  // =====================
  async addPartido(p) {
    if (USE_SUPABASE) {
      const { data } = await supabase.from('partidos').insert({ jornada: p.jornada, fecha: p.fecha, hora: p.hora || null, local: p.local, visitante: p.visitante, campo: p.campo, jugado: p.jugado || false, goles_local: p.goles_local || 0, goles_visitante: p.goles_visitante || 0, temporada_id: _temporada?.id || null, amistoso: p.amistoso || false, escudo_rival_url: p.escudo_rival_url || null }).select().single()
      if (data) { _partidos = [..._partidos, data] }
    } else {
      const id = Math.max(0, ..._partidos.map(x => x.id)) + 1
      _partidos = [..._partidos, { ...p, id, jugado: false, goles_local: 0, goles_visitante: 0, penaltis: false, goles_penaltis_local: 0, goles_penaltis_visitante: 0, eventos_penaltis: [] }]
      save('tj_partidos', _partidos)
    }
    await log('➕ Añadió', 'Partido', `J${p.jornada} vs ${p.visitante || p.local}`)
    notify()
  },
  async registrarPartidoJugado(partido_id, convocados_ids) {
    const temporada_id = _temporada?.id || null
    for (const jugador_id of convocados_ids) {
      const existe = _stats.find(s => s.jugador_id === jugador_id && s.partido_id === partido_id)
      if (!existe) {
        const data = { jugador_id, partido_id, goles: 0, asistencias: 0, tarjetas_amarillas: 0, tarjetas_rojas: 0, paradas: 0, goles_encajados: 0, temporada_id }
        if (USE_SUPABASE) {
          await supabase.from('estadisticas').upsert(data, { onConflict: 'jugador_id,partido_id' })
        }
        const id = Math.max(0, ..._stats.map(x => x.id)) + 1
        _stats = [..._stats, { ...data, id }]
      }
    }
    if (!USE_SUPABASE) save('tj_stats', _stats)
    notify()
  },
  async updatePartido(id, data) {
    if (USE_SUPABASE) {
      await supabase.from('partidos').update({
        jornada: data.jornada,
        fecha: data.fecha,
        hora: data.hora || null,
        local: data.local,
        visitante: data.visitante,
        campo: data.campo,
        jugado: data.jugado,
        goles_local: data.goles_local,
        goles_visitante: data.goles_visitante,
        alineacion: data.alineacion || null,
        formacion: data.formacion || null,
        amistoso: data.amistoso || false,
        escudo_rival_url: data.escudo_rival_url !== undefined ? data.escudo_rival_url : null,
        convocados: data.convocados || [],
        penaltis: data.penaltis || false,
        goles_penaltis_local: data.penaltis ? (data.goles_penaltis_local || 0) : 0,
        goles_penaltis_visitante: data.penaltis ? (data.goles_penaltis_visitante || 0) : 0,
        eventos_penaltis: data.eventos_penaltis || [],
        mvp_jugador_id: data.mvp_jugador_id !== undefined ? data.mvp_jugador_id : null // LÍNEA AÑADIDA
      }).eq('id', id)
    }

    _partidos = _partidos.map(p => p.id === id ? { ...p, ...data } : p)
    if (!USE_SUPABASE) save('tj_partidos', _partidos)
    const p = _partidos.find(x => x.id === id)
    await log('✏️ Editó', 'Partido', `J${p?.jornada} vs ${p?.visitante || p?.local}`)
    notify()
  },
  async updateConvocados(partido_id, convocados) {
    if (USE_SUPABASE) {
      await supabase.from('partidos').update({ convocados }).eq('id', partido_id)
    }
    _partidos = _partidos.map(p => p.id === partido_id ? { ...p, convocados } : p)
    if (!USE_SUPABASE) save('tj_partidos', _partidos)
    notify()
  },
  // =====================
  // CLOUDINARY UPLOAD
  // =====================
  async comprimirImagen(archivo, { maxWidth = 800, maxHeight = 800, quality = 0.75 } = {}) {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(archivo)
      img.onload = () => {
        URL.revokeObjectURL(url)
        let { width, height } = img
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => resolve(blob || archivo), 'image/jpeg', quality)
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(archivo) }
      img.src = url
    })
  },
  async uploadToCloudinary(archivo, folder = 'tejera', opciones = {}) {
    const blob = await store.comprimirImagen(archivo, opciones)
    const formData = new FormData()
    formData.append('file', blob)
    formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET)
    formData.append('folder', folder)
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formData }
    )
    if (!res.ok) { console.error('Error subiendo a Cloudinary'); return null }
    const data = await res.json()
    return data.secure_url
  },

  async uploadEscudoRival(partidoId, archivo) {
    return await store.uploadToCloudinary(archivo, 'tejera/escudos-rivales', { maxWidth: 300, maxHeight: 300, quality: 0.80 })
  },
  async deletePartido(id) {
    if (USE_SUPABASE) await supabase.from('partidos').delete().eq('id', id)
    _partidos = _partidos.filter(p => p.id !== id)
    _stats = _stats.filter(s => s.partido_id !== id)
    if (!USE_SUPABASE) { save('tj_partidos', _partidos); save('tj_stats', _stats) }
    const p = _partidos.find(x => x.id === id)
    await log('🗑️ Eliminó', 'Partido', `J${p?.jornada} vs ${p?.visitante || p?.local}`)
    notify()
  },

  // =====================
  // ESTADÍSTICAS
  // =====================
  async upsertStat(data) {
    if (USE_SUPABASE) {
      await supabase.from('estadisticas').upsert({ jugador_id: data.jugador_id, partido_id: data.partido_id, goles: data.goles, asistencias: data.asistencias, tarjetas_amarillas: data.tarjetas_amarillas, tarjetas_rojas: data.tarjetas_rojas, paradas: data.paradas || 0, goles_encajados: data.goles_encajados || 0, temporada_id: _temporada?.id || null }, { onConflict: 'jugador_id,partido_id' })
    }
    const existing = _stats.find(s => s.jugador_id === data.jugador_id && s.partido_id === data.partido_id)
    if (existing) {
      _stats = _stats.map(s => (s.jugador_id === data.jugador_id && s.partido_id === data.partido_id) ? { ...s, ...data } : s)
    } else {
      const id = Math.max(0, ..._stats.map(x => x.id)) + 1
      _stats = [..._stats, { ...data, id }]
    }
    if (!USE_SUPABASE) save('tj_stats', _stats)
    const j = _jugadores.find(x => x.id === data.jugador_id)
    const p = _partidos.find(x => x.id === data.partido_id)
    await log('📊 Stats', 'Estadísticas', `${j?.nombre} en J${p?.jornada}`)
    notify()
  },
  async deleteStat(jugador_id, partido_id) {
    if (USE_SUPABASE) await supabase.from('estadisticas').delete().eq('jugador_id', jugador_id).eq('partido_id', partido_id)
    _stats = _stats.filter(s => !(s.jugador_id === jugador_id && s.partido_id === partido_id))
    if (!USE_SUPABASE) save('tj_stats', _stats)
    const j = _jugadores.find(x => x.id === jugador_id)
    const p = _partidos.find(x => x.id === partido_id)
    await log('🗑️ Eliminó', 'Estadísticas', `${j?.nombre} en J${p?.jornada}`)
    notify()
  },

  // =====================
  // CLASIFICACIÓN
  // =====================
  async updateFilaClasificacion(equipo, data) {
    if (USE_SUPABASE) await supabase.from('clasificacion').update({ pj: data.pj, pg: data.pg, pe: data.pe, pp: data.pp, gf: data.gf, gc: data.gc, pts: data.pts, grupo: data.grupo || null }).eq('equipo', equipo)
    _clasificacion = _clasificacion.map(e => e.equipo === equipo ? { ...e, ...data } : e)
    if (!USE_SUPABASE) save('tj_clasificacion', _clasificacion)
    await log('✏️ Editó', 'Clasificación', equipo)
    notify()
  },
  async addEquipoClasificacion(data) {
    const newEntry = { equipo: data.equipo, pos: data.pos || 1, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0, grupo: data.grupo || 'A', temporada_id: _temporada?.id || null }
    if (USE_SUPABASE) {
      const { data: row, error } = await supabase.from('clasificacion').insert(newEntry).select().single()
      if (error) throw error
      _clasificacion = [..._clasificacion, row].sort((a, b) => (a.grupo || '').localeCompare(b.grupo || '') || a.pos - b.pos)
    } else {
      _clasificacion = [..._clasificacion, newEntry].sort((a, b) => (a.grupo || '').localeCompare(b.grupo || '') || a.pos - b.pos)
      save('tj_clasificacion', _clasificacion)
    }
    notify()
  },
  async deleteEquipoClasificacion(equipo) {
    if (USE_SUPABASE) await supabase.from('clasificacion').delete().eq('equipo', equipo)
    _clasificacion = _clasificacion.filter(e => e.equipo !== equipo)
    if (!USE_SUPABASE) save('tj_clasificacion', _clasificacion)
    notify()
  },

  async getVotoMvp(partido_id, votante_id) {
    if (!USE_SUPABASE) return null
    const { data } = await supabase
      .from('votos_mvp')
      .select('votado_id')
      .eq('partido_id', partido_id)
      .eq('votante_id', votante_id)
      .single()
    return data?.votado_id || null
  },
  // =====================
  // VOTOS MVP
  // =====================
  async getVotosMvp(partido_id) {
    if (USE_SUPABASE) {
      const { data } = await supabase.from('votos_mvp').select('*').eq('partido_id', partido_id)
      return data || []
    }
    return load('tj_votos_' + partido_id, [])
  },
  async votarMvp(partido_id, votante_id, votado_id) {
    if (USE_SUPABASE) {
      // 1. Borrado preventivo: nos aseguramos de limpiar cualquier rastro tuyo en este partido
      await supabase
        .from('votos_mvp')
        .delete()
        .eq('partido_id', partido_id)
        .eq('votante_id', votante_id);

      // 2. Insertamos el voto nuevo de forma limpia
      const { error } = await supabase
        .from('votos_mvp')
        .insert([{ partido_id, votante_id, votado_id }]);

      if (error) {
        console.error("Error al guardar el nuevo voto:", error);
      }
    } else {
      // Tu lógica original de LocalStorage se mantiene intacta
      const votos = load('tj_votos_' + partido_id, [])
      const sin = votos.filter(v => v.votante_id !== votante_id)
      save('tj_votos_' + partido_id, [...sin, { partido_id, votante_id, votado_id }])
    }
  },
  async eliminarVotoMvp(partido_id, votante_id) {
    if (USE_SUPABASE) {
      const { error } = await supabase
        .from('votos_mvp')
        .delete()
        .eq('partido_id', partido_id)
        .eq('votante_id', votante_id);

      if (error) {
        console.error("Error al eliminar el voto en Supabase:", error);
      }
    }
  },

  // =====================
  // ALINEACIONES
  // =====================
  async getAlineacion(partido_id) {
    if (USE_SUPABASE) {
      const { data } = await supabase
        .from('alineaciones')
        .select('*')
        .eq('partido_id', partido_id)
        .maybeSingle()
      return data || null
    }
    return load('tj_alin_' + partido_id, null)
  },
  async saveAlineacion(partido_id, formacion, jugadoresAlin) {
    if (USE_SUPABASE) {
      const { error } = await supabase.from('alineaciones').upsert(
        { partido_id, formacion, jugadores: jugadoresAlin },
        { onConflict: 'partido_id' }
      )
      if (error) console.error('Error guardando alineacion:', error)
    } else {
      save('tj_alin_' + partido_id, { partido_id, formacion, jugadores: jugadoresAlin })
    }
    const p = _partidos.find(x => x.id === partido_id)
    await log('👕 Alineación', 'Alineación', `J${p?.jornada} — ${formacion}`)
  },
  async subirFotoJugador(jugador_id, archivo) {
    return await store.uploadToCloudinary(archivo, 'tejera/avatares', { maxWidth: 400, maxHeight: 400, quality: 0.75 })
  },


  // =====================
  // NOTICIAS
  // =====================
  async getNoticias(from = 0, to = 3) {
    if (USE_SUPABASE) {
      const { data, error } = await supabase
        .from('noticias')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to) // Limita la descarga a las noticias que pidas

      if (error) console.error(error)
      return data || []
    }

    // Si estás trabajando en local, también recortamos el array
    const localData = load('tj_noticias', [])
    return localData.slice(from, to + 1)
  },
  // imagen_url ya viene procesada desde el componente (base64 o URL de Supabase)
  async addNoticia({ titulo, archivo, imagen_url_local }) {
    const id = Date.now()
    const created_at = new Date().toISOString()

    if (USE_SUPABASE) {
      let imagen_url = imagen_url_local || null
      if (archivo) {
        imagen_url = await store.uploadToCloudinary(archivo, 'tejera/noticias', { maxWidth: 1000, maxHeight: 1400, quality: 0.72 })
        if (!imagen_url) throw new Error('Error subiendo imagen a Cloudinary')
      }
      const { data, error } = await supabase
        .from('noticias')
        .insert({ titulo, imagen_url, created_at })
        .select()
        .single()
      if (error) throw error
      await log('📰 Publicó', 'Noticia', titulo)
      return data
    } else {
      // En modo local, imagen_url_local ya es el base64 generado en el componente
      const nueva = { id, titulo, imagen_url: imagen_url_local || null, created_at }
      const noticias = load('tj_noticias', [])
      save('tj_noticias', [nueva, ...noticias])
      await log('📰 Publicó', 'Noticia', titulo)
      return nueva
    }

  },
  async deleteNoticia(id) {
    if (USE_SUPABASE) {
      // 1. Obtenemos la noticia directamente de Supabase para saber la URL de su imagen
      const { data: noticia } = await supabase
        .from('noticias')
        .select('*')
        .eq('id', id)
        .single()

      // 2. Borramos la fila de la base de datos
      await supabase.from('noticias').delete().eq('id', id)

      // La imagen está en Cloudinary — no es necesario borrarla desde el cliente
      // (se puede hacer desde el dashboard de Cloudinary o ignorar, el storage es gratuito)
    } else {
      // Modo local: Cargamos del localStorage, filtramos y volvemos a guardar
      const noticiasActuales = load('tj_noticias', [])
      const noticiasFiltradas = noticiasActuales.filter(n => n.id !== id)
      save('tj_noticias', noticiasFiltradas)
    }

    // Notificamos a los componentes para que se actualice la UI
    notify()
  },
  async getLog() {
    if (USE_SUPABASE) {
      const { data } = await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      return data || []
    }
    return load('tj_log', [])
  },

  // =====================
  // TEMPORADAS
  // =====================
  async getTemporadas() {
    if (USE_SUPABASE) {
      const { data } = await supabase
        .from('temporadas')
        .select('*')
        .order('año', { ascending: false })
      return data || []
    }
    return load('tj_temporadas', [{ id: 1, nombre: 'Liga Verano 2026', año: 2026, activa: true }])
  },

  // Temporada que se está viendo (la elegida arriba, o la de por defecto)
  getTemporadaVisible() {
    return _temporada
  },

  getTemporadasLista() {
    return [..._temporadas]
  },

  esTemporadaPorDefecto() {
    return !_temporada || _temporada.id === _temporadaPorDefecto?.id
  },

  // Cambia la temporada que muestran Inicio, Tabla, Plantilla, Partidos y Estadísticas
  async seleccionarTemporada(id) {
    const elegida = _temporadas.find(t => t.id === id)
    if (!elegida || elegida.id === _temporada?.id) return
    _temporada = elegida
    notify()
    if (USE_SUPABASE) await cargarDatosTemporada(elegida.id)
    notify()
  },

  getTemporadaActiva() {
    return _temporada?.activa ? _temporada : null
  },

  // Cierra la temporada en curso. Sus datos se siguen viendo hasta empezar la siguiente.
  async cerrarTemporada() {
    if (USE_SUPABASE) {
      const { data, error } = await supabase
        .from('temporadas').update({ activa: false }).eq('activa', true).select()
      if (error) throw error
      if (!data?.length) throw new Error('No se ha cerrado ninguna temporada')
    } else {
      save('tj_temporadas', load('tj_temporadas', []).map(t => ({ ...t, activa: false })))
    }
    _temporadas = _temporadas.map(t => ({ ...t, activa: false }))
    if (_temporadaPorDefecto) _temporadaPorDefecto = { ..._temporadaPorDefecto, activa: false }
    if (_temporada) _temporada = { ..._temporada, activa: false }
    notify()
  },

  // Empieza una temporada nueva. Solo se puede si no hay otra en curso.
  async empezarTemporada(nombre, año) {
    let nueva
    if (USE_SUPABASE) {
      const { data, error } = await supabase
        .from('temporadas').insert({ nombre, año, activa: true }).select().single()
      if (error) throw error
      nueva = data
    } else {
      const temps = load('tj_temporadas', [])
      if (temps.some(t => t.activa)) throw new Error('Ya hay una temporada en curso')
      nueva = { id: Date.now(), nombre, año, activa: true }
      save('tj_temporadas', [...temps, nueva])
      save('tj_partidos', []); save('tj_stats', []); save('tj_clasificacion', [])
    }
    _temporadas = [nueva, ..._temporadas]
    _temporadaPorDefecto = nueva
    _temporada = nueva
    // La nueva temporada empieza vacía; la anterior queda en Temporadas
    _partidos = []
    _stats = []
    _clasificacion = []
    notify()
    return nueva
  },

  async getDatosTemporada(temporada_id) {
    if (!USE_SUPABASE) return null
    const [partidos, stats, clasificacion] = await Promise.all([
      supabase.from('partidos').select('*').eq('temporada_id', temporada_id),
      supabase.from('estadisticas').select('*').eq('temporada_id', temporada_id),
      supabase.from('clasificacion').select('*').eq('temporada_id', temporada_id),
    ])
    return {
      partidos: partidos.data || [],
      stats: stats.data || [],
      clasificacion: (clasificacion.data || []).sort((a, b) => b.pts - a.pts),
    }
  },

  // =====================
  // PATROCINADORES
  // =====================
  async getPatrocinadores() {
    if (USE_SUPABASE) {
      const { data } = await supabase.from('patrocinadores').select('*').order('created_at', { ascending: true })
      return data || []
    }
    return load('tj_patrocinadores', [])
  },
  async addPatrocinador(nombre, archivo) {
    if (USE_SUPABASE) {
      let imagen_url = null
      if (archivo) {
        imagen_url = await store.uploadToCloudinary(archivo, 'tejera/patrocinadores', { maxWidth: 600, maxHeight: 600, quality: 0.80 })
      }
      const { data } = await supabase.from('patrocinadores').insert({ nombre, imagen_url }).select().single()
      return data
    } else {
      const p = { id: Date.now(), nombre, imagen_url: null, created_at: new Date().toISOString() }
      const list = load('tj_patrocinadores', [])
      save('tj_patrocinadores', [...list, p])
      return p
    }
  },
  async deletePatrocinador(id) {
    if (USE_SUPABASE) await supabase.from('patrocinadores').delete().eq('id', id)
    else {
      const list = load('tj_patrocinadores', [])
      save('tj_patrocinadores', list.filter(p => p.id !== id))
    }
  },

  // =====================
  // RESET
  // =====================
  resetAll() {
    _jugadores = jugadoresIniciales
    _partidos = partidosIniciales
    _stats = statsIniciales
    _clasificacion = clasificacionInicial
      ;['tj_jugadores', 'tj_partidos', 'tj_stats', 'tj_clasificacion'].forEach(k => localStorage.removeItem(k))
    notify()
  }
}