import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../hooks/useStore'
import { EQUIPO_NOMBRE } from '../lib/mockData'

function initials(nombre = '') {
  return nombre
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'
}

function Avatar({ jugador, size = 'sm' }) {
  const dim = size === 'sm' ? 32 : size === 'md' ? 42 : 64
  const fs = size === 'sm' ? 12 : size === 'md' ? 15 : 22

  return (
    <div
      className={`avatar avatar-${size}`}
      style={{ overflow: 'hidden', padding: 0, width: dim, height: dim, flexShrink: 0 }}
    >
      {jugador?.foto_url ? (
        <img
          src={jugador.foto_url}
          alt={jugador.nombre || 'Jugador'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        <span style={{ fontSize: fs }}>{initials(jugador?.nombre)}</span>
      )}
    </div>
  )
}

function formatFecha(fecha) {
  if (!fecha) return '-'
  const d = new Date(`${fecha}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

function resultadoPartido(partido) {
  const esLocal = partido.local === EQUIPO_NOMBRE
  const nuestros = esLocal ? partido.goles_local : partido.goles_visitante
  const rival = esLocal ? partido.goles_visitante : partido.goles_local
  if (nuestros > rival) return 'victoria'
  if (nuestros < rival) return 'derrota'
  if (!partido.penaltis) return 'empate'
  const np = esLocal ? partido.goles_penaltis_local : partido.goles_penaltis_visitante
  const rp = esLocal ? partido.goles_penaltis_visitante : partido.goles_penaltis_local
  return np > rp ? 'victoria' : 'derrota'
}

function getCountdownLabel(fecha, hora, now) {
  const matchDate = new Date(`${fecha}T${hora}:00`);
  const diffMs = matchDate - now;

  if (Number.isNaN(matchDate.getTime())) {
    return { label: 'Fecha pendiente', dias: 0, horas: 0, pasado: false };
  }

  const pasado = diffMs < 0;

  // Horas absolutas para calcular cuándo mostrar "Faltan 23h" en la etiqueta pequeña
  const horasTotales = Math.floor(diffMs / (1000 * 60 * 60));
  const diasRestantes = Math.floor(horasTotales / 24);

  // Horas sueltas (0-23) para que el contador grande muestre "1 día y 6h"
  const horasSueltas = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  let label = 'Próximamente';

  if (pasado) {
    label = 'En juego / Finalizado';
  } else if (horasTotales <= 24) {
    const esHoy = matchDate.toDateString() === now.toDateString();
    label = esHoy ? `Hoy · faltan ${horasTotales}h` : `Faltan ${horasTotales}h`;
  } else {
    label = diasRestantes === 1 ? 'Falta 1 día' : `Faltan ${diasRestantes} días`;
  }

  // IMPORTANTE: Devolvemos horasSueltas en la variable "horas" para el componente
  return { label, dias: diasRestantes, horas: horasSueltas, pasado };
}

export default function Inicio() {
  const nav = useNavigate()
  const { jugadores = [], partidos = [], stats = [], clasificacion = [] } = useStore()
  const [ahora, setAhora] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const data = useMemo(() => {
    // 1. Buscamos nuestro equipo
    const nuestroObj = clasificacion.find((e) => e.equipo === EQUIPO_NOMBRE)
    let posicionCalculada = '-'

    // 2. Si lo encontramos, ordenamos su grupo para saber la posición real
    if (nuestroObj) {
      const miGrupo = nuestroObj.grupo || 'A'

      const clasificacionGrupo = clasificacion
        .filter(e => (e.grupo || 'A') === miGrupo)
        .sort((a, b) => b.pts - a.pts || (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf)

      const index = clasificacionGrupo.findIndex(e => e.equipo === EQUIPO_NOMBRE)
      if (index !== -1) {
        posicionCalculada = index + 1
      }
    }

    // 3. Añadimos la posición calculada al objeto
    const nuestro = nuestroObj ? { ...nuestroObj, posCalculada: posicionCalculada } : null

    const idsAmistosos = new Set(
      partidos.filter((p) => p.amistoso).map((p) => p.id)
    )

    const statsCompeticion = stats.filter((s) => !idsAmistosos.has(s.partido_id))
    const totalGoles = statsCompeticion.reduce((acc, s) => acc + (s.goles || 0), 0)

    const totales = jugadores.map((j) => {
      const ss = statsCompeticion.filter((s) => s.jugador_id === j.id)
      return {
        ...j,
        goles: ss.reduce((a, s) => a + (s.goles || 0), 0),
        asistencias: ss.reduce((a, s) => a + (s.asistencias || 0), 0),
      }
    })

    const goleador = [...totales].sort((a, b) => b.goles - a.goles)[0]
    const asistente = [...totales].sort((a, b) => b.asistencias - a.asistencias)[0]

    const nuestrosPartidos = partidos.filter(
      (p) => p.local === EQUIPO_NOMBRE || p.visitante === EQUIPO_NOMBRE
    )

    // Calcular resultados reales desde partidos (no desde clasificación manual)
    const jugados = nuestrosPartidos.filter(p => p.jugado && !p.amistoso)
    const resPartidos = jugados.map(p => resultadoPartido(p))
    const pgReal = resPartidos.filter(r => r === 'victoria').length
    const peReal = resPartidos.filter(r => r === 'empate').length
    const ppReal = resPartidos.filter(r => r === 'derrota').length
    const pjReal = jugados.length

    const ultimos = [...nuestrosPartidos]
      .filter((p) => p.jugado)
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 3)

    const proximos = [...nuestrosPartidos]
      .filter((p) => !p.jugado)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))

    const proximo = proximos[0] || null

    return {
      nuestro,
      totalGoles,
      totales,
      goleador,
      asistente,
      ultimos,
      proximo,
      pgReal, peReal, ppReal, pjReal,
    }
  }, [jugadores, partidos, stats, clasificacion])

  if (!jugadores.length) {
    return (
      <div className="page">
        <div className="empty" style={{ marginTop: '3rem' }}>
          Cargando datos...
        </div>
      </div>
    )
  }

  const { nuestro, totalGoles, totales, goleador, asistente, ultimos, proximo, pgReal, peReal, ppReal, pjReal } = data
  const topGoleadores = [...totales].sort((a, b) => b.goles - a.goles).filter((j) => j.goles > 0).slice(0, 4)
  const maxGoles = Math.max(...totales.map((x) => x.goles || 0), 1)

  return (
    <div className="page">
      {/* Hero principal */}
      <section
        className="anim-scale"
        style={{
          background: 'linear-gradient(135deg,#0d0a0b 0%,#5a1520 100%)',
          borderRadius: 20,
          padding: '1.2rem',
          marginBottom: '1rem',
          border: '1px solid rgba(240,192,64,.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
          <img
            src="/escudo.png"
            alt="Escudo Tejera Balompié"
            style={{ width: 78, height: 78, objectFit: 'contain', flexShrink: 0 }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: 'Bebas Neue',
                fontSize: 30,
                color: '#fff',
                letterSpacing: '.04em',
                lineHeight: 1,
              }}
            >
              Tejera Balompié
            </div>
            <div
              style={{
                color: '#d9b5bf',
                fontSize: 10,
                letterSpacing: '.10em',
                textTransform: 'uppercase',
                marginTop: 4,
              }}
            >
              Liga de Verano Villacañas 2026
            </div>
          </div>
        </div>

        <div className="grid-3" style={{ marginTop: 12 }}>
          {[
            [`${nuestro?.posCalculada ?? '-'}º`, 'Posición'],
            [`${nuestro?.pts ?? 0}`, 'Puntos'],
            [`${pgReal}-${peReal}-${ppReal}`, 'Racha'],
          ].map(([valor, label]) => (
            <div
              key={label}
              style={{
                background: 'rgba(255,255,255,.07)',
                borderRadius: 10,
                padding: '8px 10px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontFamily: 'Bebas Neue', fontSize: 24, color: 'var(--dorado-light)', lineHeight: 1 }}>
                {valor}
              </div>
              <div style={{ fontSize: 10, color: '#e7ccd2', marginTop: 2, letterSpacing: '.06em' }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Próximo partido */}
      {proximo ? (
        (() => {
          const rival = proximo.local === EQUIPO_NOMBRE ? proximo.visitante : proximo.local
          const cd = getCountdownLabel(proximo.fecha, proximo.hora, ahora)

          return (
            <section
              className="card anim-fade-up anim-delay-1"
              style={{
                marginBottom: '1rem',
                background: 'linear-gradient(135deg,#1e1216 0%,#7a1e30 100%)',
                color: 'white',
                borderColor: 'rgba(240,192,64,.3)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: '#f6d17a', fontWeight: 700 }}>
                  Próximo partido · {proximo.amistoso ? 'Amistoso' : `Jornada ${proximo.jornada ?? '-'}`}
                </div>
                <span
                  className="badge"
                  style={{
                    background: cd.pasado ? 'var(--danger)' : 'rgba(240,192,64,.2)',
                    color: cd.pasado ? '#fff' : '#ffe8a3',
                    fontWeight: 700,
                  }}
                >
                  {cd.label}
                </span>
              </div>

              {/* Escudos enfrentados */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <img src="/escudo.png" alt="Tejera" style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }} />
                <div style={{ fontFamily: 'Bebas Neue', fontSize: 28, color: 'white', flex: 1 }}>
                  vs. {rival || 'Rival pendiente'}
                </div>
                {proximo.escudo_rival_url ? (
                  <img src={proximo.escudo_rival_url} alt={rival} style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontFamily: 'Bebas Neue', fontSize: 15, color: 'rgba(255,255,255,0.4)' }}>
                      {rival ? rival.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
                    </span>
                  </div>
                )}
              </div>

              {!cd.pasado && cd.dias > 0 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontFamily: 'Bebas Neue', fontSize: 48, color: 'var(--dorado-light)', lineHeight: 1 }}>
                    {cd.dias}
                  </span>
                  <span style={{ fontSize: 14, color: '#f0d6db' }}>días</span>
                  {cd.horas > 0 && (
                    <>
                      <span style={{ fontFamily: 'Bebas Neue', fontSize: 30, color: '#f7e2a6', lineHeight: 1 }}>{cd.horas}</span>
                      <span style={{ fontSize: 12, color: '#f0d6db' }}>h</span>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#f6dfe4' }}>
                <span>📅 {formatFecha(proximo.fecha)}</span>
                <span>⏰ {proximo.hora || '--:--'}</span>
                <span>📍 {proximo.campo || 'Campo pendiente'}</span>
              </div>
            </section>
          )
        })()
      ) : (
        <section className="card anim-fade-up anim-delay-1" style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: 20, color: 'var(--verde)', marginBottom: 8 }}>Próximo partido</h2>
          <p style={{ color: 'var(--gris-mid)' }}>Aún no hay partidos próximos programados.</p>
        </section>
      )}

      {/* Métricas */}
      <section className="grid-4 anim-fade-up anim-delay-2" style={{ marginBottom: '1rem' }}>
        {[
          ['Goles', totalGoles, `${pjReal} jornadas`],
          ['Victorias', pgReal, `de ${pjReal} jugados`],
          ['Goleador', goleador?.goles ?? 0, goleador?.nombre?.split(' ')[0] || '-'],
          ['Asistente', asistente?.asistencias ?? 0, asistente?.nombre?.split(' ')[0] || '-'],
        ].map(([label, value, sub]) => (
          <article key={label} className="metric-card">
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-sub">{sub}</div>
          </article>
        ))}
      </section>

      {/* Últimos partidos */}
      <section className="card anim-fade-up anim-delay-3" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, color: 'var(--verde)' }}>Últimos partidos</h2>
          <button
            onClick={() => nav('/partidos')}
            style={{ background: 'none', border: 'none', color: 'var(--verde-mid)', fontSize: 13, fontWeight: 700 }}
          >
            Ver todos →
          </button>
        </div>

        {!ultimos.length ? (
          <p style={{ color: 'var(--gris-mid)' }}>Todavía no hay partidos jugados.</p>
        ) : (
          ultimos.map((p, i) => {
            const r = resultadoPartido(p)
            const rival = p.local === EQUIPO_NOMBRE ? p.visitante : p.local

            return (
              <div
                key={p.id}
                onClick={() => nav(`/partido/${p.id}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 0',
                  borderBottom: i < ultimos.length - 1 ? '1px solid #f5e8eb' : 'none',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 36,
                    borderRadius: 2,
                    flexShrink: 0,
                    background:
                      r === 'victoria'
                        ? '#22a05a'
                        : r === 'derrota'
                          ? '#c0392b'
                          : '#e0a020',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>vs. {rival || 'Rival pendiente'}</div>
                  <div style={{ fontSize: 11, color: 'var(--gris-mid)' }}>
                    {p.amistoso ? 'Amistoso' : `Jornada ${p.jornada ?? '-'}`} · {formatFecha(p.fecha)} · {p.hora || '--:--'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="score-box">
                    {p.goles_local ?? 0}–{p.goles_visitante ?? 0}
                  </span>
                  <span className={`tag-${r}`}>{r === 'victoria' ? 'V' : r === 'derrota' ? 'D' : 'E'}</span>
                </div>
              </div>
            )
          })
        )}
      </section>

      {/* Top goleadores */}
      <section className="card anim-fade-up anim-delay-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, color: 'var(--verde)' }}>Top goleadores</h2>
          <button
            onClick={() => nav('/estadisticas')}
            style={{ background: 'none', border: 'none', color: 'var(--verde-mid)', fontSize: 13, fontWeight: 700 }}
          >
            Ver todos →
          </button>
        </div>

        {!topGoleadores.length ? (
          <p style={{ color: 'var(--gris-mid)' }}>Aún no hay goles registrados en competición.</p>
        ) : (
          topGoleadores.map((j, i) => (
            <div
              key={j.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0',
                borderBottom: i < topGoleadores.length - 1 ? '1px solid #f5e8eb' : 'none',
              }}
            >
              <div
                style={{
                  fontFamily: 'Bebas Neue',
                  fontSize: 18,
                  color: ['#c8a800', '#909090', '#a06030', '#ddd'][i] || '#ccc',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {i + 1}
              </div>
              <Avatar jugador={j} size="sm" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{j.nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--gris-mid)' }}>{j.posicion || '—'}</div>
              </div>
              <div className="bar-wrap" style={{ maxWidth: 70 }}>
                <div className="bar-fill" style={{ width: `${Math.round(((j.goles || 0) / maxGoles) * 100)}%` }} />
              </div>
              <div
                style={{
                  fontFamily: 'Bebas Neue',
                  fontSize: 22,
                  color: 'var(--verde)',
                  minWidth: 24,
                  textAlign: 'right',
                }}
              >
                {j.goles || 0}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}