-- ============================================================================
-- DESHACE 20261106120000_rls_sesion.sql: VUELVE A ABRIR LAS ESCRITURAS A CUALQUIERA
-- Usalo solo si la web deja de funcionar, y por el menor tiempo posible.
-- No esta en migrations/: se ejecuta a mano en el SQL Editor.
-- No restaura las escrituras de storage ni TRUNCATE, porque la app no los usa.
-- ============================================================================

BEGIN;

DO $deshacer$
DECLARE
  v_politica record;
  v_tabla text;
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

  FOREACH v_tabla IN ARRAY ARRAY['alineaciones', 'clasificacion', 'comentarios', 'estadisticas',
                                 'jugadores', 'noticias', 'partidos', 'patrocinadores',
                                 'temporadas', 'votos_mvp']
  LOOP
    EXECUTE format('CREATE POLICY acceso_abierto ON public.%I USING (true) WITH CHECK (true)', v_tabla);
  END LOOP;
END
$deshacer$;

CREATE POLICY lectura_log ON public.activity_log FOR SELECT USING (true);
CREATE POLICY insertar_log ON public.activity_log FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT, DELETE ON TABLE public.push_subscriptions TO anon, authenticated;
CREATE POLICY leer_suscripciones ON public.push_subscriptions FOR SELECT USING (true);
CREATE POLICY insertar_suscripcion ON public.push_subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY borrar_suscripcion ON public.push_subscriptions FOR DELETE USING (true);

COMMIT;
