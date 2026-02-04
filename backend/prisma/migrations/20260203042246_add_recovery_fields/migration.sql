-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryLockedUntil" TIMESTAMP(3),
ADD COLUMN     "recoveryMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recoveryUpdatedAt" TIMESTAMP(3);
