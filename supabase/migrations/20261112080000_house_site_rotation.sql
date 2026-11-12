-- The site data was georeferenced from a slightly skewed outline of the
-- house, so neighbours, roads, terrain and north sat 3.4° off the house.
-- The viewer turns the site around the house by siteRotationDeg
-- (src/haus/siteRotation.js); 3.4° makes the nearest neighbour (NO, ~20 m)
-- parallel to the house, as it is in reality.
update public.house_context
set data = jsonb_set(data::jsonb, '{siteRotationDeg}', '3.4'::jsonb)::json,
    updated_at = now()
where id = 'site';
