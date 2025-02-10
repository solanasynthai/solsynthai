use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
    metadata::{
        create_metadata_accounts_v3,
        create_master_edition_v3,
        Metadata,
        MetadataAccount,
    },
};
use mpl_token_metadata::state::DataV2;

declare_id!("nft_program_id");

#[program]
pub mod nft_contract {
    use super::*;

    pub fn initialize_collection(
        ctx: Context<InitializeCollection>,
        name: String,
        symbol: String,
        uri: String,
        max_supply: u64,
    ) -> Result<()> {
        let collection = &mut ctx.accounts.collection;
        collection.authority = ctx.accounts.authority.key();
        collection.name = name;
        collection.symbol = symbol;
        collection.uri = uri;
        collection.max_supply = max_supply;
        collection.total_minted = 0;

        Ok(())
    }

    pub fn mint_nft(
        ctx: Context<MintNFT>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        let collection = &mut ctx.accounts.collection;
        require!(
            collection.total_minted < collection.max_supply,
            NFTError::MaxSupplyReached
        );

        // Create metadata
        let metadata_infos = vec![
            ctx.accounts.metadata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.token_metadata_program.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ];

        let data_v2 = DataV2 {
            name,
            symbol,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        create_metadata_accounts_v3(
            CpiContext::new(
                ctx.accounts.token_metadata_program.to_account_info(),
                metadata_infos,
            ),
            data_v2,
            true,
            true,
            None,
        )?;

        collection.total_minted += 1;
        Ok(())
    }

    pub fn transfer_nft(
        ctx: Context<TransferNFT>,
    ) -> Result<()> {
        // Transfer NFT implementation
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCollection<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 32 + 32 + 32 + 8 + 8)]
    pub collection: Account<'info, Collection>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintNFT<'info> {
    #[account(mut)]
    pub collection: Account<'info, Collection>,
    #[account(init, payer = authority, mint::decimals = 0, mint::authority = authority)]
    pub mint: Account<'info, Mint>,
    /// CHECK: Created by Metaplex
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Metaplex program
    pub token_metadata_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferNFT<'info> {
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Collection {
    pub authority: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub max_supply: u64,
    pub total_minted: u64,
}

#[error_code]
pub enum NFTError {
    #[msg("Maximum supply reached")]
    MaxSupplyReached,
}
