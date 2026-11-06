// Supabase Edge Function: send-push
// Usa web-push via esm.sh para cifrado correcto en todos los navegadores incluyendo iOS

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sesion-token',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // tipo: 'portada' | 'resultado'
    const { tipo, titulo, imagen_url, partido_id, rival, resultado } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Solo puede enviar notificaciones quien tenga una sesion valida
    const token = req.headers.get('x-sesion-token')
    const { data: sesion } = token
      ? await supabase.rpc('validar_sesion', { p_token: token })
      : { data: null }
    if (!sesion?.valida) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@tejerabalompie.com'

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

    const { data: subs, error } = await supabase.from('push_subscriptions').select('*')
    if (error) throw error
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Construir payload según el tipo
    let payload: string
    if (tipo === 'resultado') {
      payload = JSON.stringify({
        title: `⚽ Resultado: vs ${rival}`,
        body: `${resultado} · ¡Vota al MVP del partido!`,
        icon: '/escudo.png',
        badge: '/escudo.png',
        url: partido_id ? `/partido/${partido_id}` : '/',
      })
    } else {
      // tipo === 'portada' (default)
      payload = JSON.stringify({
        title: '📰 Nueva portada',
        body: titulo,
        icon: '/escudo.png',
        badge: '/escudo.png',
        image: imagen_url || undefined,
        url: '/noticias',
      })
    }

    let sent = 0
    const toDelete: string[] = []

    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 86400 }
        )
        sent++
      } catch (e: any) {
        console.error(`Error enviando a ${sub.endpoint.substring(0, 50)}:`, e?.statusCode, e?.body)
        if (e?.statusCode === 410 || e?.statusCode === 404) {
          toDelete.push(sub.id)
        }
      }
    }))

    if (toDelete.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', toDelete)
    }

    console.log(`[${tipo}] Enviadas: ${sent}, eliminadas: ${toDelete.length}`)

    return new Response(JSON.stringify({ sent, deleted: toDelete.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error general:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
