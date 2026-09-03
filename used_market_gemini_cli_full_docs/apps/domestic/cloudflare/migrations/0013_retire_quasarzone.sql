-- Keep historical Quasarzone rows for audit/recovery, but remove them from the public projection.
UPDATE listings
SET active = 0,
    lifecycle_status = 'REMOVED',
    price_eligible = 0,
    statistics_eligible = 0,
    exclusion_reasons_json = '["SOURCE_REMOVED:quasarzone"]',
    statistics_exclusion_reasons_json = '["SOURCE_REMOVED:quasarzone"]'
WHERE LOWER(site) = 'quasarzone';

-- Older publications can still contain Quasarzone in their by_source JSON.
-- Remove those stale public rows and keep the active publication manifest
-- internally consistent so the next publication can proceed normally.
DELETE FROM public_product_stats
WHERE LOWER(stats_json) LIKE '%quasarzone%';

UPDATE public_stats_publications
SET expected_row_count = (
      SELECT COUNT(*) FROM public_product_stats
       WHERE publication_id = public_stats_publications.publication_id
    ),
    expected_non_empty_scope_count = (
      SELECT COUNT(*) FROM public_product_stats
       WHERE publication_id = public_stats_publications.publication_id
         AND (
           COALESCE(json_extract(stats_json, '$.active.sample_count'), 0)
           + COALESCE(json_extract(stats_json, '$.reserved.sample_count'), 0)
           + COALESCE(json_extract(stats_json, '$.sold.sample_count'), 0)
           + COALESCE(json_extract(stats_json, '$.confirmed_transactions.sample_count'), 0)
         ) > 0
    )
WHERE active = 1;
