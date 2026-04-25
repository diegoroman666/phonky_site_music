// ============================================================================
// EDGE FUNCTION: notify-subscribers
// Envía email a TODOS los suscriptores con info del track recién agregado.
// Solo el manager autenticado puede invocarla.
// Requiere variable de entorno RESEND_API_KEY (configurar en Supabase secrets).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY              = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL                = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY           = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MANAGER_EMAIL               = '25reid88@gmail.com'
const SITE_URL                    = 'https://phonky-4-u.netlify.app'
const FROM_ADDRESS                = 'Phonky 4 U <onboarding@resend.dev>'  // sender de prueba de Resend

const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function buildEmailHTML(track: any): string {
    return `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#050505;">
  <div style="max-width:600px;margin:0 auto;background:#0a0a0a;border:1px solid #ff003c;padding:24px;font-family:'Courier New',monospace;color:#e0e0e0;">
    <h1 style="color:#ff003c;font-size:28px;letter-spacing:3px;margin:0 0 16px;text-align:center;">
      ⚡ NUEVA PISTA EN PHONKY ⚡
    </h1>
    <h2 style="color:#8a2be2;margin:8px 0;">${track.name || 'Artista'}</h2>
    <p style="color:#00ff41;font-size:18px;margin:4px 0;">🎵 ${track.song || ''}</p>
    <p style="color:#aaa;font-size:14px;margin:4px 0 20px;">💿 ${track.album || 'Single'}</p>
    ${track.img ? `<img src="${track.img}" alt="${track.name}" style="width:100%;max-width:560px;border:1px solid #333;border-radius:4px;display:block;margin:0 auto 20px;">` : ''}
    <p style="color:#ccc;line-height:1.6;font-size:14px;">${track.bio || ''}</p>
    <div style="text-align:center;margin-top:30px;">
      <a href="${SITE_URL}" style="display:inline-block;background:#ff003c;color:#000;padding:14px 28px;text-decoration:none;font-weight:bold;letter-spacing:2px;border-radius:4px;">
        ▶ ESCUCHAR EN EL SITIO
      </a>
    </div>
    <p style="text-align:center;color:#666;font-size:11px;margin-top:30px;border-top:1px solid #222;padding-top:15px;">
      Recibes este email porque te suscribiste en ${SITE_URL}
    </p>
  </div>
</body></html>`
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        if (!RESEND_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'RESEND_API_KEY no configurada en Supabase secrets' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Validar que el caller sea el manager
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Falta Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } }
        })
        const { data: { user }, error: userErr } = await userClient.auth.getUser()
        if (userErr || user?.email !== MANAGER_EMAIL) {
            return new Response(
                JSON.stringify({ error: 'Solo el manager puede notificar' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { track_id } = await req.json()
        if (!track_id) {
            return new Response(
                JSON.stringify({ error: 'Falta track_id' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Service role para bypass RLS
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // Obtener track
        const { data: track, error: trackErr } = await adminClient
            .from('tracks').select('*').eq('id', track_id).single()
        if (trackErr || !track) {
            return new Response(
                JSON.stringify({ error: 'Track no encontrado: ' + (trackErr?.message || 'unknown') }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Obtener todos los suscriptores
        const { data: subs, error: subsErr } = await adminClient
            .from('subscribers').select('email')
        if (subsErr) throw subsErr
        if (!subs || subs.length === 0) {
            return new Response(
                JSON.stringify({ sent: 0, total: 0, message: 'No hay suscriptores' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const emails  = subs.map(s => s.email)
        const subject = `🎵 Nueva pista en Phonky: ${track.name} - ${track.song}`
        const html    = buildEmailHTML(track)

        // Enviar emails en paralelo
        const results = await Promise.allSettled(
            emails.map(email =>
                fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${RESEND_API_KEY}`,
                        'Content-Type':  'application/json'
                    },
                    body: JSON.stringify({
                        from:    FROM_ADDRESS,
                        to:      email,
                        subject: subject,
                        html:    html
                    })
                }).then(r => r.ok ? r.json() : Promise.reject(r.statusText))
            )
        )

        const sent   = results.filter(r => r.status === 'fulfilled').length
        const failed = results.length - sent
        const errors = results
            .map((r, i) => r.status === 'rejected' ? { email: emails[i], reason: String((r as any).reason) } : null)
            .filter(Boolean)

        return new Response(
            JSON.stringify({ sent, failed, total: emails.length, errors }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (e) {
        return new Response(
            JSON.stringify({ error: (e as Error).message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
