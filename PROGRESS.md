# ELANO build progress (step by step)

## Step 1 - Setup + audit (DONE)
- .env.local created with Firebase web config (APPCHECK site key still EMPTY)
- Existing: Firebase client, App Check init, newsletter + analytics callables, Firestore/Storage rules,
  admin overview, product CRUD, analytics dashboard, local cart, wishlist.
- Missing: checkout + order creation (Cloud Function), customer sign-up/login/account,
  coupons, reviews, CMS, analytics rollups, tests.

## Step 2 - Customer auth
- v1 (DONE): customer-auth.ts, /login, /register, password reset, email verification mail
- v2 (DONE): /account page (profile, logout, redirect to /login), header account icon, use-customer hook
- v3: addresses + order history on account page

## V3 (DONE) - one-command start + base polish
- `npm run dev` now auto-installs dependencies on first run, then starts Next.js (`npm run dev:raw` = plain next dev)
- Global polish: focus rings, page fade-up animation, reduced-motion support

## V4 (DONE) - Super Admin + employees with permissions
- Super Admin: aqib2k1@gmail.com (sign in at /admin, verify email, press "Activate Super Admin")
- New page /admin/team: add employees, tick permissions, disable/enable, remove
- Permissions: catalog, orders, customers, coupons, reviews, newsletter, cms, settings, analytics
- Enforced in Firestore + Storage rules and Cloud Functions (not just hidden buttons)
- Order management screen itself is NOT built yet (comes with checkout); the "orders" permission is ready
- Deploy needed: npm run firebase:deploy (rules + functions, Blaze plan)

## UI/UX polish track (versions)
- V4: homepage polish (hero, typography, motion, product cards, quick view)
- V5: product pages + collection page with filters/sort/search
- V6: cart drawer, free-shipping progress, Shopify-style checkout
- V7: admin redesign + orders, discounts, customers

## Planned steps
2. Customer auth (sign up / login / logout / reset) + account page
3. Secure checkout callable (server price + stock check, COD, order number, stock deduction)
4. Order history + admin order management (status transitions)
5. Analytics: summary rollups + GA4 begin_checkout / purchase
6. Coupons, reviews, homepage CMS
7. Tests + lint + build (needs npm install on your PC)

## Before it works
- Set NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY (reCAPTCHA v3 key from Firebase App Check)
- Add localhost + production domain in Auth > Authorized domains
- functions/.env.elano-ac833 -> GA4_PROPERTY_ID
- Blaze plan needed to deploy Functions
