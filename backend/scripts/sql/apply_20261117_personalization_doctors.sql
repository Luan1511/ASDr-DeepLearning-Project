-- Giai đoạn 6 + 7 (cá nhân hoá hồ sơ trẻ, chia sẻ hồ sơ với bác sĩ): 3 bảng mới, không sửa bảng cũ.
-- Dùng cho DB dùng chung có lịch sử migration lệch repo (master_prompt.md §5.4). Nội dung giữa BEGIN và COMMIT
-- giống hệt prisma/migrations/20261117_personalization_doctors/migration.sql.
--
--   npx prisma db execute --file scripts/sql/apply_20261117_personalization_doctors.sql --schema prisma/schema.prisma
--   npx prisma migrate resolve --applied 20261117_personalization_doctors
--
-- DB mới hoàn toàn (Docker, máy cá nhân) KHÔNG dùng file này: chạy npm run prisma:deploy.
BEGIN;

-- CreateTable
CREATE TABLE "ChildPersonalization" (
    "childId" TEXT NOT NULL,
    "nickname" TEXT,
    "interests" TEXT[],
    "communication" TEXT,
    "sensory" TEXT[],
    "calming" TEXT,
    "goals" TEXT,
    "focusAreas" TEXT[],
    "guideSpeed" TEXT NOT NULL DEFAULT 'AUTO',
    "practiceMode" TEXT NOT NULL DEFAULT 'AUTO',
    "liveCoach" BOOLEAN,
    "weeklyGoal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildPersonalization_pkey" PRIMARY KEY ("childId")
);

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "workplace" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "languages" TEXT[],
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "acceptingNew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorChildLink" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "scopes" TEXT[],
    "version" TEXT NOT NULL,
    "statement" JSONB NOT NULL,
    "message" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DoctorChildLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorProfile_userId_key" ON "DoctorProfile"("userId");

-- CreateIndex
CREATE INDEX "DoctorProfile_city_idx" ON "DoctorProfile"("city");

-- CreateIndex
CREATE INDEX "DoctorChildLink_doctorId_revokedAt_idx" ON "DoctorChildLink"("doctorId", "revokedAt");

-- CreateIndex
CREATE INDEX "DoctorChildLink_childId_idx" ON "DoctorChildLink"("childId");

-- CreateIndex
CREATE INDEX "DoctorChildLink_grantedById_idx" ON "DoctorChildLink"("grantedById");

-- AddForeignKey
ALTER TABLE "ChildPersonalization" ADD CONSTRAINT "ChildPersonalization_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorChildLink" ADD CONSTRAINT "DoctorChildLink_childId_fkey" FOREIGN KEY ("childId") REFERENCES "ChildProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorChildLink" ADD CONSTRAINT "DoctorChildLink_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorChildLink" ADD CONSTRAINT "DoctorChildLink_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;
