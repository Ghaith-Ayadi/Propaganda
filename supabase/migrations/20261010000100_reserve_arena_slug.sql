-- Reserve "arena": arena.propaganda.pub is the Arena app (docs/arena.md), so no site may take
-- that slug as its blog subdomain. Same list as 20261002000004 plus 'arena'. Additive: it only
-- changes which new or renamed slugs are accepted. A site that already has the slug 'arena'
-- keeps it; check before applying:
--   select id, name, slug from public.sites where slug = 'arena';

create or replace function private.valid_site_slug(s text) returns boolean
language sql immutable set search_path = '' as $$
  select s ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$'
     and substr(s, 3, 2) <> '--'
     and not s = any (array[
       -- in use: the editor and API, the marketing site, the custom-domain target, the Arena
       'app', 'www', 'api', 'domains', 'arena',
       -- mail and DNS
       'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns',
       -- hosts a platform tends to need
       'admin', 'assets', 'static', 'cdn', 'media', 'images', 'files', 'uploads',
       'blog', 'docs', 'help', 'support', 'status', 'community', 'developers', 'dev',
       'staging', 'preview', 'test', 'demo', 'beta', 'sandbox',
       'auth', 'login', 'logout', 'signup', 'signin', 'sso', 'oauth', 'account',
       'accounts', 'billing', 'pay', 'settings', 'dashboard', 'analytics',
       -- from the path-based addresses
       'about', 'new', 'site', 'sites', '_'])
$$;
