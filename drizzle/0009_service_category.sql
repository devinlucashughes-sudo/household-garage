ALTER TABLE `service_records` ADD `category` text DEFAULT 'maintenance' NOT NULL;--> statement-breakpoint
-- Sort the records saved before categories existed. Same words and order as guessCategory in src/lib/cost-categories.ts.
UPDATE `service_records` SET `category` = CASE
	WHEN lower(`title`) LIKE '%oil change%' OR lower(`title`) LIKE '%oil and filter%' THEN 'oil'
	WHEN lower(`title`) LIKE '%body%' OR lower(`title`) LIKE '%dent%' OR lower(`title`) LIKE '%paint%' OR lower(`title`) LIKE '%bumper%'
		OR lower(`title`) LIKE '%fender%' OR lower(`title`) LIKE '%scratch%' OR lower(`title`) LIKE '%collision%' THEN 'body'
	WHEN lower(`title`) LIKE '%tire%' OR lower(`title`) LIKE '%tread%' OR lower(`title`) LIKE '%alignment%' THEN 'tires'
	WHEN lower(`title`) LIKE '%repair%' OR lower(`title`) LIKE '%diagnos%' OR lower(`title`) LIKE '%check-engine%' OR lower(`title`) LIKE '%check engine%'
		OR lower(`title`) LIKE '%leak%' OR lower(`title`) LIKE '%sensor%' OR lower(`title`) LIKE '%module%' OR lower(`title`) LIKE '%booster%'
		OR lower(`title`) LIKE '%master cylinder%' OR lower(`title`) LIKE '%water pump%' OR lower(`title`) LIKE '%radiator%'
		OR lower(`title`) LIKE '%drain plug%' OR lower(`title`) LIKE '%warranty%' OR lower(`title`) LIKE '%transmission%' THEN 'repairs'
	ELSE 'maintenance'
END;
