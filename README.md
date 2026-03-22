# Restaurant Ordering System

A production-oriented monorepo for a multilingual restaurant ordering system with a customer-facing PWA and a real-time admin dashboard.

## Apps

- `apps/web`: React + Vite customer/admin frontend
- `apps/api`: Express + Prisma + Socket.io backend
- `packages/shared`: shared contracts, enums, validation, and utilities

## Quick Start

1. Copy `apps/api/.env.example` to `apps/api/.env`
2. Copy `apps/web/.env.example` to `apps/web/.env`
3. Install dependencies with `npm install`
4. Generate Prisma client with `npm run prisma:generate`
5. Run migrations with `npm run prisma:migrate`
6. Seed demo data with `npm run seed`
7. Start the stack with `npm run dev`

## Default Demo Accounts

- Admin: `کاپتن یوسف` / `9900`
- Customer: `بەهرە` / `2000`
- Customer: `ڕاژان` / `9889`
- Settings PIN: `2030`

The fixed demo auth flow only accepts these PINs.
