-- CreateIndex
CREATE INDEX "Deposit_potId_idx" ON "Deposit"("potId");

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
