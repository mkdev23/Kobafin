-- DropForeignKey
ALTER TABLE "Deposit" DROP CONSTRAINT "Deposit_potId_fkey";

-- DropIndex
DROP INDEX "Deposit_potId_idx";

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "amountLamports" TEXT;

-- AlterTable
ALTER TABLE "Pot" ADD COLUMN     "riskTier" TEXT,
ADD COLUMN     "strategyKey" TEXT;

-- CreateTable
CREATE TABLE "LuloPosition" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "riskTier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "vaultPda" TEXT NOT NULL,
    "luloProgramId" TEXT,
    "luloPositionId" TEXT,
    "luloVaultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LuloPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LuloOp" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "depositId" TEXT,
    "withdrawalId" TEXT,
    "type" TEXT NOT NULL,
    "amountLamports" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LuloOp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LuloPosition_potId_key" ON "LuloPosition"("potId");

-- CreateIndex
CREATE INDEX "LuloPosition_userId_idx" ON "LuloPosition"("userId");

-- CreateIndex
CREATE INDEX "LuloOp_potId_idx" ON "LuloOp"("potId");

-- CreateIndex
CREATE INDEX "LuloOp_userId_idx" ON "LuloOp"("userId");

-- AddForeignKey
ALTER TABLE "LuloPosition" ADD CONSTRAINT "LuloPosition_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LuloPosition" ADD CONSTRAINT "LuloPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LuloOp" ADD CONSTRAINT "LuloOp_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LuloOp" ADD CONSTRAINT "LuloOp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
