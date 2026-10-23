ALTER TABLE "authors" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamp(3) with time zone USING "updated_at"::timestamp(3) with time zone;