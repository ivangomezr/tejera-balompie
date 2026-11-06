-- ============================================================================
-- Permisos reales: escribir exige una sesion valida
-- ----------------------------------------------------------------------------
-- El cliente envia el token de iniciar_sesion en la cabecera x-sesion-token y
-- las politicas RLS lo comprueban contra privado.sesiones.
--
--   Lectura publica ......... jugadores, partidos, estadisticas, clasificacion,
--                             alineaciones, noticias, patrocinadores, temporadas,
--                             votos_mvp, comentarios
--   Cualquier sesion ........ escribir en esas tablas (igual que el panel actual)
--   Solo superadmin ......... escribir en temporadas, leer activity_log
--   Solo el propio jugador .. crear y borrar su voto; registrar su actividad
--   Nadie desde la API ...... push_subscriptions (solo mediante funciones) y
--                             escribir en comentarios (la app no lo usa)
--
-- REQUISITO: publicar antes el frontend que envia la cabecera.
-- Para deshacer: supabase/rollback/20261106120000_rls_sesion_deshacer.sql
-- ============================================================================

BEGIN;

-- ---- Quien hace la peticion -------------------------------------------------

CREATE OR REPLACE FUNCTION public.sesion_rol()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.rol
  FROM privado.sesiones s
  WHERE s.expira_en > now()
    AND s.token_hash = encode(extensions.digest(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-sesion-token',
      'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.sesion_jugador_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.jugador_id
  FROM privado.sesiones s
  WHERE s.expira_en > now()
    AND s.token_hash = encode(extensions.digest(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-sesion-token',
      'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.sesion_rol()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sesion_jugador_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sesion_rol()        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sesion_jugador_id() TO anon, authenticated;

-- send-push valida la sesion con la service role.
GRANT EXECUTE ON FUNCTION public.validar_sesion(text) TO service_role;

-- ---- Quitar todas las politicas actuales -------------------------------------
-- Se borran por tabla y no por nombre: produccion puede tener alguna mas.

DO $migracion$
DECLARE
  v_politica record;
BEGIN
  FOR v_politica IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('activity_log', 'alineaciones', 'clasificacion', 'comentarios',
                        'estadisticas', 'jugadores', 'noticias', 'partidos',
                        'patrocinadores', 'push_subscriptions', 'temporadas', 'votos_mvp')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_politica.policyname, v_politica.tablename);
  END LOOP;
END
$migracion$;

-- ---- Tablas de la app: leer todos, escribir con sesion ------------------------

DO $migracion$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['alineaciones', 'clasificacion', 'estadisticas', 'jugadores',
                                 'noticias', 'partidos', 'patrocinadores']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabla);
    EXECUTE format('CREATE POLICY lectura_publica ON public.%I FOR SELECT TO anon, authenticated USING (true)', v_tabla);
    EXECUTE format('CREATE POLICY crear_con_sesion ON public.%I FOR INSERT TO anon, authenticated WITH CHECK ((SELECT public.sesion_rol()) IS NOT NULL)', v_tabla);
    EXECUTE format('CREATE POLICY editar_con_sesion ON public.%I FOR UPDATE TO anon, authenticated USING ((SELECT public.sesion_rol()) IS NOT NULL) WITH CHECK ((SELECT public.sesion_rol()) IS NOT NULL)', v_tabla);
    EXECUTE format('CREATE POLICY borrar_con_sesion ON public.%I FOR DELETE TO anon, authenticated USING ((SELECT public.sesion_rol()) IS NOT NULL)', v_tabla);
  END LOOP;
END
$migracion$;

-- ---- Temporadas: solo el superadmin las modifica ------------------------------

ALTER TABLE public.temporadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_publica ON public.temporadas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY crear_superadmin ON public.temporadas FOR INSERT TO anon, authenticated
  WITH CHECK ((SELECT public.sesion_rol()) = 'superadmin');
CREATE POLICY editar_superadmin ON public.temporadas FOR UPDATE TO anon, authenticated
  USING ((SELECT public.sesion_rol()) = 'superadmin')
  WITH CHECK ((SELECT public.sesion_rol()) = 'superadmin');
CREATE POLICY borrar_superadmin ON public.temporadas FOR DELETE TO anon, authenticated
  USING ((SELECT public.sesion_rol()) = 'superadmin');

-- ---- Votos: cada jugador solo crea y borra el suyo -----------------------------

ALTER TABLE public.votos_mvp ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_publica ON public.votos_mvp FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY crear_voto_propio ON public.votos_mvp FOR INSERT TO anon, authenticated
  WITH CHECK (votante_id = (SELECT public.sesion_jugador_id()));
CREATE POLICY borrar_voto_propio ON public.votos_mvp FOR DELETE TO anon, authenticated
  USING (votante_id = (SELECT public.sesion_jugador_id()));

-- ---- Log: lo lee el superadmin; cada sesion solo registra lo suyo ---------------

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY leer_superadmin ON public.activity_log FOR SELECT TO anon, authenticated
  USING ((SELECT public.sesion_rol()) = 'superadmin');
CREATE POLICY registrar_propio ON public.activity_log FOR INSERT TO anon, authenticated
  WITH CHECK (jugador_id = (SELECT public.sesion_jugador_id()));

-- ---- Comentarios: la app no los usa; se mantiene solo la lectura ----------------

ALTER TABLE public.comentarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY lectura_publica ON public.comentarios FOR SELECT TO anon, authenticated USING (true);

-- ---- Suscripciones push: contienen claves y no deben poder leerse ---------------

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_subscriptions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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

-- Hay que conocer el endpoint, que no es adivinable, para poder borrarlo.
CREATE OR REPLACE FUNCTION public.borrar_suscripcion_push(p_endpoint text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
$$;

REVOKE ALL ON FUNCTION public.guardar_suscripcion_push(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.borrar_suscripcion_push(text)              FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_suscripcion_push(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.borrar_suscripcion_push(text)              TO anon, authenticated;

-- ---- Permisos que RLS no cubre ----------------------------------------------------
-- RLS no se aplica a TRUNCATE. La vista se escribia a traves de estadisticas.

DO $migracion$
DECLARE
  v_tabla text;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['activity_log', 'alineaciones', 'clasificacion', 'comentarios',
                                 'estadisticas', 'jugadores', 'noticias', 'partidos',
                                 'patrocinadores', 'temporadas', 'votos_mvp']
  LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, authenticated', v_tabla);
  END LOOP;
END
$migracion$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.stats_jugadores FROM anon, authenticated;

-- ---- Storage: la app ya usa Cloudinary; se quitan las escrituras publicas ----------
-- Se conservan las lecturas para las imagenes antiguas. Si no hubiera permiso para
-- tocar storage, se avisa y el resto de la migracion sigue adelante.

DO $migracion$
DECLARE
  v_politica record;
BEGIN
  FOR v_politica IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', v_politica.policyname);
  END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'No se han podido quitar las politicas de escritura de storage.objects';
END
$migracion$;

COMMIT;
