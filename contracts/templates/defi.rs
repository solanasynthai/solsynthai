use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};

declare_id!("defi_program_id");

#[program]
pub mod defi_contract {
    use super::*;

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        pool_nonce: u8,
        reward_rate: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.stake_mint = ctx.accounts.stake_mint.key();
        pool.reward_mint = ctx.accounts.reward_mint.key();
        pool.stake_vault = ctx.accounts.stake_vault.key();
        pool.reward_vault = ctx.accounts.reward_vault.key();
        pool.nonce = pool_nonce;
        pool.reward_rate = reward_rate;
        pool.last_update_time = Clock::get()?.unix_timestamp;
        pool.reward_per_token_stored = 0;
        pool.total_stake = 0;

        Ok(())
    }

    pub fn stake(
        ctx: Context<Stake>,
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user = &mut ctx.accounts.user;
        
        // Update rewards
        update_rewards(pool, user)?;

        // Transfer tokens to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.stake_from.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update user stake
        user.stake_amount = user.stake_amount.checked_add(amount)
            .ok_or(DeFiError::NumberOverflow)?;
        pool.total_stake = pool.total_stake.checked_add(amount)
            .ok_or(DeFiError::NumberOverflow)?;

        Ok(())
    }

    pub fn unstake(
        ctx: Context<Unstake>,
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user = &mut ctx.accounts.user;

        // Update rewards
        update_rewards(pool, user)?;

        // Transfer tokens from vault
        let (pool_authority, bump_seed) = 
            Pubkey::find_program_address(&[pool.to_account_info().key.as_ref()], ctx.program_id);
        let seeds = &[
            pool.to_account_info().key.as_ref(),
            &[bump_seed],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.stake_to.to_account_info(),
                    authority: pool_authority.to_account_info(),
                },
                &[&seeds[..]],
            ),
            amount,
        )?;

        // Update user stake
        user.stake_amount = user.stake_amount.checked_sub(amount)
            .ok_or(DeFiError::InsufficientBalance)?;
        pool.total_stake = pool.total_stake.checked_sub(amount)
            .ok_or(DeFiError::InsufficientBalance)?;

        Ok(())
    }

    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user = &mut ctx.accounts.user;

        // Update rewards
        update_rewards(pool, user)?;

        // Calculate rewards
        let rewards = user.reward_tally;
        if rewards == 0 {
            return Ok(());
        }

        // Transfer rewards
        let (pool_authority, bump_seed) = 
            Pubkey::find_program_address(&[pool.to_account_info().key.as_ref()], ctx.program_id);
        let seeds = &[
            pool.to_account_info().key.as_ref(),
            &[bump_seed],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    to: ctx.accounts.reward_to.to_account_info(),
                    authority: pool_authority.to_account_info(),
                },
                &[&seeds[..]],
            ),
            rewards,
        )?;

        // Reset user rewards
        user.reward_tally = 0;

        Ok(())
    }
}

fn update_rewards(
    pool: &mut Pool,
    user: &mut User,
) -> Result<()> {
    let current_time = Clock::get()?.unix_timestamp;
    let time_delta = current_time.checked_sub(pool.last_update_time)
        .ok_or(DeFiError::NumberOverflow)?;

    if pool.total_stake > 0 {
        pool.reward_per_token_stored = pool.reward_per_token_stored
            .checked_add(
                (time_delta as u64)
                    .checked_mul(pool.reward_rate)
                    .ok_or(DeFiError::NumberOverflow)?
                    .checked_mul(1_000_000)
                    .ok_or(DeFiError::NumberOverflow)?
                    .checked_div(pool.total_stake)
                    .ok_or(DeFiError::NumberOverflow)?
            )
            .ok_or(DeFiError::NumberOverflow)?;
    }

    user.reward_tally = user.reward_tally
        .checked_add(
            user.stake
