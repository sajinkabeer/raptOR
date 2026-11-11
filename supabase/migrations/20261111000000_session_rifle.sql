-- Rifle used in a session: a make (Walther or Feinwerkbau, '' when not set) and a free-text rifle number such as R17.
alter table public.sessions add column rifle_make text not null default '';
alter table public.sessions add column rifle_no text not null default '';
