-- One parent account manages exactly one child.
-- Accounts with several children must be resolved BEFORE this runs (the unique
-- index fails otherwise); on khmt01 the second child of the demo account
-- user@asdr.local was moved to user2@asdr.local first (see changelogs.md).
DROP INDEX IF EXISTS "ChildProfile_userId_idx";
CREATE UNIQUE INDEX "ChildProfile_userId_key" ON "ChildProfile"("userId");
