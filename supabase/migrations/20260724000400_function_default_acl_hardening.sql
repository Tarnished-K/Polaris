-- PostgreSQL grants PUBLIC execute on new functions as a built-in global
-- default. A schema-scoped default ACL cannot subtract that global grant, so
-- remove it at the creating-role level. Public RPCs must be granted explicitly.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
