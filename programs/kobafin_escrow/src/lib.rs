use anchor_lang::prelude::*;

declare_id!("8igAph8Ypy6YZh1QLhzzkvVkzGybzjCyBawAtHpWtVLX");

#[program]
pub mod kobafin_escrow {
    use super::*;

    pub fn init_pot_vault(ctx: Context<InitPotVault>, pot_hash: [u8; 32]) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.pot_hash = pot_hash;
        vault.bump = *ctx.bumps.get("vault").unwrap();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, _pot_hash: [u8; 32], lamports: u64) -> Result<()> {
        // Transfer lamports from user to vault PDA
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.owner.key(),
            &ctx.accounts.vault.key(),
            lamports,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, _pot_hash: [u8; 32], lamports: u64) -> Result<()> {
        // Only vault owner can withdraw
        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);

        // Keep vault rent-exempt
        let rent = Rent::get()?;
        let min = rent.minimum_balance(Vault::SPACE);
        let current = ctx.accounts.vault.to_account_info().lamports();
        require!(current.saturating_sub(min) >= lamports, EscrowError::InsufficientFunds);

        // Transfer lamports by mutating balances directly.
        // SystemProgram::transfer cannot debit program-owned accounts with data.
        let mut vault_lamports = ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()?;
        let mut owner_lamports = ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()?;
        *vault_lamports -= lamports;
        *owner_lamports += lamports;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct InitPotVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Vault::SPACE,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub pot_hash: [u8; 32],
    pub bump: u8,
}

impl Vault {
    pub const SPACE: usize = 8 + 32 + 32 + 1; // discriminator + owner + pot_hash + bump
}

#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient funds")]
    InsufficientFunds,
}
