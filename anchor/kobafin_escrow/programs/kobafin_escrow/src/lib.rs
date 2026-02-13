use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use std::str::FromStr;

declare_id!("8igAph8Ypy6YZh1QLhzzkvVkzGybzjCyBawAtHpWtVLX");

const LULO_PROGRAM_ID: &str = "FL3X2pRsQ9zHENpZSKDRREtccwJuei8yg9fwDu9UN69Q";

#[program]
pub mod kobafin_escrow {
    use super::*;

    pub fn init_pot_vault(ctx: Context<InitPotVault>, pot_hash: [u8; 32]) -> Result<()> {
        let v = &mut ctx.accounts.vault;

        v.owner = ctx.accounts.owner.key();
        v.pot_hash = pot_hash;
        v.bump = ctx.bumps.vault;
        v.usdc_mint = ctx.accounts.usdc_mint.key();
        v.usdc_vault = ctx.accounts.vault_usdc.key();

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, pot_hash: [u8; 32], lamports: u64) -> Result<()> {
        require!(lamports > 0, EscrowError::InvalidAmount);

        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);
        require!(ctx.accounts.vault.pot_hash == pot_hash, EscrowError::BadPot);

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

    pub fn withdraw(ctx: Context<Withdraw>, pot_hash: [u8; 32], lamports: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);
        require!(ctx.accounts.vault.pot_hash == pot_hash, EscrowError::BadPot);

        let rent = Rent::get()?;
        let min = rent.minimum_balance(Vault::SPACE);
        let current = ctx.accounts.vault.to_account_info().lamports();
        require!(current.saturating_sub(min) >= lamports, EscrowError::InsufficientFunds);

        let vault_info = ctx.accounts.vault.to_account_info();
        let owner_info = ctx.accounts.owner.to_account_info();
        let mut vault_lamports = vault_info.try_borrow_mut_lamports()?;
        let mut owner_lamports = owner_info.try_borrow_mut_lamports()?;
        **vault_lamports -= lamports;
        **owner_lamports += lamports;
        Ok(())
    }

    pub fn withdraw_with_fee(
        ctx: Context<WithdrawWithFee>,
        pot_hash: [u8; 32],
        lamports: u64,
        fee_lamports: u64,
    ) -> Result<()> {
        require!(lamports > 0, EscrowError::InvalidAmount);
        require!(fee_lamports <= lamports, EscrowError::InvalidFee);

        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);
        require!(ctx.accounts.vault.pot_hash == pot_hash, EscrowError::BadPot);

        let rent = Rent::get()?;
        let min = rent.minimum_balance(Vault::SPACE);
        let current = ctx.accounts.vault.to_account_info().lamports();
        require!(current.saturating_sub(min) >= lamports, EscrowError::InsufficientFunds);

        let net = lamports.saturating_sub(fee_lamports);

        let vault_info = ctx.accounts.vault.to_account_info();
        let owner_info = ctx.accounts.owner.to_account_info();
        let admin_info = ctx.accounts.admin_vault.to_account_info();
        let mut vault_lamports = vault_info.try_borrow_mut_lamports()?;
        let mut owner_lamports = owner_info.try_borrow_mut_lamports()?;
        let mut admin_lamports = admin_info.try_borrow_mut_lamports()?;
        **vault_lamports -= lamports;
        **owner_lamports += net;
        **admin_lamports += fee_lamports;
        Ok(())
    }

    pub fn deposit_usdc(ctx: Context<DepositUsdc>, pot_hash: [u8; 32], amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);

        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);
        require!(ctx.accounts.vault.pot_hash == pot_hash, EscrowError::BadPot);
        require_keys_eq!(ctx.accounts.vault.usdc_mint, ctx.accounts.usdc_mint.key(), EscrowError::BadMint);
        require_keys_eq!(ctx.accounts.vault.usdc_vault, ctx.accounts.vault_usdc.key(), EscrowError::BadVaultAccount);

        let cpi = Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.vault_usdc.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn withdraw_usdc(ctx: Context<WithdrawUsdc>, pot_hash: [u8; 32], amount: u64) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);

        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);
        require!(ctx.accounts.vault.pot_hash == pot_hash, EscrowError::BadPot);
        require_keys_eq!(ctx.accounts.vault.usdc_mint, ctx.accounts.usdc_mint.key(), EscrowError::BadMint);
        require_keys_eq!(ctx.accounts.vault.usdc_vault, ctx.accounts.vault_usdc.key(), EscrowError::BadVaultAccount);
        require!(ctx.accounts.vault_usdc.amount >= amount, EscrowError::InsufficientFunds);

        let owner_key = ctx.accounts.owner.key();
        let pot_hash_bytes = ctx.accounts.vault.pot_hash;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[
            b"pot_vault",
            owner_key.as_ref(),
            pot_hash_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi = Transfer {
            from: ctx.accounts.vault_usdc.to_account_info(),
            to: ctx.accounts.user_usdc.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn lulo_execute(ctx: Context<LuloExecute>, pot_hash: [u8; 32], ix_data: Vec<u8>) -> Result<()> {
        require_keys_eq!(ctx.accounts.vault.owner, ctx.accounts.owner.key(), EscrowError::Unauthorized);
        require!(ctx.accounts.vault.pot_hash == pot_hash, EscrowError::BadPot);

        let expected_program = Pubkey::from_str(LULO_PROGRAM_ID).map_err(|_| EscrowError::InvalidProgram)?;
        require_keys_eq!(ctx.accounts.lulo_program.key(), expected_program, EscrowError::InvalidProgram);

        let mut metas: Vec<AccountMeta> = Vec::with_capacity(ctx.remaining_accounts.len());
        for acc in ctx.remaining_accounts.iter() {
            let mut is_signer = acc.is_signer;
            if acc.key() == ctx.accounts.vault.key() {
                is_signer = true;
            }
            metas.push(AccountMeta {
                pubkey: *acc.key,
                is_signer,
                is_writable: acc.is_writable,
            });
        }

        let ix = Instruction {
            program_id: ctx.accounts.lulo_program.key(),
            accounts: metas,
            data: ix_data,
        };

        let owner_key = ctx.accounts.owner.key();
        let pot_hash_bytes = ctx.accounts.vault.pot_hash;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[
            b"pot_vault",
            owner_key.as_ref(),
            pot_hash_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let mut infos: Vec<AccountInfo> = Vec::with_capacity(ctx.remaining_accounts.len());
        infos.extend_from_slice(ctx.remaining_accounts);

        invoke_signed(&ix, &infos, signer_seeds)?;

        Ok(())
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        pod_hash: [u8; 32],
        risk_state: u8,
        target_usdc_bps: u16,
        target_btc_bps: u16,
        target_eth_bps: u16,
        target_sol_bps: u16,
        usdc_in_lulo_bps: u16,
    ) -> Result<()> {
        require!(risk_state <= 2, EscrowError::InvalidRiskState);

        let target_sum = (target_usdc_bps as u32)
            + (target_btc_bps as u32)
            + (target_eth_bps as u32)
            + (target_sol_bps as u32);
        require!(target_sum == 10_000, EscrowError::InvalidBps);
        require!(
            usdc_in_lulo_bps <= target_usdc_bps,
            EscrowError::InvalidLuloAllocation
        );

        let policy = &mut ctx.accounts.pod_policy;
        let authority = ctx.accounts.authority.key();
        if policy.authority == Pubkey::default() {
            policy.authority = authority;
            policy.bump = ctx.bumps.pod_policy;
        } else {
            require_keys_eq!(policy.authority, authority, EscrowError::Unauthorized);
        }

        policy.pod_hash = pod_hash;
        policy.risk_state = risk_state;
        policy.target_usdc_bps = target_usdc_bps;
        policy.target_btc_bps = target_btc_bps;
        policy.target_eth_bps = target_eth_bps;
        policy.target_sol_bps = target_sol_bps;
        policy.usdc_in_lulo_bps = usdc_in_lulo_bps;
        policy.updated_at = Clock::get()?.unix_timestamp;

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

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
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

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct WithdrawWithFee<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub admin_vault: Account<'info, Vault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct DepositUsdc<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = owner
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct WithdrawUsdc<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = owner
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault
    )]
    pub vault_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(pot_hash: [u8; 32])]
pub struct LuloExecute<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pot_vault", owner.key().as_ref(), pot_hash.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: validated against constant program id
    pub lulo_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(pod_hash: [u8; 32])]
pub struct UpdatePolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = PodPolicy::SPACE,
        seeds = [b"pod_policy", pod_hash.as_ref()],
        bump
    )]
    pub pod_policy: Account<'info, PodPolicy>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub pot_hash: [u8; 32],
    pub bump: u8,
    pub usdc_mint: Pubkey,
    pub usdc_vault: Pubkey,
}

impl Vault {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 32 + 32;
}

#[account]
pub struct PodPolicy {
    pub authority: Pubkey,
    pub pod_hash: [u8; 32],
    pub risk_state: u8,
    pub target_usdc_bps: u16,
    pub target_btc_bps: u16,
    pub target_eth_bps: u16,
    pub target_sol_bps: u16,
    pub usdc_in_lulo_bps: u16,
    pub bump: u8,
    pub updated_at: i64,
}

impl PodPolicy {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 2 + 2 + 2 + 2 + 2 + 1 + 8;
}

#[error_code]
pub enum EscrowError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid fee")]
    InvalidFee,
    #[msg("Bad pot hash")]
    BadPot,
    #[msg("Bad mint")]
    BadMint,
    #[msg("Bad vault account")]
    BadVaultAccount,
    #[msg("Invalid program")]
    InvalidProgram,
    #[msg("Invalid risk state")]
    InvalidRiskState,
    #[msg("Invalid target bps sum")]
    InvalidBps,
    #[msg("Invalid usdc_in_lulo bps")]
    InvalidLuloAllocation,
}
