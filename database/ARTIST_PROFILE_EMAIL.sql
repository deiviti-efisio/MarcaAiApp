-- E-mail de contato no perfil público do artista.
-- Só aparece se show_email = true.
-- Execute no SQL Editor do Supabase.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS show_email boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.artists.email IS 'E-mail de contato do artista.';
COMMENT ON COLUMN public.artists.show_email IS
  'Se true, o e-mail pode ser exibido no perfil público.';

DROP FUNCTION IF EXISTS public.get_artist_public_profile(uuid);

CREATE FUNCTION public.get_artist_public_profile(p_artist_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  musical_style text,
  profile_url text,
  cover_url text,
  bio text,
  city text,
  state text,
  work_roles jsonb,
  show_formats jsonb,
  social_links jsonb,
  whatsapp text,
  show_whatsapp boolean,
  email text,
  show_email boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    a.id,
    a.name,
    a.musical_style,
    NULLIF(trim(COALESCE(a.profile_url, '')), ''),
    NULLIF(trim(COALESCE(a.cover_url, '')), ''),
    NULLIF(trim(COALESCE(a.bio, '')), ''),
    NULLIF(trim(COALESCE(a.city, '')), ''),
    NULLIF(trim(COALESCE(a.state, '')), ''),
    COALESCE(a.work_roles, '[]'::jsonb),
    COALESCE(a.show_formats, '[]'::jsonb),
    COALESCE(a.social_links, '{}'::jsonb),
    CASE
      WHEN COALESCE(a.show_whatsapp, false)
        THEN NULLIF(trim(COALESCE(a.whatsapp, '')), '')
      ELSE NULL
    END,
    COALESCE(a.show_whatsapp, false),
    CASE
      WHEN COALESCE(a.show_email, false)
        THEN NULLIF(trim(COALESCE(a.email, '')), '')
      ELSE NULL
    END,
    COALESCE(a.show_email, false)
  FROM public.artists a
  WHERE a.id = p_artist_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_artist_public_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_artist_public_profile(uuid) TO service_role;
