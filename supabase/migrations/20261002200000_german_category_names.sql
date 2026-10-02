-- The app is in German now: rename the built-in finance categories to
-- their German names, together with the transactions that use them.
-- Only the original English names are touched, so categories the family
-- added or renamed themselves stay as they are. A rename is skipped when
-- the German name already exists. Safe to run again.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('expense', 'Land & purchase costs', 'Grundstück & Kaufnebenkosten'),
      ('expense', 'Planning & permits', 'Planung & Genehmigungen'),
      ('expense', 'Shell construction', 'Rohbau'),
      ('expense', 'Roof', 'Dach'),
      ('expense', 'Windows & doors', 'Fenster & Türen'),
      ('expense', 'Building services', 'Haustechnik'),
      ('expense', 'Interior finishing', 'Innenausbau'),
      ('expense', 'Kitchen & furnishing', 'Küche & Einrichtung'),
      ('expense', 'Outdoor & landscaping', 'Außenanlagen & Garten'),
      ('expense', 'Fees & insurance', 'Gebühren & Versicherungen'),
      ('expense', 'Other', 'Sonstiges'),
      ('funding', 'Own funds', 'Eigenmittel'),
      ('funding', 'Bank loan', 'Bankkredit'),
      ('funding', 'Housing subsidy', 'Wohnbauförderung'),
      ('funding', 'Family / private loan', 'Familien- / Privatdarlehen'),
      ('funding', 'Other funding', 'Sonstige Finanzierung')
    ) as t(type, old_name, new_name)
  loop
    if exists (
      select 1 from public.finance_categories
      where type = r.type and name = r.old_name
    ) and not exists (
      select 1 from public.finance_categories
      where type = r.type and lower(name) = lower(r.new_name)
    ) then
      update public.finance_categories
        set name = r.new_name
        where type = r.type and name = r.old_name;
      update public.transactions
        set category = r.new_name
        where type = r.type and category = r.old_name;
    end if;
  end loop;
end;
$$;
