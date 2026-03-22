create table rounds (
  id bigint generated always as identity primary key,
  start_time bigint not null,
  end_time bigint not null,
  start_price float,
  end_price float,
  outcome text,
  settled int default 0
);

create table bets (
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
