CREATE TABLE "telegram_identities" (
    "telegram_user_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "username" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "telegram_identities_pkey" PRIMARY KEY ("telegram_user_id")
);

CREATE TABLE "telegram_orders" (
    "order_id" UUID NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_notified_at" TIMESTAMPTZ(3),
    "fulfilled_notified_at" TIMESTAMPTZ(3),
    CONSTRAINT "telegram_orders_pkey" PRIMARY KEY ("order_id")
);

CREATE TABLE "telegram_bot_updates" (
    "update_id" BIGINT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_bot_updates_pkey" PRIMARY KEY ("update_id")
);

CREATE INDEX "telegram_orders_telegram_user_id_created_at_idx"
    ON "telegram_orders"("telegram_user_id", "created_at" DESC);

ALTER TABLE "telegram_orders"
    ADD CONSTRAINT "telegram_orders_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "telegram_orders"
    ADD CONSTRAINT "telegram_orders_telegram_user_id_fkey"
    FOREIGN KEY ("telegram_user_id") REFERENCES "telegram_identities"("telegram_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
