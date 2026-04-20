-- ============================================================
-- National Wrench Index Suite
-- Migration: 006_share_templates.sql
-- Adds share-link template columns to profiles
-- ============================================================

alter table public.profiles
  add column if not exists share_sms_template  text,
  add column if not exists share_email_subject text,
  add column if not exists share_email_body    text;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
