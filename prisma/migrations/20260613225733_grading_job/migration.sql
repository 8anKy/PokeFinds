-- CreateTable
CREATE TABLE "GradingJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "frontImageUrl" TEXT NOT NULL,
    "backImageUrl" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "overallGrade" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "modelUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingJob_userId_idx" ON "GradingJob"("userId");

-- CreateIndex
CREATE INDEX "GradingJob_userId_createdAt_idx" ON "GradingJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
