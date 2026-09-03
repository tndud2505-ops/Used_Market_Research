UPDATE listings
SET active = 0
WHERE site = 'ebay'
  AND item_id LIKE 'ebay:http%';
