ALTER TABLE "poles" DROP CONSTRAINT "poles_height_valid";
--> statement-breakpoint
ALTER TABLE "poles" ADD CONSTRAINT "poles_height_valid" CHECK ("height_m" IN (7, 9));
