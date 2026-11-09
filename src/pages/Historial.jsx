import { useState, useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { EQUIPO_NOMBRE } from '../lib/mockData'

// Mismo criterio que Inicio: la tanda de penaltis decide los empates
function resultadoPartido(p) {
    const esLocal = p.local === EQUIPO_NOMBRE
    const nuestros = esLocal ? p.goles_local : p.goles_visitante
    const rival = esLocal ? p.goles_visitante : p.goles_local
    if (nuestros > rival) return 'victoria'
    if (nuestros < rival) return 'derrota'
    if (!p.penaltis) return 'empate'
    const np = esLocal ? p.goles_penaltis_local : p.goles_penaltis_visitante
    const rp = esLocal ? p.goles_penaltis_visitante : p.goles_penaltis_local
    return np > rp ? 'victoria' : 'derrota'
}

// Resumen de una temporada sin amistosos (no cuentan ni sus partidos ni sus estadísticas)
function resumenTemporada(datos, jugadores) {
    const oficiales = datos.partidos.filter(p => !p.amistoso && (p.local === EQUIPO_NOMBRE || p.visitante === EQUIPO_NOMBRE))
    const jugados = oficiales.filter(p => p.jugado)
    const idsOficiales = new Set(oficiales.map(p => p.id))
    const stats = datos.stats.filter(s => idsOficiales.has(s.partido_id))

    const porJugador = {}
    for (const s of stats) {
        const j = porJugador[s.jugador_id] ||= { jugador_id: s.jugador_id, partidos: 0, goles: 0, asistencias: 0, amarillas: 0, rojas: 0, encajados: 0 }
        j.partidos += 1
        j.goles += s.goles || 0
        j.asistencias += s.asistencias || 0
        j.amarillas += s.tarjetas_amarillas || 0
        j.rojas += s.tarjetas_rojas || 0
        j.encajados += s.goles_encajados || 0
    }
    const jugadorDe = (id) => jugadores.find(j => j.id === id)
    const filas = Object.values(porJugador).map(v => ({
        ...v,
        nombre: jugadorDe(v.jugador_id)?.nombre || 'Jugador eliminado',
        posicion: jugadorDe(v.jugador_id)?.posicion,
        tarjetas: v.amarillas + v.rojas,
    }))
    const top = (campo) => filas.filter(f => f[campo] > 0).sort((a, b) => b[campo] - a[campo] || a.nombre.localeCompare(b.nombre)).slice(0, 3)

    return {
        partidos: jugados.length,
        victorias: jugados.filter(p => resultadoPartido(p) === 'victoria').length,
        goles: stats.reduce((a, s) => a + (s.goles || 0), 0),
        goleadores: top('goles'),
        asistentes: top('asistencias'),
        tarjetas: top('tarjetas'),
        // Menos goles encajados; a igualdad, el que más partidos ha jugado
        porteros: filas.filter(f => f.posicion === 'Portero')
            .sort((a, b) => a.encajados - b.encajados || b.partidos - a.partidos)
            .slice(0, 3),
    }
}

function Ranking({ titulo, filas, valor }) {
    if (filas.length === 0) return null
    return (
        <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gris-mid)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                {titulo}
            </div>
            <div style={{ background: '#f7f2f3', borderRadius: 12, overflow: 'hidden' }}>
                {filas.map((j, i) => (
                    <div key={j.jugador_id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        borderBottom: i < filas.length - 1 ? '1px solid #f0e8ea' : 'none'
                    }}>
                        <div style={{ fontFamily: 'Bebas Neue', fontSize: 16, color: ['#c8991a', '#909090', '#a06030'][i], minWidth: 18 }}>{i + 1}</div>
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{j.nombre}</div>
                        <div style={{ fontSize: 13, color: 'var(--verde)', fontWeight: 700, whiteSpace: 'nowrap' }}>{valor(j)}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function Historial() {
    const { store, jugadores } = useStore()
    const [temporadas, setTemporadas] = useState([])
    const [seleccionada, setSeleccionada] = useState(null)
    const [datos, setDatos] = useState(null)
    const [cargando, setCargando] = useState(true)
    const [cargandoDatos, setCargandoDatos] = useState(false)

    useEffect(() => {
        store.getTemporadas().then(ts => {
            const pasadas = ts.filter(t => !t.activa)
            setTemporadas(pasadas)
            setCargando(false)
        })
    }, [])

    const verTemporada = async (t) => {
        if (seleccionada?.id === t.id) { setSeleccionada(null); setDatos(null); return }
        setSeleccionada(t)
        setCargandoDatos(true)
        const d = await store.getDatosTemporada(t.id)
        setDatos(d)
        setCargandoDatos(false)
    }

    if (cargando) return (
        <div className="page"><div className="empty">Cargando historial...</div></div>
    )

    if (temporadas.length === 0) return (
        <div className="page">
            <h1 className="page-title">Historial de Temporadas</h1>
            <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🏆</div>
                <div style={{ fontFamily: 'Bebas Neue', fontSize: 22, color: 'var(--verde)', marginBottom: 8 }}>
                    Primera temporada en curso
                </div>
                <div style={{ fontSize: 14, color: 'var(--gris-mid)' }}>
                    Aquí aparecerán las temporadas anteriores cuando se cierren.
                </div>
            </div>
        </div>
    )

    return (
        <div className="page">
            <h1 className="page-title">Historial</h1>

            {temporadas.map(t => {
                const abierta = seleccionada?.id === t.id
                const r = abierta && datos ? resumenTemporada(datos, jugadores) : null

                return (
                    <div key={t.id} className="card" style={{ marginBottom: '1rem', padding: 0, overflow: 'hidden' }}>
                        {/* Cabecera de temporada */}
                        <div
                            onClick={() => verTemporada(t)}
                            style={{
                                padding: '1rem 1.25rem', cursor: 'pointer',
                                background: abierta ? 'linear-gradient(135deg, #0d0a0b, #3d1020)' : 'white',
                                display: 'flex', alignItems: 'center', gap: 12
                            }}
                        >
                            <div style={{ fontSize: 32 }}>🏆</div>
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontFamily: 'Bebas Neue', fontSize: 20,
                                    color: abierta ? 'white' : 'var(--verde)', lineHeight: 1
                                }}>{t.nombre}</div>
                                <div style={{ fontSize: 12, color: abierta ? '#e8a0b0' : 'var(--gris-mid)', marginTop: 2 }}>
                                    Temporada {t.año} · Archivada
                                </div>
                            </div>
                            <div style={{ color: abierta ? '#e8a0b0' : 'var(--gris-light)', fontSize: 20 }}>
                                {abierta ? '▲' : '▼'}
                            </div>
                        </div>

                        {/* Contenido expandido */}
                        {abierta && (
                            <div style={{ padding: '1rem 1.25rem' }}>
                                {cargandoDatos ? (
                                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gris-mid)' }}>
                                        Cargando datos...
                                    </div>
                                ) : r ? (
                                    <>
                                        {/* Resumen (sin amistosos) */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 6 }}>
                                            {[
                                                ['Partidos', r.partidos, 'var(--verde)'],
                                                ['Victorias', r.victorias, 'var(--dorado)'],
                                                ['Goles', r.goles, 'var(--verde-mid)'],
                                            ].map(([l, v, c]) => (
                                                <div key={l} style={{ background: '#f7f2f3', borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
                                                    <div style={{ fontFamily: 'Bebas Neue', fontSize: 30, color: c, lineHeight: 1 }}>{v}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--gris-mid)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>{l}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--gris-mid)', textAlign: 'center', marginBottom: '1rem' }}>
                                            No se cuentan los amistosos
                                        </div>

                                        <Ranking titulo="Top goleadores" filas={r.goleadores} valor={j => `⚽ ${j.goles}`} />
                                        <Ranking titulo="Top asistentes" filas={r.asistentes} valor={j => `🅰️ ${j.asistencias}`} />
                                        <Ranking titulo="Más tarjetas" filas={r.tarjetas} valor={j => `🟨 ${j.amarillas}  🟥 ${j.rojas}`} />
                                        <Ranking
                                            titulo="Portero menos goleado"
                                            filas={r.porteros}
                                            valor={j => `${j.encajados} encajados · ${j.partidos} PJ`}
                                        />
                                    </>
                                ) : (
                                    <div className="empty">No hay datos para esta temporada</div>
                                )}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
