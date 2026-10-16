alter table public.games add column view text not null default '2d' check (view in ('2d', '3d', 'isometric'));
