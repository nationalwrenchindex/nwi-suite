alter table public.profiles
  add column business_type text not null default 'mechanic'
  constraint profiles_business_type_check check (business_type in ('mechanic', 'detailer'));
