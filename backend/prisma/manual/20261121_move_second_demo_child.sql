-- One-off data fix for khmt01, to run BEFORE migration 20261121_one_child_per_parent
-- (the backend applies migrations when it starts). Chosen by the project owner on
-- 2026-11-21: the demo account user@asdr.local had two children; the second one
-- (22222222-…) and everything recorded for it move to a new demo parent
-- user2@asdr.local (same password as user@asdr.local). Nothing is deleted.
BEGIN;

INSERT INTO "User" ("id", "name", "email", "passwordHash", "role", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'Trần Thị B', 'user2@asdr.local', u."passwordHash", 'USER', now(), now()
FROM "User" u
WHERE u."email" = 'user@asdr.local'
ON CONFLICT ("email") DO NOTHING;

UPDATE "ChildProfile" SET "userId" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local'), "updatedAt" = now()
WHERE "id" = '22222222-2222-2222-2222-222222222222';
UPDATE "VideoUpload" SET "userId" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local')
WHERE "childId" = '22222222-2222-2222-2222-222222222222';
UPDATE "ConsentRecord" SET "userId" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local')
WHERE "childId" = '22222222-2222-2222-2222-222222222222';
UPDATE "ExerciseSession" SET "userId" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local')
WHERE "childId" = '22222222-2222-2222-2222-222222222222';
UPDATE "QuestionnaireResponse" SET "userId" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local')
WHERE "childId" = '22222222-2222-2222-2222-222222222222';
UPDATE "KinectSession" SET "userId" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local')
WHERE "childId" = '22222222-2222-2222-2222-222222222222';
UPDATE "DoctorChildLink" SET "grantedById" = (SELECT "id" FROM "User" WHERE "email" = 'user2@asdr.local')
WHERE "childId" = '22222222-2222-2222-2222-222222222222';

-- Must return no rows before the unique index can be created.
SELECT "userId", count(*) AS children FROM "ChildProfile" GROUP BY "userId" HAVING count(*) > 1;

COMMIT;
