-- Preserve each previously selected hour as both of its half-hour slots.
UPDATE "Post"
SET "freeTimes" = ARRAY(
  SELECT DISTINCT hour_slot * 2 + half
  FROM unnest("freeTimes") AS hour_slot
  CROSS JOIN (VALUES (0), (1)) AS halves(half)
  ORDER BY 1
)
WHERE cardinality("freeTimes") > 0;

UPDATE "PostMember"
SET "freeTimes" = ARRAY(
  SELECT DISTINCT hour_slot * 2 + half
  FROM unnest("freeTimes") AS hour_slot
  CROSS JOIN (VALUES (0), (1)) AS halves(half)
  ORDER BY 1
)
WHERE cardinality("freeTimes") > 0;
