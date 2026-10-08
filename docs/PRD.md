# PRODUCT REQUIREMENTS DOCUMENT
## Automated Robux Fulfillment Platform

**Version:** 1.0  
**Status:** Ready for Development  
**Product Type:** Automated Digital Goods Fulfillment Platform  
**Primary Model:** Direct-to-Customer Robux Fulfillment  
**Reference Product:** RBXGate — functionality and automation concept only  
**Frontend:** Next.js + TypeScript  
**Backend:** NestJS + TypeScript  
**Database:** PostgreSQL  
**Cache / Queue:** Redis + BullMQ  
**Deployment:** Nginx + PM2 / Docker-ready  

---

# 1. Product Vision

Platform ini adalah platform e-commerce digital yang menjual layanan top-up Robux secara otomatis kepada customer.

Platform **bukan marketplace** dan bukan platform bagi reseller.

Platform memiliki dan mengelola sendiri:

- katalog produk;
- harga jual;
- sumber saldo/fulfillment;
- order;
- pembayaran;
- fulfillment;
- retry;
- monitoring;
- customer support;
- profit;
- notification.

Tujuan utama:

> Customer dapat membeli Robux melalui website, melakukan pembayaran, dan mendapatkan fulfillment secara otomatis tanpa operator harus memproses setiap order secara manual.

Inspirasi fungsional berasal dari model automation platform seperti RBXGate, tetapi seluruh arsitektur, UI, database, business logic, dan codebase harus menjadi milik platform ini sendiri.

---

# 2. Product Principles

AI coding agent WAJIB mengikuti prinsip berikut:

1. **Automation-first**
2. **API-first**
3. **Queue-based fulfillment**
4. **Idempotent transaction**
5. **Auditability**
6. **Security-by-default**
7. **No credential persistence**
8. **No hard-coded business rules**
9. **Admin-configurable pricing**
10. **Provider/source abstraction**
11. **Failure must be recoverable**
12. **Never fulfill an order twice**
13. **Never trust frontend-calculated price**
14. **Database is the source of truth**
15. **Fulfillment must be independently retryable**

---

# 3. Business Model

Platform menjual beberapa produk Robux.

Contoh:

| Product | Robux | Method | Status |
|---|---:|---|---|
| Robux 80 | 80 | Instant | Active |
| Robux 500 | 500 | Instant | Active |
| Robux 1,000 | 1,000 | Instant | Active |
| Robux 2,000 | 2,000 | Instant | Active |
| Robux 5,000 | 5,000 | Instant | Optional |

Quantity dapat lebih dari 1.

Contoh:

```text
500 Robux × 3
=
1,500 Robux
```

Harga final harus dihitung backend.

---

# 4. Fulfillment Methods

Platform mendukung tiga kategori fulfillment secara arsitektural.

## 4.1 Instant Fulfillment

Customer membeli produk.

Flow:

```text
Customer
↓
Select Product
↓
Enter Roblox Identity
↓
Validate
↓
Checkout
↓
Payment
↓
Order PAID
↓
Fulfillment Queue
↓
Fulfillment Worker
↓
Authorized Provider / Source
↓
Verification
↓
SUCCESS
```

Target UX:

> Instan atau sedekat mungkin dengan instan sesuai kemampuan provider.

---

# 5. Account Authentication Requirement

Customer harus dapat mengidentifikasi/authorize akun Roblox yang menjadi target fulfillment.

Prioritas implementasi:

```text
Official Roblox authorization / supported authentication
```

atau mekanisme resmi lain yang tersedia untuk use case yang diimplementasikan.

Platform **TIDAK BOLEH**:

- menyimpan password Roblox customer;
- memasukkan password customer ke database;
- mencatat password di log;
- mengirim password ke analytics;
- memasukkan password ke Sentry;
- menyimpan credential customer di Redis;
- menyimpan credential customer di browser storage;
- menggunakan credential customer untuk automation yang tidak diotorisasi.

Jika suatu provider resmi memerlukan credential temporer:

```text
Request
↓
TLS
↓
Runtime memory
↓
Use
↓
Destroy
```

Credential tidak boleh menjadi persistent application data.

---

# 6. Customer Journey

## Step 1 — Landing Page

Customer masuk ke homepage.

Homepage harus langsung menjelaskan:

- apa yang dijual;
- harga;
- kecepatan fulfillment;
- metode fulfillment;
- keamanan;
- cara membeli.

Primary CTA:

```text
Buy Robux
```

Secondary CTA:

```text
Check Order
```

---

# 7. Product Selection

Customer melihat product cards.

Contoh:

```text
┌──────────────────────────────┐
│                              │
│       500 ROBUX              │
│                              │
│       ⚡ INSTANT             │
│                              │
│       Rp XX.XXX              │
│                              │
│       [-] 1 [+]              │
│                              │
│       [ BUY NOW ]            │
└──────────────────────────────┘
```

Product card wajib menampilkan:

- Robux amount;
- delivery method;
- price;
- availability;
- quantity;
- CTA.

---

# 8. Username / Account Validation

Customer memasukkan Roblox username atau menggunakan authorized account flow.

Frontend:

```text
Username
[ FajarGaming              ]

        ↓

Resolving account...

        ↓

✓ Account Found

Avatar
FajarGaming
Display Name
```

Backend melakukan validasi.

Frontend tidak boleh menentukan sendiri:

- user ID;
- account validity;
- price;
- fulfillment eligibility.

Semua harus diverifikasi backend.

---

# 9. Checkout

Checkout terdiri dari:

```text
01 Account
02 Order
03 Payment
04 Fulfillment
```

Desktop layout:

```text
┌────────────────────────────┬───────────────────────┐
│                            │                       │
│ Account                    │ Order Summary         │
│                            │                       │
│ Roblox Account             │ 500 Robux × 2         │
│                            │                       │
│ ✓ FajarGaming              │ Rp XX.XXX             │
│                            │                       │
│ Payment                    │ Discount              │
│                            │ Rp 0                  │
│ [ Payment Method ]         │                       │
│                            │ Total                 │
│                            │ Rp XX.XXX             │
│                            │                       │
│                            │ [ PAY NOW ]           │
└────────────────────────────┴───────────────────────┘
```

---

# 10. Order Creation

Frontend hanya mengirim:

```json
{
  "productId": "product-id",
  "quantity": 2,
  "recipient": {
    "username": "FajarGaming"
  },
  "fulfillmentMethod": "INSTANT"
}
```

Frontend **tidak boleh mengirim final price sebagai source of truth**.

Backend:

```text
productId
↓
database
↓
product
↓
current pricing
↓
promotion
↓
quantity
↓
tax/fee if applicable
↓
final amount
```

---

# 11. Order Number

Setiap order harus memiliki human-readable order number.

Format:

```text
RBX-YYYYMMDD-XXXXX
```

Contoh:

```text
RBX-20261005-00001
```

UUID tetap digunakan sebagai primary key internal.

---

# 12. Order State Machine

Order wajib menggunakan state machine.

## Normal flow

```text
CREATED
↓
PAYMENT_PENDING
↓
PAID
↓
QUEUED
↓
PROCESSING
↓
FULFILLMENT_PENDING
↓
FULFILLED
```

## Failure

```text
PROCESSING
↓
FAILED
↓
RETRYING
↓
PROCESSING
```

## Permanent failure

```text
FAILED
↓
FAILED_PERMANENTLY
```

## Refund

```text
PAID
↓
REFUND_PENDING
↓
REFUNDED
```

## Partial fulfillment

```text
PROCESSING
↓
PARTIALLY_FULFILLED
↓
REMAINING_FULFILLMENT
↓
FULFILLED
```

---

# 13. Payment Flow

Payment harus dianggap berhasil hanya setelah backend menerima confirmation yang valid dari payment provider.

Flow:

```text
Customer
↓
Create Order
↓
Payment Pending
↓
Payment Provider
↓
Webhook
↓
Signature Verification
↓
Idempotency Check
↓
Mark PAID
↓
Create Fulfillment Job
```

Jangan memproses fulfillment berdasarkan:

```text
frontend redirect
```

Fulfillment hanya boleh dimulai setelah payment backend confirmed.

---

# 14. Payment Webhook

Webhook harus:

1. verify signature;
2. verify merchant reference;
3. verify amount;
4. verify currency;
5. verify order;
6. check idempotency;
7. update payment;
8. update order;
9. enqueue fulfillment.

Duplicate webhook:

```text
Webhook #1 → process
Webhook #2 → ignore safely
Webhook #3 → ignore safely
```

Tidak boleh menyebabkan double fulfillment.

---

# 15. Idempotency

Order creation dan fulfillment wajib idempotent.

Gunakan:

```text
Idempotency-Key
```

Database:

```text
UNIQUE(idempotency_key)
```

Contoh:

```text
Request A
Idempotency-Key = abc123
↓
Order created

Request B
Idempotency-Key = abc123
↓
Return existing order
```

---

# 16. Fulfillment Engine

Fulfillment Engine adalah inti sistem.

Responsibility:

- mengambil paid order;
- menentukan fulfillment method;
- menentukan source/provider;
- melakukan reservation;
- melakukan fulfillment;
- memverifikasi hasil;
- retry jika diperlukan;
- mencatat seluruh aktivitas.

Architecture:

```text
Order
 ↓
Fulfillment Service
 ↓
Provider Resolver
 ↓
Provider Adapter
 ↓
Execution
 ↓
Verification
 ↓
Result
```

---

# 17. Provider Adapter Pattern

Jangan memasukkan logic provider langsung ke `OrderService`.

Gunakan interface:

```typescript
interface FulfillmentProvider {
  getBalance(): Promise<BalanceResult>;

  validateRecipient(
    recipient: Recipient
  ): Promise<RecipientValidation>;

  fulfill(
    request: FulfillmentRequest
  ): Promise<FulfillmentResult>;

  verify(
    reference: string
  ): Promise<FulfillmentVerification>;
}
```

Implementasi:

```text
providers/
├── provider-a/
├── provider-b/
├── provider-c/
└── mock/
```

Tujuan:

Jika Provider A berubah:

```text
ProviderAAdapter
```

yang berubah.

Order engine tidak perlu diubah.

---

# 18. Source / Inventory Management

Platform memiliki source account/provider.

Contoh:

```text
Source A
Balance: 10,000

Source B
Balance: 7,500

Source C
Balance: 25,000
```

Setiap source memiliki:

- available balance;
- reserved balance;
- status;
- priority;
- provider;
- last sync;
- health status.

---

# 19. Smart Routing

Smart Routing bertugas menentukan source terbaik.

Input:

```text
Required = 1,000
```

Source:

```text
A = 300
B = 700
C = 5,000
```

Output:

```text
A → 300
B → 700
```

Jika:

```text
A = 300
B = 200
C = 5,000
```

Output:

```text
A → 300
B → 200
C → 500
```

---

# 20. Smart Routing Rules

Default priority:

1. source active;
2. source healthy;
3. sufficient available balance;
4. lowest priority number;
5. lowest fulfillment cost if configured;
6. minimize number of sources;
7. reserve balance atomically.

Contoh:

```text
Priority 1
Source A

Priority 2
Source B

Priority 3
Source C
```

---

# 21. Inventory Reservation

Sebelum fulfillment:

```text
available balance
↓
reserve
↓
execute
```

Contoh:

```text
Balance:
1,000

Order:
700

After reservation:

Available:
300

Reserved:
700
```

Jika fulfillment berhasil:

```text
Available:
300

Reserved:
0
```

Jika gagal:

```text
Available:
1,000

Reserved:
0
```

Reservation harus dilakukan secara transactional dan concurrency-safe.

---

# 22. Concurrency Protection

Sistem harus mencegah:

```text
Order A → reserve 700
Order B → reserve 700
```

dari source yang hanya memiliki:

```text
1,000
```

Gunakan:

- PostgreSQL transaction;
- atomic update;
- row locking sesuai kebutuhan;
- Redis distributed lock untuk critical sections;
- unique fulfillment constraints.

---

# 23. Fulfillment Worker

HTTP request tidak boleh menjalankan fulfillment langsung.

Flow:

```text
POST /orders
↓
Create Order
↓
Commit DB
↓
Create Queue Job
↓
Return response
```

Worker:

```text
BullMQ
↓
FulfillmentWorker
↓
Process Order
```

---

# 24. Queue Names

Minimal queue:

```text
order-processing
fulfillment
payment
notification
inventory-sync
webhook
```

Contoh:

```text
fulfillment:
  fulfillment.order.created
  fulfillment.order.retry
  fulfillment.order.remaining
```

---

# 25. Retry Policy

Retry harus menggunakan exponential backoff.

Default:

```text
Attempt 1 → 5 seconds
Attempt 2 → 15 seconds
Attempt 3 → 30 seconds
Attempt 4 → 60 seconds
Attempt 5 → 5 minutes
```

Setelah maximum retry:

```text
FAILED_PERMANENTLY
```

Admin harus dapat melakukan manual retry.

---

# 26. Retry Safety

Jangan retry blind.

Sebelum retry:

```text
Check order status
Check fulfillment status
Check provider reference
Check previous attempt
Check partial fulfillment
```

Jika provider sudah berhasil tetapi response timeout:

```text
DO NOT EXECUTE AGAIN
```

Lakukan:

```text
VERIFY
```

terlebih dahulu.

---

# 27. Partial Fulfillment

Contoh:

```text
Requested:
1,000

Delivered:
700

Remaining:
300
```

System harus menyimpan:

```text
requested_amount = 1000
fulfilled_amount = 700
remaining_amount = 300
```

Retry hanya:

```text
300
```

bukan:

```text
1,000
```

---

# 28. Fulfillment Verification

Setelah execution:

```text
EXECUTE
↓
WAIT / POLL
↓
VERIFY
↓
SUCCESS
```

Provider reference harus disimpan.

Contoh:

```json
{
  "provider": "provider-a",
  "reference": "PROV-123456",
  "requested": 500,
  "fulfilled": 500,
  "status": "SUCCESS"
}
```

---

# 29. Gamepass / Delayed Fulfillment

Gamepass adalah fulfillment method terpisah.

Status:

```text
PAYMENT_CONFIRMED
↓
AWAITING_GAMEPASS
↓
GAMEPASS_DETECTED
↓
VALIDATING
↓
FULFILLMENT_PENDING
↓
FULFILLED
```

Jika fulfillment memang memiliki SLA 5–7 hari:

UI harus menunjukkan:

```text
Estimated fulfillment:
5–7 days
```

Jangan menampilkan "instant" untuk method ini.

---

# 30. Gamepass Tax Calculator

Jika business rule resmi/authorized yang digunakan memang membutuhkan gross-up 30%, kalkulator harus berada di backend.

Contoh:

```text
Target net = 1,000
Tax = 30%
Required gross = ceil(1000 / 0.70)
              = 1,429
```

UI:

```text
You want:
1,000 Robux net

Required Gamepass price:
1,429 Robux

Estimated Roblox fee:
429 Robux
```

Semua angka harus berasal dari backend calculation service.

---

# 31. Product Pricing

Admin dapat mengatur:

```text
Cost Price
Selling Price
Currency
Active
Minimum Quantity
Maximum Quantity
Fulfillment Method
Priority
```

Contoh:

```text
500 Robux

Cost:
Rp 50,000

Selling:
Rp 69,000

Gross Profit:
Rp 19,000
```

Profit tidak boleh dihitung berdasarkan frontend.

---

# 32. Pricing Snapshot

Ketika order dibuat:

```text
Product price
↓
snapshot
↓
Order Item
```

Jika harga berubah setelah order:

```text
Existing order
```

tetap menggunakan harga saat checkout.

---

# 33. Admin Dashboard

Dashboard utama:

```text
Revenue
Orders
Successful Orders
Failed Orders
Pending Orders
Gross Profit
Available Balance
Reserved Balance
Average Fulfillment Time
Success Rate
```

Charts:

- daily sales;
- monthly sales;
- order volume;
- revenue;
- profit;
- fulfillment success rate;
- source utilization.

---

# 34. Live Order Monitor

Admin dapat melihat:

```text
Order Number
Customer
Product
Quantity
Amount
Payment Status
Order Status
Fulfillment Status
Provider
Created At
Updated At
```

Filter:

```text
Pending
Processing
Success
Failed
Refunded
Partial
```

---

# 35. Admin Order Detail

Halaman order detail:

```text
ORDER #RBX-20261005-00001

Customer
Product
Quantity
Price
Payment

Timeline
────────────
10:01 Order Created
10:02 Payment Confirmed
10:02 Queued
10:03 Processing
10:03 Provider Selected
10:04 Fulfillment Success

Fulfillment
Provider: Source A
Requested: 500
Fulfilled: 500
Reference: XXXXX
```

Admin actions:

```text
Retry
Cancel
Refund
Reprocess
View Logs
```

Actions yang berisiko harus meminta confirmation.

---

# 36. Inventory Dashboard

Tampilkan:

```text
Total Balance
Available
Reserved
Low Balance
Offline Sources
Provider Errors
```

Health:

```text
● HEALTHY
● WARNING
● CRITICAL
● OFFLINE
```

Threshold dapat dikonfigurasi.

---

# 37. Low Balance Alert

Contoh:

```text
Source A
Balance = 500
Threshold = 1,000
```

Trigger:

```text
LOW_BALANCE
```

Notification:

```text
Telegram
Discord
Admin Dashboard
```

---

# 38. Notifications

Events:

```text
ORDER_CREATED
PAYMENT_CONFIRMED
FULFILLMENT_STARTED
FULFILLMENT_SUCCESS
FULFILLMENT_FAILED
LOW_BALANCE
PROVIDER_OFFLINE
REFUND_CREATED
SYSTEM_ERROR
```

Channels:

```text
Telegram
Discord
Email
In-app
```

Notification failure tidak boleh membuat order gagal.

---

# 39. Customer Order Tracking

Customer dapat membuka:

```text
/order/RBX-20261005-00001
```

Menampilkan:

```text
Order
✓ Payment
✓ Processing
✓ Fulfillment
✓ Completed
```

Jangan expose:

- provider credentials;
- source account credentials;
- internal API response;
- internal error stack;
- secret identifiers.

---

# 40. Customer Account

Customer dashboard:

```text
Profile
Orders
Order Detail
Security
Notifications
```

Order history:

```text
RBX-00001
500 Robux
SUCCESS

RBX-00002
1,000 Robux
PROCESSING
```

---

# 41. Authentication

Customer:

```text
Email / supported authentication
```

Admin:

```text
Email
Password
2FA
```

Admin wajib menggunakan 2FA.

---

# 42. Admin Security

Wajib:

- TOTP 2FA;
- rate limiting;
- login attempt tracking;
- session rotation;
- refresh-token rotation;
- secure cookies;
- audit log;
- IP/device metadata where appropriate;
- password hashing;
- account lock/risk controls;
- CSRF protection where applicable;
- CSP;
- HSTS;
- secure headers.

---

# 43. Audit Log

Semua administrative action penting dicatat.

Contoh:

```text
ADMIN:
admin@example.com

ACTION:
CHANGE_PRODUCT_PRICE

OLD:
69,000

NEW:
72,000

TIME:
2026-10-05 04:00

IP:
masked/controlled logging

RESULT:
SUCCESS
```

Audit log tidak boleh dapat diedit oleh admin biasa.

---

# 44. Database

Minimal tables:

```text
users
user_sessions
admin_2fa
products
product_prices
orders
order_items
payments
fulfillment_orders
fulfillment_attempts
fulfillment_allocations
fulfillment_sources
source_balance_logs
webhook_events
outbox_events
notifications
audit_logs
gamepass_orders
```

---

# 45. Users

```sql
users
-----
id
email
name
role
status
email_verified_at
created_at
updated_at
```

Roles:

```text
CUSTOMER
ADMIN
SUPER_ADMIN
OPERATOR
```

---

# 46. Products

```sql
products
--------
id
name
slug
robux_amount
fulfillment_method
cost_price
selling_price
currency
is_active
priority
metadata
created_at
updated_at
```

---

# 47. Orders

```sql
orders
------
id
order_number
user_id
status
fulfillment_method
subtotal
discount
fee
total
currency
idempotency_key
created_at
updated_at
```

---

# 48. Order Items

```sql
order_items
-----------
id
order_id
product_id
product_name_snapshot
robux_amount
quantity
unit_cost_snapshot
unit_price_snapshot
subtotal
```

---

# 49. Fulfillment Sources

```sql
fulfillment_sources
-------------------
id
provider
name
external_reference
priority
status
available_balance
reserved_balance
last_balance_sync
last_health_check
metadata
created_at
updated_at
```

Sensitive provider credentials must NOT be stored as plaintext columns.

Use a proper secrets management strategy.

---

# 50. Fulfillment Attempts

```sql
fulfillment_attempts
--------------------
id
fulfillment_order_id
attempt_number
provider
requested_amount
fulfilled_amount
external_reference
status
error_code
error_message
started_at
completed_at
```

---

# 51. API Architecture

## Public API

```http
GET /api/v1/products

POST /api/v1/roblox/resolve

POST /api/v1/orders

GET /api/v1/orders/:orderNumber

POST /api/v1/payments/create
```

## Customer API

```http
GET /api/v1/me

GET /api/v1/me/orders

GET /api/v1/me/orders/:id
```

## Admin API

```http
GET /api/v1/admin/dashboard

GET /api/v1/admin/orders

GET /api/v1/admin/orders/:id

POST /api/v1/admin/orders/:id/retry

POST /api/v1/admin/orders/:id/cancel

POST /api/v1/admin/orders/:id/refund

GET /api/v1/admin/products

POST /api/v1/admin/products

PATCH /api/v1/admin/products/:id

GET /api/v1/admin/sources

POST /api/v1/admin/sources/:id/sync
```

---

# 52. Webhooks

```http
POST /api/v1/webhooks/payment

POST /api/v1/webhooks/provider

POST /api/v1/webhooks/internal
```

Webhook handler harus:

```text
Authenticate
↓
Verify signature
↓
Validate payload
↓
Idempotency
↓
Persist event
↓
Process
```

---

# 53. Backend Folder Structure

```text
src/
├── auth/
├── users/
├── products/
├── pricing/
├── orders/
├── payments/
├── fulfillment/
│   ├── application/
│   ├── domain/
│   ├── infrastructure/
│   ├── workers/
│   └── providers/
├── inventory/
├── roblox/
├── gamepass/
├── notifications/
├── webhooks/
├── admin/
├── audit/
├── common/
└── main.ts
```

---

# 54. Frontend Architecture

```text
app/
├── page.tsx
├── products/
├── checkout/
├── order/
├── account/
├── login/
└── admin/
```

Components:

```text
components/
├── ui/
├── product/
├── checkout/
├── order/
├── account/
├── admin/
├── navigation/
└── feedback/
```

---

# 55. UI Design System

Theme:

```text
Background:
#070707

Surface:
#111111

Elevated:
#181818

Primary Gold:
#F5B700

Bright Gold:
#FFD84D

Dark Gold:
#A87500

Text:
#FFFFFF

Muted:
#A3A3A3

Success:
Green semantic token

Error:
Red semantic token

Warning:
Amber semantic token
```

Gold digunakan sebagai accent, CTA, border, icon highlight, chart highlight, dan glow.

Jangan membuat seluruh background berwarna kuning.

---

# 56. Visual Direction

Style:

```text
Premium
Gaming
Modern
Dark
Minimal
Luxury
Fast
Trustworthy
```

Gunakan:

- subtle gradients;
- glass surfaces secara terbatas;
- rounded cards;
- thin borders;
- gold glow;
- micro-interactions;
- smooth transitions;
- responsive layout.

Hindari:

- excessive neon;
- terlalu banyak gradient;
- dashboard terlihat seperti template;
- terlalu banyak card;
- animasi berlebihan.

---

# 57. Responsive

Wajib mendukung:

```text
Mobile
Tablet
Desktop
Large Desktop
```

Mobile checkout harus menjadi prioritas.

---

# 58. Loading State

Semua API operation harus memiliki state:

```text
idle
loading
success
error
```

Username resolution:

```text
Resolving account...
```

Payment:

```text
Waiting for payment...
```

Fulfillment:

```text
Processing your order...
```

---

# 59. Error UX

Jangan tampilkan:

```text
SQLSTATE[...]
AxiosError
ECONNREFUSED
Provider API stack
```

Customer melihat:

```text
We couldn't complete your order yet.

Your payment is safe.
We're retrying the fulfillment automatically.

Order:
RBX-20261005-00001
```

Admin melihat technical detail sesuai permission.

---

# 60. Logging

Structured logging menggunakan Pino atau equivalent.

Setiap log minimal memiliki:

```text
timestamp
requestId
orderId
userId
event
status
duration
```

Jangan log:

- password;
- API secret;
- access token;
- refresh token;
- payment secret;
- sensitive credential;
- full authorization headers.

---

# 61. Observability

Metric minimum:

```text
orders_total
orders_success
orders_failed
fulfillment_success
fulfillment_failed
fulfillment_latency
queue_depth
provider_latency
provider_errors
inventory_available
inventory_reserved
payment_success
payment_failed
```

---

# 62. Health Checks

Endpoints:

```http
GET /health
GET /health/ready
GET /health/live
```

Check:

```text
PostgreSQL
Redis
Queue
Provider connectivity
```

---

# 63. Deployment

Production:

```text
Cloudflare
↓
Nginx
↓
Next.js
↓
NestJS
↓
PostgreSQL
Redis
BullMQ Workers
```

PM2 processes:

```text
web
api
worker
scheduler
```

Jangan expose PostgreSQL/Redis secara public.

---

# 64. Docker Compatibility

Project harus tetap dapat dijalankan:

```text
docker compose up -d
```

Services:

```text
frontend
backend
postgres
redis
worker
nginx
```

Development environment harus konsisten dengan production environment.

---

# 65. Environment Variables

Minimal:

```env
NODE_ENV=
DATABASE_URL=
REDIS_URL=

JWT_SECRET=
JWT_REFRESH_SECRET=

ROBLOX_CLIENT_ID=
ROBLOX_CLIENT_SECRET=

PAYMENT_API_KEY=
PAYMENT_WEBHOOK_SECRET=

TELEGRAM_BOT_TOKEN=
DISCORD_WEBHOOK_URL=

SENTRY_DSN=
```

`.env` tidak boleh masuk Git.

---

# 66. Testing

Minimum coverage:

### Unit Test

- pricing;
- quantity;
- tax calculation;
- smart routing;
- reservation;
- order state machine;
- retry logic;
- idempotency.

### Integration Test

- PostgreSQL;
- Redis;
- queue;
- payment webhook;
- fulfillment provider;
- order lifecycle.

### E2E

Scenario:

```text
Customer
↓
Product
↓
Checkout
↓
Payment
↓
Fulfillment
↓
Success
```

---

# 67. Critical E2E Scenarios

AI agent wajib membuat test untuk:

### Scenario A — Normal

```text
500 Robux
Payment success
Fulfillment success
→ SUCCESS
```

### Scenario B — Duplicate payment webhook

```text
Webhook × 2
→ One fulfillment only
```

### Scenario C — Provider timeout

```text
Execution
↓
Timeout
↓
Verify
↓
If successful → SUCCESS
```

### Scenario D — Provider failure

```text
Failure
↓
Retry
↓
Success
```

### Scenario E — Insufficient balance

```text
Source A insufficient
↓
Source B selected
```

### Scenario F — Partial fulfillment

```text
Requested 1,000
Delivered 700
Remaining 300
↓
Retry 300
```

### Scenario G — Concurrent orders

```text
Order A = 700
Order B = 700
Source = 1,000

Only 1,000 can be reserved.
```

### Scenario H — Price changed

```text
Checkout price = 70,000
Admin changes price = 75,000

Existing order remains = 70,000.
```

---

# 68. Security Acceptance Criteria

System dianggap belum production-ready jika:

- admin tidak memakai 2FA;
- password tidak di-hash;
- secrets masuk Git;
- payment webhook tidak diverifikasi;
- fulfillment tidak idempotent;
- duplicate webhook dapat double fulfillment;
- inventory dapat oversell;
- credential customer tersimpan permanen;
- sensitive information masuk log;
- PostgreSQL terbuka ke public internet.

---

# 69. Admin Permissions

## SUPER_ADMIN

Semua akses.

## ADMIN

```text
Orders
Products
Pricing
Inventory
Customers
Notifications
```

## OPERATOR

```text
Orders
Fulfillment
Customer support
```

Operator tidak boleh:

```text
Change pricing
Change provider credential
Delete audit logs
Manage admins
```

---

# 70. Auditability

Setiap perubahan penting harus memiliki:

```text
who
what
when
before
after
result
```

Contoh:

```text
ADMIN:
operator01

ACTION:
MANUAL_RETRY

ORDER:
RBX-20261005-00001

BEFORE:
FAILED

AFTER:
QUEUED

TIME:
2026-10-05T04:20:00+07:00
```

---

# 71. Customer Support

Admin dapat melihat:

```text
Order
Payment
Fulfillment
Timeline
Provider reference
Failure reason
```

Tetapi operator tidak boleh melihat secret credential.

---

# 72. Refund

Refund hanya dapat dilakukan jika:

```text
Order status
+
Payment status
+
Fulfillment status
```

memenuhi business rules.

Contoh:

```text
UNFULFILLED + PAID
→ eligible refund
```

Tetapi:

```text
FULFILLED
→ normal refund disabled
```

kecuali SUPER_ADMIN/manual exception.

---

# 73. Cancellation

Customer dapat cancel hanya pada state tertentu.

Contoh:

```text
CREATED
PAYMENT_PENDING
```

Tidak boleh:

```text
FULFILLMENT_STARTED
```

kecuali business rule mengizinkan.

---

# 74. Business Analytics

Dashboard harus menghitung:

```text
Gross Revenue
COGS
Gross Profit
Profit Margin
Successful Orders
Failed Orders
Refunds
Average Order Value
Average Fulfillment Time
```

Formula:

```text
Gross Profit
=
Revenue
-
Cost of Fulfillment
-
Payment Fees
-
Refund Loss
```

---

# 75. Source Cost Tracking

Setiap fulfillment harus mencatat cost snapshot.

Contoh:

```text
Order:
1,000 Robux

Cost:
Rp 95,000

Selling:
Rp 125,000

Payment fee:
Rp 3,000

Gross profit:
Rp 27,000
```

Jangan mengambil cost dari current source balance setelah order selesai.

Simpan snapshot.

---

# 76. Admin Pricing Manager

Admin dapat:

```text
Create Product
Edit Product
Activate
Deactivate
Change Price
Change Cost
Change Fulfillment Method
Set Quantity Limits
```

Bulk update diperbolehkan tetapi harus melalui confirmation.

---

# 77. Product Availability

Product tidak boleh dianggap available hanya karena `is_active`.

Availability:

```text
is_active
+
provider health
+
sufficient inventory
```

Jika source habis:

```text
OUT OF STOCK
```

Frontend:

```text
[ OUT OF STOCK ]
```

bukan:

```text
BUY NOW
```

---

# 78. Automatic Inventory Sync

Worker:

```text
Every X minutes
↓
Get source balance
↓
Update database
↓
Calculate health
↓
Trigger low balance notification
```

Jika provider API error:

```text
Do not set balance = 0
```

Gunakan:

```text
last_known_balance
+
health = UNKNOWN
```

Ini mencegah false out-of-stock.

---

# 79. Provider Health

Health state:

```text
HEALTHY
DEGRADED
UNAVAILABLE
UNKNOWN
```

Provider tidak boleh digunakan ketika:

```text
UNAVAILABLE
```

kecuali admin force override.

---

# 80. Automation Scheduler

Scheduler digunakan untuk:

```text
Inventory sync
Provider health check
Pending order reconciliation
Failed job recovery
Expired payment cleanup
Notification retry
```

---

# 81. Reconciliation

Periodically:

```text
Database orders
vs
Provider transactions
```

Jika ditemukan mismatch:

```text
RECONCILIATION_REQUIRED
```

Admin diberi alert.

Ini penting untuk kasus:

```text
Provider success
Website timeout
```

---

# 82. API Rate Limiting

Public:

```text
IP-based
+
user-based
+
endpoint-based
```

Sensitive endpoints:

```text
/auth
/payment
/roblox/resolve
/orders
```

memiliki rate limit lebih ketat.

---

# 83. Anti-Abuse

Implementasikan:

- request rate limit;
- duplicate order detection;
- suspicious frequency detection;
- payment mismatch detection;
- account verification;
- IP/device risk signals;
- order velocity limits.

Jangan langsung memblokir customer berdasarkan satu sinyal.

---

# 84. API Versioning

Gunakan:

```text
/api/v1
```

Jangan:

```text
/api/order
```

tanpa versioning.

Future:

```text
/api/v2
```

tidak memerlukan rewrite client lama.

---

# 85. Documentation

Backend harus memiliki:

```text
OpenAPI / Swagger
```

Dokumentasikan:

- authentication;
- orders;
- products;
- payments;
- fulfillment;
- webhooks;
- errors;
- idempotency.

---

# 86. Error Codes

Gunakan application error code.

Contoh:

```text
ORDER_NOT_FOUND
PRODUCT_INACTIVE
INSUFFICIENT_BALANCE
PAYMENT_NOT_CONFIRMED
FULFILLMENT_UNAVAILABLE
FULFILLMENT_TIMEOUT
DUPLICATE_REQUEST
INVALID_RECIPIENT
RATE_LIMITED
```

---

# 87. Development Phases

## Phase 1 — Foundation

Implement:

```text
Next.js
NestJS
PostgreSQL
Redis
Prisma
Authentication
Base UI
```

Acceptance:

```text
Application runs
Database connected
Authentication works
Admin login works
```

---

## Phase 2 — Product & Pricing

Implement:

```text
Products
Pricing
Quantity
Product availability
Admin CRUD
```

Acceptance:

```text
Admin can create/edit products
Customer can see products
Price comes from backend
```

---

## Phase 3 — Order Engine

Implement:

```text
Checkout
Order creation
Order state machine
Order history
Idempotency
```

Acceptance:

```text
Customer can create order
Duplicate request doesn't create duplicate order
```

---

## Phase 4 — Payment

Implement:

```text
Payment provider
Webhook
Signature verification
Payment status
```

Acceptance:

```text
Only confirmed payment starts fulfillment.
```

---

## Phase 5 — Fulfillment Engine

Implement:

```text
Provider interface
Source management
Smart routing
Reservation
Worker
Retry
Verification
Partial fulfillment
```

Acceptance:

```text
Paid order can be automatically fulfilled.
```

---

## Phase 6 — Admin Operations

Implement:

```text
Dashboard
Order monitor
Inventory
Source management
Manual retry
Refund
Audit
```

---

## Phase 7 — Notifications

Implement:

```text
Telegram
Discord
Email
Customer notification
```

---

## Phase 8 — Hardening

Implement:

```text
2FA
Rate limit
Security headers
Audit
Monitoring
Sentry
Health check
Backup
Load testing
```

---

# 88. Definition of Done

Feature hanya dianggap selesai jika:

```text
[ ] Backend implemented
[ ] Frontend implemented
[ ] Database migration implemented
[ ] Validation implemented
[ ] Authorization implemented
[ ] Error handling implemented
[ ] Logging implemented
[ ] Audit implemented if applicable
[ ] Unit tests implemented
[ ] Integration tests implemented
[ ] E2E test implemented if critical
[ ] Loading state implemented
[ ] Error state implemented
[ ] Mobile responsive
[ ] API documented
[ ] No secrets committed
```

---

# 89. AI Coding Agent Rules

AI agent **WAJIB**:

1. membaca PRD sebelum coding;
2. tidak mengubah architecture tanpa alasan;
3. tidak membuat feature di luar scope;
4. tidak menghapus existing functionality tanpa approval;
5. tidak hard-code pricing;
6. tidak hard-code provider;
7. tidak menyimpan customer password;
8. tidak bypass authorization;
9. tidak membuat fulfillment non-idempotent;
10. tidak membuat direct fulfillment dari HTTP controller;
11. menggunakan queue untuk asynchronous work;
12. menggunakan transaction untuk financial/inventory state;
13. menambahkan test untuk business-critical logic;
14. menjaga backwards compatibility;
15. tidak commit secrets;
16. tidak melakukan deployment production tanpa approval.

---

# 90. Coding Priority

Urutan implementasi:

```text
1. Architecture
2. Database
3. Auth
4. Product
5. Pricing
6. Order
7. Payment
8. Queue
9. Fulfillment
10. Inventory
11. Admin
12. Notifications
13. Monitoring
14. Security hardening
15. Testing
16. Production deployment
```

---

# 91. Non-Goals

Versi pertama TIDAK mencakup:

- marketplace seller;
- seller onboarding;
- multi-vendor;
- affiliate system;
- cryptocurrency payment;
- unnecessary microservices;
- native mobile application;
- AI chatbot;
- complex loyalty system.

Fokus:

> **Customer → Payment → Automated Fulfillment → Success**

---

# 92. Final Target Architecture

```text
                         CUSTOMER
                            │
                            ▼
                    ┌───────────────┐
                    │    Next.js    │
                    │ Premium Store │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Nginx      │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    NestJS     │
                    │      API      │
                    └───────┬───────┘
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
          ▼                 ▼                  ▼
     PostgreSQL           Redis             Payment
          │                 │                  │
          │                 ▼                  │
          │              BullMQ                │
          │                 │                  │
          │        ┌────────┼────────┐         │
          │        ▼        ▼        ▼         │
          │    Fulfill   Retry   Notify        │
          │        │                         │
          │        ▼                         │
          │   Provider Adapter               │
          │        │                         │
          │        ▼                         │
          │  Authorized Source               │
          │        │                         │
          └────────┼─────────────────────────┘
                   ▼
              Order Status
                   │
                   ▼
                CUSTOMER
```

---

# 93. Final Product Definition

Platform ini harus terasa seperti:

> **Premium automated Robux fulfillment service**

bukan:

> toko online biasa.

Customer experience:

```text
Find Product
      ↓
Identify Roblox Account
      ↓
Checkout
      ↓
Pay
      ↓
Automatic Processing
      ↓
Delivered
```

Operator experience:

```text
Dashboard
    ↓
Monitor
    ↓
Intervene only when necessary
```

System experience:

```text
Payment
   ↓
Queue
   ↓
Routing
   ↓
Reservation
   ↓
Fulfillment
   ↓
Verification
   ↓
Success
```

Tujuan akhir:

> **90%+ order normal tidak membutuhkan intervensi manusia.**

Operator hanya menangani:

- provider failure;
- insufficient balance;
- reconciliation;
- fraud/risk;
- refund;
- exceptional orders.

---

# 94. AI Agent Initial Instruction

Saat mulai mengerjakan repository, AI coding agent harus memahami:

```text
You are implementing an automated digital-goods fulfillment platform.

The platform is a direct-to-customer service, not a marketplace.

The primary business flow is:

CUSTOMER
→ PRODUCT
→ ACCOUNT VALIDATION
→ CHECKOUT
→ PAYMENT
→ ORDER
→ QUEUE
→ FULFILLMENT ENGINE
→ PROVIDER/SOURCE
→ VERIFICATION
→ SUCCESS

The architecture is:

Next.js
+
NestJS
+
PostgreSQL
+
Redis
+
BullMQ

The backend is the source of truth.

Never trust frontend pricing.

Never fulfill directly inside an HTTP request.

Every fulfillment operation must be idempotent.

Every inventory reservation must be concurrency-safe.

Every payment webhook must be verified and idempotent.

Every provider integration must use an adapter.

Customer Roblox passwords must never be persisted.

Use official/authorized Roblox authentication and APIs for supported functionality.

Do not implement credential theft, cookie/session hijacking, unauthorized account access, or bypass mechanisms.

Before implementing each feature:
1. inspect the existing repository;
2. identify the relevant module;
3. preserve existing architecture;
4. implement migration;
5. implement service;
6. implement controller;
7. implement frontend;
8. implement tests;
9. run lint/typecheck/tests;
10. report exactly what changed.

Do not silently change business rules.
Do not invent provider behavior.
Do not hard-code production credentials.
Do not mark an order successful unless fulfillment has been verified.
```

---

# 95. Success Criteria

Project dianggap berhasil apabila:

```text
Customer:
✓ Can browse products
✓ Can identify their Roblox account through supported authentication
✓ Can choose quantity
✓ Can checkout
✓ Can pay
✓ Can track order
✓ Receives automated fulfillment

System:
✓ Creates order
✓ Confirms payment
✓ Queues fulfillment
✓ Selects appropriate source
✓ Reserves balance
✓ Executes fulfillment
✓ Verifies result
✓ Retries safely
✓ Handles partial fulfillment
✓ Prevents duplicate fulfillment
✓ Releases failed reservations
✓ Records complete audit trail

Admin:
✓ Can manage products
✓ Can manage pricing
✓ Can monitor orders
✓ Can monitor source balances
✓ Can retry failed orders
✓ Can refund eligible orders
✓ Can receive alerts
✓ Uses 2FA
✓ Can inspect fulfillment timeline

Security:
✓ No persistent customer Roblox passwords
✓ Secrets protected
✓ Payment webhooks verified
✓ API rate-limited
✓ Admin protected by 2FA
✓ Audit logging enabled
✓ Database not publicly exposed
✓ Sensitive logs redacted
```

**END OF PRD**