import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { adminAuth } from '../lib/adminAuth'
import { pushSoportado, esIOSsinInstalar, pushPermiso, suscribirPush, desuscribirPush, enviarNotificacion } from '../lib/push'

function formatFecha(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error('Error leyendo el archivo'))
    reader.readAsDataURL(file)
  })
}

// La lectura real la bloquea la base de datos; esto evita mostrar una página vacía
export default function Noticias() {
  const [logged, setLogged] = useState(adminAuth.isLogged())

  useEffect(() => {
    const actualizar = () => setLogged(adminAuth.isLogged())
    window.addEventListener('tj:sesion', actualizar)
    window.addEventListener('focus', actualizar)
    return () => {
      window.removeEventListener('tj:sesion', actualizar)
      window.removeEventListener('focus', actualizar)
    }
  }, [])

  if (!logged) {
    return (
      <div className="page anim-fade" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: '1rem' }}>🔒</div>
        <h1 style={{ fontFamily: 'Bebas Neue', fontSize: 26, color: 'var(--verde)', marginBottom: 8 }}>Solo para jugadores</h1>
        <p style={{ color: 'var(--gris-mid)', maxWidth: 300, marginBottom: '1.25rem' }}>
          Esta sección es exclusiva del equipo. Si eres jugador, inicia sesión para ver las portadas.
        </p>
        <button className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('tj:abrir-login'))}>
          🔑 Iniciar sesión
        </button>
      </div>
    )
  }
  return <NoticiasEquipo />
}

function NoticiasEquipo() {
  const { store } = useStore()
  const [noticias, setNoticias] = useState([])
  const [loading, setLoading] = useState(true)
  const [visor, setVisor] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const logged = adminAuth.isLogged()

  const [titulo, setTitulo] = useState('')
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // --- NUEVOS ESTADOS ---
  const [pushActivo, setPushActivo] = useState(false)
  const [pushCargando, setPushCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(true)
  const limit = 4

  // --- NUEVA LÓGICA DE CARGA ---
  const cargarPortadas = async (pagActual) => {
    const from = pagActual * limit
    const to = from + limit - 1

    try {
      const data = await store.getNoticias(from, to)
      if (data.length < limit) setHayMas(false)

      if (pagActual === 0) setNoticias(data)
      else setNoticias(prev => [...prev, ...data])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    cargarPortadas(0)

    // Comprobar si ya está suscrito
    if (pushSoportado()) {
      navigator.serviceWorker.ready.then(reg =>
        reg.pushManager.getSubscription().then(sub => setPushActivo(!!sub))
      )
    }
  }, [])

  const handleCargarMas = () => {
    const nuevaPagina = pagina + 1
    setPagina(nuevaPagina)
    cargarPortadas(nuevaPagina)
  }

  const scrollYRef = useRef(0)

  useEffect(() => {
    if (visor || showForm) {
      scrollYRef.current = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.height = '100vh'
    } else {
      document.body.style.overflow = ''
      document.body.style.height = ''
      if (scrollYRef.current) window.scrollTo(0, scrollYRef.current)
    }
    return () => {
      document.body.style.overflow = ''
      document.body.style.height = ''
    }
  }, [visor, showForm])

  const handleArchivo = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setArchivo(f)
    fileToBase64(f).then(b64 => setPreview(b64))
  }

  const handleSubmit = async () => {
    if (!titulo.trim()) { setError('Escribe un título'); return }
    if (!archivo) { setError('Selecciona una imagen'); return }
    setSaving(true)
    setError('')
    try {
      const imagen_url_local = await fileToBase64(archivo)
      const nueva = await store.addNoticia({ titulo: titulo.trim(), archivo, imagen_url_local })
      setNoticias(prev => [nueva, ...prev])

      // Enviar push a todos los suscriptores
      await enviarNotificacion()

      setTitulo('')
      setArchivo(null)
      setPreview(null)
      setShowForm(false)
    } catch (e) {
      console.error(e)
      const msg = e?.message || String(e)
      if (msg.includes('exceeded') || msg.includes('limit') || msg.includes('413') || msg.includes('too large') || msg.includes('Payload')) {
        setError('La portada supera 1 MB. Comprime la imagen e inténtalo de nuevo.')
      } else {
        setError('Error al guardar la portada. Inténtalo de nuevo.')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    const confirmar = window.confirm('¿Eliminar esta portada?')
    if (!confirmar) return
    try {
      await store.deleteNoticia(id)
      setNoticias(prev => prev.filter(n => n.id !== id))
      setVisor(null)
    } catch (e) {
      console.error('Error eliminando portada:', e)
      alert('Error al eliminar la portada. Inténtalo de nuevo.')
    }
  }

  const cancelForm = () => {
    setShowForm(false)
    setTitulo('')
    setArchivo(null)
    setPreview(null)
    setError('')
  }

  const togglePush = async () => {
    if (pushCargando) return
    setPushCargando(true)
    if (pushActivo) {
      await desuscribirPush()
      setPushActivo(false)
    } else {
      // suscribirPush ya llama a requestPermission como primer paso
      const ok = await suscribirPush()
      setPushActivo(ok)
      if (!ok && pushPermiso() === 'denied') {
        alert('Las notificaciones están bloqueadas. Actívalas en Ajustes del dispositivo.')
      }
    }
    setPushCargando(false)
  }

  return (
    <div className="page anim-fade">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Noticias 📰</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {pushSoportado() && (
            <button
              onClick={togglePush}
              disabled={pushCargando}
              title={pushActivo ? 'Desactivar notificaciones' : 'Activar notificaciones'}
              style={{
                width: 36, height: 36, borderRadius: '50%', border: '1.5px solid',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 17, cursor: 'pointer', transition: 'all 0.15s',
                background: pushActivo ? 'var(--verde)' : 'white',
                borderColor: pushActivo ? 'var(--verde)' : '#c0d0c0',
                opacity: pushCargando ? 0.5 : 1,
              }}
            >
              {pushActivo ? '🔔' : '🔕'}
            </button>
          )}
          {logged && (
            <button onClick={() => setShowForm(true)} className="btn btn-primary btn-sm">
              + Portada
            </button>
          )}
        </div>
      </div>

      {/* Banner iOS sin instalar — les explicamos que tienen que instalarla */}
      {esIOSsinInstalar() && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          background: '#fff8e6', border: '1px solid #f0c040',
          borderRadius: 12, padding: '10px 14px', marginBottom: '1rem',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>📲</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#856a00' }}>Instala la app para recibir avisos</div>
            <div style={{ fontSize: 11, color: '#a08030', marginTop: 2 }}>
              En Safari pulsa <strong>Compartir →</strong> <strong>Añadir a pantalla de inicio</strong>. Después activa las notificaciones desde la app.
            </div>
          </div>
        </div>
      )}

      {/* Banner normal — solo si push soportado y no ha respondido aún */}
      {pushSoportado() && !pushActivo && pushPermiso() === 'default' && (
        <div
          onClick={togglePush}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#f0f9f0', border: '1px solid #c0e0c0',
            borderRadius: 12, padding: '10px 14px', marginBottom: '1rem', cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 22 }}>🔔</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--verde)' }}>Activa las notificaciones</div>
            <div style={{ fontSize: 11, color: 'var(--gris-mid)' }}>Recibe un aviso cuando se suba una nueva portada</div>
          </div>
          {pushCargando
            ? <span style={{ fontSize: 13, color: 'var(--gris-mid)' }}>...</span>
            : <span style={{ color: 'var(--verde)', fontSize: 18 }}>›</span>
          }
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--gris-mid)' }}>Cargando portadas...</div>
      )}

      {!loading && noticias.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <div style={{ fontSize: 56, marginBottom: '1rem' }}>📰</div>
          <div style={{ fontFamily: 'Bebas Neue', fontSize: 22, color: 'var(--verde)', marginBottom: 8 }}>Sin portadas todavía</div>
          <div style={{ color: 'var(--gris-mid)', fontSize: 14, maxWidth: 260, margin: '0 auto' }}>
            {logged ? 'Pulsa "+ Portada" para subir la primera.' : 'Pronto aparecerán las mejores portadas del vestuario.'}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {noticias.map(n => (
          <div key={n.id} onClick={() => setVisor(n)}
            style={{ borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.13)', cursor: 'pointer', background: 'white', border: '1px solid rgba(0,0,0,0.06)', transition: 'transform 0.15s, box-shadow 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.18)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.13)' }}
          >
            <div style={{ aspectRatio: '3/4', overflow: 'hidden', background: '#eee' }}>
              <img
                src={n.imagen_url}
                alt={n.titulo}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
            <div style={{ padding: '8px 10px 10px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--negro)', lineHeight: 1.3, marginBottom: 4 }}>{n.titulo}</div>
              <div style={{ fontSize: 10, color: 'var(--gris-mid)' }}>{formatFecha(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* --- BOTÓN CARGAR MÁS --- */}
      {!loading && hayMas && noticias.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: '2rem', marginBottom: '2rem' }}>
          <button
            onClick={handleCargarMas}
            className="btn btn-primary btn-sm"
            style={{ padding: '8px 24px', background: '#f4f7f4', color: 'var(--negro)', border: '1px solid #c0d0c0', cursor: 'pointer' }}
          >
            ↓ Cargar más portadas
          </button>
        </div>
      )}

      {visor && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.88)',
            overflowY: 'scroll',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            touchAction: 'pan-y',
            paddingTop: 'calc(4rem + env(safe-area-inset-top))',
            paddingLeft: '1rem',
            paddingRight: '1rem',
            paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))',
          }}
          onClick={() => setVisor(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              margin: '0 auto',
              maxWidth: 480,
              width: '100%',
              borderRadius: 16,
              background: 'white',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
              overflow: 'hidden',
            }}
          >
            <img
              src={visor.imagen_url}
              alt={visor.titulo}
              style={{ width: '100%', display: 'block', background: '#111' }}
            />
            <div style={{
              padding: '14px 16px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Bebas Neue', fontSize: 20, color: 'var(--verde)', lineHeight: 1.2 }}>
                  {visor.titulo}
                </div>
                <div style={{ fontSize: 11, color: 'var(--gris-mid)', marginTop: 2 }}>
                  {formatFecha(visor.created_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {logged && (
                  <button
                    onClick={() => handleDelete(visor.id)}
                    style={{ background: '#fee', border: '1px solid #fcc', color: '#c0392b', borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                  >
                    🗑️
                  </button>
                )}
                <button
                  onClick={() => setVisor(null)}
                  style={{ background: '#f4f7f4', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600, color: 'var(--negro)' }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <>
          <div onClick={cancelForm} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500, background: 'white', borderRadius: '20px 20px 0 0', padding: '1.5rem', paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))', boxShadow: '0 -4px 30px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, background: '#ddd', borderRadius: 2, margin: '-0.5rem auto 1.25rem' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: 22, color: 'var(--verde)', fontFamily: 'Bebas Neue' }}>Nueva portada</h2>
              <button onClick={cancelForm} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#aaa' }}>✕</button>
            </div>
            {error && (
              <div style={{ background: '#fde8e8', border: '1px solid #f5c0c0', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#c0392b' }}>{error}</div>
            )}
            <div onClick={() => document.getElementById('input-portada').click()}
              style={{ width: '100%', aspectRatio: '3/2', borderRadius: 12, border: '2px dashed #c0d0c0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: '1rem', cursor: 'pointer', background: preview ? 'black' : '#f4f7f4' }}
            >
              {preview
                ? <img src={preview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <div style={{ textAlign: 'center', color: 'var(--gris-mid)' }}>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>🖼️</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Toca para elegir imagen</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>JPG, PNG, WebP...</div>
                </div>
              }
            </div>
            <input id="input-portada" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleArchivo} />
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="label">Titular</label>
              <input className="input" type="text" value={titulo} onChange={e => { setTitulo(e.target.value); setError('') }} maxLength={120} />
            </div>
            <button onClick={handleSubmit} disabled={saving} className="btn btn-primary btn-block" style={{ fontSize: 16, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Publicando...' : '📰 Publicar portada'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
