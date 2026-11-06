-- ============================================================================
-- Noticias/portadas solo para quien tenga sesion
-- ----------------------------------------------------------------------------
-- * Leer public.noticias exige sesion (jugador, admin o superadmin).
-- * Suscribirse a notificaciones tambien: los avisos son del vestuario.
-- * Se quita la lectura de los buckets de noticias en storage.objects, que
--   permitia listar sus archivos. Las URL publicas antiguas siguen funcionando
--   para que no desaparezcan imagenes de la app: el bucket no pasa a privado.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS lectura_publica ON public.noticias;
DROP POLICY IF EXISTS lectura_con_sesion ON public.noticias;
CREATE POLICY lectura_con_sesion ON public.noticias FOR SELECT TO anon, authenticated
  USING ((SELECT public.sesion_rol()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.sesion_rol() IS NULL THEN
    RAISE EXCEPTION 'Hace falta iniciar sesion' USING ERRCODE = '42501';
  END IF;
  -- send-push hace peticiones a este endpoint: solo se aceptan servicios de push reales.
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

DO $migracion$
DECLARE
  v_politica record;
BEGIN
  FOR v_politica IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
      AND (qual ILIKE '%''noticias''%')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', v_politica.policyname);
  END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'No se ha podido quitar la lectura de noticias en storage.objects';
END
$migracion$;

COMMIT;
