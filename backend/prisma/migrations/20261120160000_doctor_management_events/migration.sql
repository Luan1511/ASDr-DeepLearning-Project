CREATE TABLE "DoctorManagementEvent" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous" TEXT NOT NULL,
    "next" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DoctorManagementEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DoctorManagementEvent_doctorId_occurredAt_idx" ON "DoctorManagementEvent"("doctorId", "occurredAt");
