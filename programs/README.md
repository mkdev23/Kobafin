# KobaFin Escrow Program (Devnet)

This PoC uses a tiny Anchor program to create **per-pot PDA vaults** that can **receive SOL** (deposit) and **release SOL back** (withdraw). This gives you real “funds leave + can return” behavior without any backend custody.

## What it does
- `init_pot_vault(pot_hash)` creates a PDA account owned by the program
- `deposit(pot_hash, lamports)` transfers SOL from the user to the PDA
- `withdraw(pot_hash, lamports)` transfers SOL from the PDA back to the user (program signs)

The backend generates the transaction; the user signs in Phantom.

## Deploy (recommended)
1) Install Solana CLI + Anchor
2) `solana config set --url https://api.devnet.solana.com`
3) From repo root:
   - `anchor init kobafin-escrow-workspace` (or use your existing workspace)
   - copy `programs/kobafin_escrow` into the workspace `programs/` folder
   - update `declare_id!()` with the program id that Anchor generates
   - `anchor build`
   - `anchor deploy`
4) Copy the deployed `programId` into:
   - `backend/.env` => `KOBA_ESCROW_PROGRAM_ID=...`

## Notes
- Deposits will also pay the vault PDA rent-exempt minimum one time (on first deposit for a pot), because the PDA account is created on-chain.
- Withdraw keeps the PDA rent-exempt, so the account stays alive.
