use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use std::convert::TryFrom;

declare_id!("SynT1111111111111111111111111111111111111");

#[program]
pub mod solsynthai {
    use super::*;

    pub fn initialize_synthetic_asset(
        ctx: Context<InitializeSyntheticAsset>,
        name: String,
        symbol: String,
        decimals: u8,
    ) -> Result<()> {
        let synthetic_asset = &mut ctx.accounts.synthetic_asset;
        let clock = Clock::get()?;

        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);
        require!(decimals <= 9, ErrorCode::InvalidDecimals);

        synthetic_asset.name = name;
        synthetic_asset.symbol = symbol;
        synthetic_asset.decimals = decimals;
        synthetic_asset.authority = ctx.accounts.authority.key();
        synthetic_asset.mint = ctx.accounts.mint.key();
        synthetic_asset.created_at = clock.unix_timestamp;
        synthetic_asset.total_supply = 0;
        synthetic_asset.paused = false;

        emit!(SyntheticAssetCreated {
            asset: synthetic_asset.key(),
            authority: synthetic_asset.authority,
            mint: synthetic_asset.mint,
            name: synthetic_asset.name.clone(),
            symbol: synthetic_asset.symbol.clone(),
            decimals: synthetic_asset.decimals,
        });

        Ok(())
    }

    pub fn mint_synthetic(
        ctx: Context<MintSynthetic>,
        amount: u64,
        collateral_amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.synthetic_asset.paused, ErrorCode::AssetPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(collateral_amount > 0, ErrorCode::InvalidCollateralAmount);

        // Verify price and collateral ratio
        let required_collateral = calculate_required_collateral(
            amount,
            ctx.accounts.price_feed.get_price()?,
            ctx.accounts.synthetic_asset.collateral_ratio,
        )?;
        require!(
            collateral_amount >= required_collateral,
            ErrorCode::InsufficientCollateral
        );

        // Transfer collateral
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.user_collateral.to_account_info(),
                    to: ctx.accounts.collateral_vault.to_account_info(),
                    authority: ctx.accounts.user_authority.to_account_info(),
                },
            ),
            collateral_amount,
        )?;

        // Mint synthetic tokens
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_synthetic.to_account_info(),
                    authority: ctx.accounts.synthetic_asset.to_account_info(),
                },
                &[&[
                    b"synthetic",
                    ctx.accounts.synthetic_asset.key().as_ref(),
                    &[ctx.bumps.synthetic_asset],
                ]],
            ),
            amount,
        )?;

        ctx.accounts.synthetic_asset.total_supply = ctx
            .accounts
            .synthetic_asset
            .total_supply
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        emit!(SyntheticMinted {
            asset: ctx.accounts.synthetic_asset.key(),
            user: ctx.accounts.user_authority.key(),
            amount,
            collateral_amount,
        });

        Ok(())
    }

    pub fn burn_synthetic(
        ctx: Context<BurnSynthetic>,
        amount: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.synthetic_asset.paused, ErrorCode::AssetPaused);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let collateral_to_return = calculate_collateral_return(
            amount,
            ctx.accounts.price_feed.get_price()?,
            ctx.accounts.synthetic_asset.collateral_ratio,
        )?;

        // Burn synthetic tokens
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.user_synthetic.to_account_info(),
                    authority: ctx.accounts.user_authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // Return collateral
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.collateral_vault.to_account_info(),
                    to: ctx.accounts.user_collateral.to_account_info(),
                    authority: ctx.accounts.synthetic_asset.to_account_info(),
                },
                &[&[
                    b"synthetic",
                    ctx.accounts.synthetic_asset.key().as_ref(),
                    &[ctx.bumps.synthetic_asset],
                ]],
            ),
            collateral_to_return,
        )?;

        ctx.accounts.synthetic_asset.total_supply = ctx
            .accounts
            .synthetic_asset
            .total_supply
            .checked_sub(amount)
            .ok_or(ErrorCode::Overflow)?;

        emit!(SyntheticBurned {
            asset: ctx.accounts.synthetic_asset.key(),
            user: ctx.accounts.user_authority.key(),
            amount,
            collateral_returned: collateral_to_return,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String, decimals: u8)]
pub struct InitializeSyntheticAsset<'info> {
    #[account(
        init,
        payer = authority,
        space = SyntheticAsset::LEN,
        seeds = [b"synthetic", mint.key().as_ref()],
        bump
    )]
    pub synthetic_asset: Account<'info, SyntheticAsset>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = synthetic_asset
    )]
    pub collateral_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintSynthetic<'info> {
    #[account(
        mut,
        seeds = [b"synthetic", mint.key().as_ref()],
        bump,
        has_one = mint,
    )]
    pub synthetic_asset: Account<'info, SyntheticAsset>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_synthetic: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user_collateral: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub collateral_vault: Account<'info, TokenAccount>,
    
    pub user_authority: Signer<'info>,
    pub price_feed: AccountLoader<'info, PriceFeed>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct SyntheticAsset {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub collateral_ratio: u64,
    pub paused: bool,
    pub created_at: i64,
}

impl SyntheticAsset {
    pub const LEN: usize = 8 + // discriminator
        32 + // name
        10 + // symbol
        1 + // decimals
        32 + // authority
        32 + // mint
        8 + // total_supply
        8 + // collateral_ratio
        1 + // paused
        8; // created_at
}

#[error_code]
pub enum ErrorCode {
    #[msg("Name must be 32 characters or less")]
    NameTooLong,
    #[msg("Symbol must be 10 characters or less")]
    SymbolTooLong,
    #[msg("Decimals must be 9 or less")]
    InvalidDecimals,
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("Collateral amount must be greater than 0")]
    InvalidCollateralAmount,
    #[msg("Insufficient collateral provided")]
    InsufficientCollateral,
    #[msg("Asset is paused")]
    AssetPaused,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// Events
#[event]
pub struct SyntheticAssetCreated {
    pub asset: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
}

#[event]
pub struct SyntheticMinted {
    pub asset: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub collateral_amount: u64,
}

#[event]
pub struct SyntheticBurned {
    pub asset: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub collateral_returned: u64,
}
