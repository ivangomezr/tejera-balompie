-- ============================================================================
-- Autenticacion en servidor para jugadores, admin y superadmin
-- ----------------------------------------------------------------------------
-- * Las credenciales y las sesiones pasan al esquema "privado", que PostgREST
--   no expone, con hashes bcrypt (crypt + gen_salt('bf', 10)).
-- * Los hashes de jugadores salen de public.jugadores, que anon puede leer y
--   modificar. Las claves actuales de jugadores siguen funcionando.
-- * El login, las sesiones de 8 h y el limite de 5 intentos se comprueban aqui.
-- * asignar_clave_jugador deja de ser ejecutable por anon/authenticated.
--
-- IMPORTANTE: esta migracion NO crea claves de admin/superadmin, porque el repo
-- es publico. Hasta ejecutar el script de rotacion no se puede entrar como admin.
--
-- Esta migracion NO restringe las escrituras de anon en las tablas de la app.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS privado;
REVOKE ALL ON SCHEMA privado FROM PUBLIC;
REVOKE ALL ON SCHEMA privado FROM anon, authenticated;

-- ---- Tablas ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS privado.credenciales_admin (
  rol            text PRIMARY KEY CHECK (rol IN ('admin', 'superadmin')),
  clave_hash     text NOT NULL,
  actualizada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privado.credenciales_jugador (
  jugador_id     integer PRIMARY KEY REFERENCES public.jugadores (id) ON DELETE CASCADE,
  clave_hash     text NOT NULL,
  actualizada_en timestamptz NOT NULL DEFAULT now()
);

-- Solo se guarda el SHA-256 del token: un volcado de la tabla no da sesiones validas.
CREATE TABLE IF NOT EXISTS privado.sesiones (
  token_hash text PRIMARY KEY,
  rol        text NOT NULL CHECK (rol IN ('jugador', 'admin', 'superadmin')),
  jugador_id integer REFERENCES public.jugadores (id) ON DELETE CASCADE,
  creada_en  timestamptz NOT NULL DEFAULT now(),
  expira_en  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_expira_en_idx ON privado.sesiones (expira_en);

CREATE TABLE IF NOT EXISTS privado.intentos_login (
  jugador_id      integer PRIMARY KEY REFERENCES public.jugadores (id) ON DELETE CASCADE,
  fallos          integer NOT NULL DEFAULT 0,
  ultimo_fallo    timestamptz NOT NULL DEFAULT now(),
  bloqueado_hasta timestamptz
);

ALTER TABLE privado.credenciales_admin   ENABLE ROW LEVEL SECURITY;
ALTER TABLE privado.credenciales_jugador ENABLE ROW LEVEL SECURITY;
ALTER TABLE privado.sesiones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE privado.intentos_login       ENABLE ROW LEVEL SECURITY;

-- ---- Sacar los hashes de jugadores de la tabla publica ------------------------

DO $migracion$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jugadores' AND column_name = 'clave_hash'
  ) THEN
    EXECUTE $sql$
      INSERT INTO privado.credenciales_jugador (jugador_id, clave_hash)
      SELECT id, clave_hash FROM public.jugadores WHERE clave_hash IS NOT NULL
      ON CONFLICT (jugador_id) DO NOTHING
    $sql$;
    ALTER TABLE public.jugadores DROP COLUMN clave_hash;
  END IF;
END
$migracion$;

-- Sustituida por iniciar_sesion: seguir exponiendola permitiria saltarse el limite de intentos.
DROP FUNCTION IF EXISTS public.validar_clave(integer, text);

-- ---- Asignacion de claves (solo desde SQL Editor o service_role) --------------

CREATE OR REPLACE FUNCTION public.asignar_clave_jugador(p_jugador_id integer, p_clave text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_clave IS NULL OR length(p_clave) < 8 THEN
    RAISE EXCEPTION 'La clave debe tener al menos 8 caracteres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jugadores WHERE id = p_jugador_id) THEN
    RAISE EXCEPTION 'No existe el jugador %', p_jugador_id;
  END IF;

  INSERT INTO privado.credenciales_jugador (jugador_id, clave_hash)
  VALUES (p_jugador_id, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)))
  ON CONFLICT (jugador_id) DO UPDATE
    SET clave_hash = EXCLUDED.clave_hash, actualizada_en = now();

  -- Al cambiar la clave se cierran las sesiones abiertas con la anterior.
  DELETE FROM privado.sesiones WHERE rol = 'jugador' AND jugador_id = p_jugador_id;
  DELETE FROM privado.intentos_login WHERE jugador_id = p_jugador_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.asignar_clave_admin(p_rol text, p_clave text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_rol NOT IN ('admin', 'superadmin') THEN
    RAISE EXCEPTION 'Rol no valido: %', p_rol;
  END IF;
  IF p_clave IS NULL OR length(p_clave) < 12 THEN
    RAISE EXCEPTION 'La clave debe tener al menos 12 caracteres';
  END IF;

  INSERT INTO privado.credenciales_admin (rol, clave_hash)
  VALUES (p_rol, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)))
  ON CONFLICT (rol) DO UPDATE
    SET clave_hash = EXCLUDED.clave_hash, actualizada_en = now();

  DELETE FROM privado.sesiones WHERE rol = p_rol;
END;
$$;

-- ---- Login -------------------------------------------------------------------
-- Devuelve jsonb y no lanza excepciones al fallar: una excepcion desharia la
-- transaccion y el fallo no quedaria contado.

CREATE OR REPLACE FUNCTION public.iniciar_sesion(p_jugador_id integer, p_clave text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_max_fallos CONSTANT integer  := 5;
  c_bloqueo    CONSTANT interval := interval '5 minutes';
  c_duracion   CONSTANT interval := interval '8 hours';
  v_intento    privado.intentos_login%ROWTYPE;
  v_fallos     integer;
  v_rol        text;
  v_token      text;
  v_expira     timestamptz;
BEGIN
  -- Solo se cuentan intentos sobre jugadores reales: asi no se puede crear un
  -- contador nuevo por cada id inventado para probar la clave de admin sin limite.
  IF p_clave IS NULL OR p_clave = '' OR length(p_clave) > 200
     OR NOT EXISTS (SELECT 1 FROM public.jugadores WHERE id = p_jugador_id) THEN
    RETURN jsonb_build_object('ok', false, 'bloqueado', false, 'max_fallos', c_max_fallos);
  END IF;

  -- Serializa los intentos por jugador para que no se pueda esquivar el limite en paralelo.
  PERFORM pg_advisory_xact_lock(hashtext('login'), p_jugador_id);

  DELETE FROM privado.sesiones WHERE expira_en <= now();

  SELECT * INTO v_intento FROM privado.intentos_login WHERE jugador_id = p_jugador_id;

  IF v_intento.bloqueado_hasta > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'bloqueado', true,
      'max_fallos', c_max_fallos,
      'reintentar_en', ceil(extract(epoch FROM v_intento.bloqueado_hasta - now()))::integer
    );
  END IF;

  SELECT c.rol INTO v_rol
  FROM privado.credenciales_admin c
  WHERE c.clave_hash = extensions.crypt(p_clave, c.clave_hash)
  ORDER BY c.rol = 'superadmin' DESC
  LIMIT 1;

  IF v_rol IS NULL AND EXISTS (
    SELECT 1 FROM privado.credenciales_jugador c
    WHERE c.jugador_id = p_jugador_id
      AND c.clave_hash = extensions.crypt(p_clave, c.clave_hash)
  ) THEN
    v_rol := 'jugador';
  END IF;

  IF v_rol IS NULL THEN
    -- Los fallos antiguos o de un bloqueo ya cumplido no acumulan.
    v_fallos := CASE
      WHEN v_intento.jugador_id IS NULL
        OR v_intento.bloqueado_hasta IS NOT NULL
        OR v_intento.ultimo_fallo < now() - c_bloqueo THEN 1
      ELSE v_intento.fallos + 1
    END;

    INSERT INTO privado.intentos_login AS i (jugador_id, fallos, ultimo_fallo, bloqueado_hasta)
    VALUES (
      p_jugador_id, v_fallos, now(),
      CASE WHEN v_fallos >= c_max_fallos THEN now() + c_bloqueo END
    )
    ON CONFLICT (jugador_id) DO UPDATE
      SET fallos = EXCLUDED.fallos,
          ultimo_fallo = EXCLUDED.ultimo_fallo,
          bloqueado_hasta = EXCLUDED.bloqueado_hasta;

    RETURN jsonb_build_object(
      'ok', false,
      'bloqueado', v_fallos >= c_max_fallos,
      'fallos', v_fallos,
      'max_fallos', c_max_fallos,
      'reintentar_en', CASE WHEN v_fallos >= c_max_fallos
                            THEN extract(epoch FROM c_bloqueo)::integer END
    );
  END IF;

  DELETE FROM privado.intentos_login WHERE jugador_id = p_jugador_id;

  v_token  := encode(extensions.gen_random_bytes(32), 'hex');
  v_expira := now() + c_duracion;

  INSERT INTO privado.sesiones (token_hash, rol, jugador_id, expira_en)
  VALUES (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_rol, p_jugador_id, v_expira);

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'rol', v_rol, 'expira_en', v_expira);
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_sesion(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sesion privado.sesiones%ROWTYPE;
BEGIN
  SELECT * INTO v_sesion
  FROM privado.sesiones
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    AND expira_en > now();

  IF v_sesion.token_hash IS NULL THEN
    RETURN jsonb_build_object('valida', false);
  END IF;

  RETURN jsonb_build_object(
    'valida', true,
    'rol', v_sesion.rol,
    'jugador_id', v_sesion.jugador_id,
    'expira_en', v_sesion.expira_en
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cerrar_sesion(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM privado.sesiones
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
$$;

-- ---- Permisos ------------------------------------------------------------------
-- Postgres concede EXECUTE a PUBLIC por defecto y este proyecto ademas tiene
-- default privileges que dan ALL a anon: hay que revocar de forma explicita.

REVOKE ALL ON FUNCTION public.asignar_clave_jugador(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asignar_clave_admin(text, text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.iniciar_sesion(integer, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_sesion(text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cerrar_sesion(text)                  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.iniciar_sesion(integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validar_sesion(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_sesion(text)           TO anon, authenticated;

COMMIT;
