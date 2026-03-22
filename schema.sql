-- Run this in Supabase SQL editor to set up or update the schema

create table if not exists rounds (
  id bigint generated always as identity primary key,
  start_time bigint not null,
  end_time bigint not null,
  start_price float,
  end_price float,
  outcome text,
  settled int default 0,
  market text not null default 'NEET'
);

create table if not exists bets (
  id bigint generated always as identity primary key,
  round_id bigint references rounds(id),
  wallet text not null,
  direction text not null,
  amount float not null,
  tx_sig text unique not null,
  paid_out int default 0,
  exited int default 0,
  payout_sig text,
  created_at bigint
);

-- Add market column if upgrading from old schema
alter table rounds add column if not exists market text not null default 'NEET';

create index if not exists idx_rounds_market_settled on rounds(market, settled);
