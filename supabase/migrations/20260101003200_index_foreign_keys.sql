-- ─────────────────────────────────────────────────────────────────────────────
-- DatumPro — cover every foreign key with an index
--
-- The performance advisor flagged 98 foreign keys without a covering index.
-- Unindexed FKs make joins, cascades, and RLS predicates that filter on the FK
-- column do sequential scans — fine at demo size, expensive at scale. This block
-- self-detects any FK whose columns aren't the prefix of some index and creates
-- one. Idempotent: re-running is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    with fk as (
      select c.conrelid,
        c.conrelid::regclass::text as tbl,
        c.conkey::smallint[] as fkcols,
        (select string_agg(quote_ident(a.attname), ', ' order by x.n)
         from unnest(c.conkey) with ordinality x(attnum,n)
         join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.attnum) as collist,
        (select string_agg(a.attname, '_' order by x.n)
         from unnest(c.conkey) with ordinality x(attnum,n)
         join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.attnum) as colnames
      from pg_constraint c
      where c.contype='f' and c.connamespace='public'::regnamespace
    ),
    idx as (
      select i.indrelid, string_to_array(i.indkey::text,' ')::smallint[] as cols from pg_index i
    )
    select format('create index if not exists %I on %s (%s);',
             left('ix_'||regexp_replace(fk.tbl,'.*\.','')||'_'||fk.colnames, 63), fk.tbl, fk.collist) as ddl
    from fk
    where not exists (
      select 1 from idx where idx.indrelid=fk.conrelid
        and idx.cols[1:array_length(fk.fkcols,1)] = fk.fkcols
    )
  loop
    execute r.ddl;
  end loop;
end $$;
