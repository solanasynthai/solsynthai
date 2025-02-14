import { Connection, PublicKey } from '@solana/web3.js';
import { AggregatorAccount, OracleAccount } from '@switchboard-xyz/switchboard-v2';
import { redisConfig } from '../../config/redis.config';
import { Logger } from '../../utils/logger';
import { CONFIG } from '../../config';

export class PriceFeedService {
  private connection: Connection;
  private logger: Logger;
  private priceFeeds: Map<string, PublicKey>;

  constructor(connection: Connection) {
    this.connection = connection;
    this.logger = new Logger('PriceFeedService');
    this.priceFeeds = new Map();
    this.initializePriceFeeds();
  }

  private initializePriceFeeds() {
    // Initialize with supported assets
    this.priceFeeds.set('THB', new PublicKey(CONFIG.PRICE_FEEDS.THB));
    this.priceFeeds.set('USD', new PublicKey(CONFIG.PRICE_FEEDS.USD));
    this.priceFeeds.set('SOL', new PublicKey(CONFIG.PRICE_FEEDS.SOL));
  }

  async getPrice(symbol: string): Promise<number> {
    try {
      const cachedPrice = await this.getCachedPrice(symbol);
      if (cachedPrice) {
        return cachedPrice;
      }

      const feedAddress = this.priceFeeds.get(symbol);
      if (!feedAddress) {
        throw new Error(`Price feed not found for symbol: ${symbol}`);
      }

      const aggregator = new AggregatorAccount({
        connection: this.connection,
        publicKey: feedAddress,
      });

      const result = await aggregator.getLatestValue();
      if (!result) {
        throw new Error(`No price data available for ${symbol}`);
      }

      const price = result.toNumber();
      await this.cachePrice(symbol, price);

      return price;
    } catch (error) {
      this.logger.error('Failed to get price', {
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol,
      });
      throw error;
    }
  }

  private async getCachedPrice(symbol: string): Promise<number | null> {
    const cacheKey = `price:${symbol}`;
    const cachedPrice = await redisConfig.get(cacheKey);
    return cachedPrice ? parseFloat(cachedPrice) : null;
  }

  private async cachePrice(symbol: string, price: number): Promise<void> {
    const cacheKey = `price:${symbol}`;
    await redisConfig.setex(
      cacheKey,
      CONFIG.CACHE.PRICE_TTL,
      price.toString()
    );
  }

  async subscribeToPrice(symbol: string, callback: (price: number) => void): Promise<number> {
    try {
      const feedAddress = this.priceFeeds.get(symbol);
      if (!feedAddress) {
        throw new Error(`Price feed not found for symbol: ${symbol}`);
      }

      const aggregator = new AggregatorAccount({
        connection: this.connection,
        publicKey: feedAddress,
      });

      const subscriptionId = this.connection.onAccountChange(
        feedAddress,
        async () => {
          const price = await this.getPrice(symbol);
          callback(price);
        }
      );

      this.logger.info('Subscribed to price feed', {
        symbol,
        feedAddress: feedAddress.toString(),
      });

      return subscriptionId;
    } catch (error) {
      this.logger.error('Failed to subscribe to price feed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        symbol,
      });
      throw error;
    }
  }

  unsubscribeFromPrice(subscriptionId: number): void {
    try {
      this.connection.removeAccountChangeListener(subscriptionId);
      this.logger.info('Unsubscribed from price feed', {
        subscriptionId,
      });
    } catch (error) {
      this.logger.error('Failed to unsubscribe from price feed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subscriptionId,
      });
    }
  }
}
