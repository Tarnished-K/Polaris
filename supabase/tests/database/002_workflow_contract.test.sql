begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

select has_function('public', 'update_expense', array['text','text','uuid','expense_category','text','integer','uuid','split_method','integer','jsonb','text'], 'expense update RPC exists');
select has_function('public', 'save_own_fixed_amount', array['text','text','uuid','integer'], 'own fixed amount RPC exists');
select has_function('public', 'finalize_expense', array['text','text','uuid'], 'draft finalization RPC exists');
select has_function('public', 'delete_expense', array['text','text','uuid'], 'expense delete RPC exists');
select has_function('public', 'finalize_event', array['uuid'], 'event finalization RPC exists');
select has_function('public', 'unfinalize_event', array['uuid','boolean'], 'event unfinalization RPC exists');
select has_function('public', 'report_settlement', array['text','text','uuid'], 'payment report RPC exists');
select has_function('public', 'confirm_settlement', array['text','text','uuid'], 'receipt confirmation RPC exists');
select has_function('public', 'revert_settlement', array['text','text','uuid'], 'settlement revert RPC exists');
select has_function('warikan_private', 'event_charges', array['uuid'], 'pairwise charge generator exists');

select * from finish();
rollback;
