-- ============================================================================
-- Nunca puede haber dos temporadas en curso a la vez.
-- Cerrar y empezar temporada son ahora acciones separadas: este indice impide
-- empezar una nueva si la anterior sigue activa. Puede haber cero activas
-- (entre temporadas).
-- Falla si ahora mismo hay mas de una activa: corrigelo antes de ejecutarla.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS temporadas_una_activa
  ON public.temporadas (activa)
  WHERE activa;
