-- Execute este SQL no SQL Editor do seu projeto no Supabase (https://supabase.com/dashboard)

create table if not exists public.nmfc_ranking (
  id bigint generated always as identity primary key,
  nick text not null check (char_length(trim(nick)) between 1 and 18),
  character_name text not null check (char_length(trim(character_name)) between 1 and 24),
  score integer not null check (score > 0 and score <= 500),
  created_at timestamptz not null default now()
);

-- Índice para consultar o Top 15 instantaneamente
create index if not exists idx_nmfc_ranking_score_desc
  on public.nmfc_ranking (score desc, created_at asc);

-- Segurança (Row Level Security): todos podem ler e enviar novos placares válidos, ninguém pode apagar/editar
grant usage on schema public to anon, authenticated;
grant select, insert on table public.nmfc_ranking to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter table public.nmfc_ranking enable row level security;

drop policy if exists "Leitura publica do ranking" on public.nmfc_ranking;
create policy "Leitura publica do ranking"
  on public.nmfc_ranking
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Envio publico de pontuacao valida" on public.nmfc_ranking;
create policy "Envio publico de pontuacao valida"
  on public.nmfc_ranking
  for insert
  to anon, authenticated
  with check (
    score > 0
    and score <= 500
    and char_length(trim(nick)) between 1 and 18
    and char_length(trim(character_name)) between 1 and 24
  );

-- Habilita atualizações em tempo real (Realtime) para a tabela de ranking
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nmfc_ranking'
  ) then
    alter publication supabase_realtime add table public.nmfc_ranking;
  end if;
end $$;
