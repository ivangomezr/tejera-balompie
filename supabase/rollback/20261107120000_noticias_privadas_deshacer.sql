-- ============================================================================
-- DESHACE 20261107120000_noticias_privadas.sql: LAS NOTICIAS VUELVEN A SER PUBLICAS
-- Se ejecuta a mano en el SQL Editor. No restaura el listado de storage,
-- porque la app no lo usa.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS lectura_con_sesion ON public.noticias;
CREATE POLICY lectura_publica ON public.noticias FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_endpoint IS NULL OR length(p_endpoint) > 1000
     OR p_endpoint !~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com)/' THEN
    RAISE EXCEPTION 'Endpoint de push no valido';
  END IF;
  IF p_p256dh IS NULL OR length(p_p256dh) > 200 OR p_auth IS NULL OR length(p_auth) > 200 THEN
    RAISE EXCEPTION 'Claves de push no validas';
  END IF;

  INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, updated_at)
  VALUES (p_endpoint, p_p256dh, p_auth, now())
  ON CONFLICT (endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, updated_at = now();
END;
$$;

COMMIT;
