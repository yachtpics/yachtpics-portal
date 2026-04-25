-- Run this first to clear existing policies, then re-run schema.sql

drop policy if exists "Users read own profile" on profiles;
drop policy if exists "Users update own profile" on profiles;
drop policy if exists "Admins insert profiles" on profiles;
drop policy if exists "Assistants read linked brokers" on profiles;
drop policy if exists "Brokers read linked assistants" on profiles;

drop policy if exists "Brokers read/update own details" on broker_details;
drop policy if exists "Assistants read broker details" on broker_details;

drop policy if exists "Brokers manage their assistants" on broker_assistants;
drop policy if exists "Assistants view their links" on broker_assistants;

drop policy if exists "Brokers manage own listings" on listings;
drop policy if exists "Assistants manage linked broker listings" on listings;

drop policy if exists "Brokers view own listing photos" on photos;
drop policy if exists "Admins manage all photos" on photos;
drop policy if exists "Brokers update photo visibility/order" on photos;
drop policy if exists "Assistants view/update linked broker photos" on photos;

drop policy if exists "Admins manage all shoots" on shoots;
drop policy if exists "Brokers view own shoots" on shoots;

drop policy if exists "Admins manage subscriptions" on subscriptions;
drop policy if exists "Brokers view own subscription" on subscriptions;

drop policy if exists "Admins upload photos" on storage.objects;
drop policy if exists "Brokers download own photos" on storage.objects;
