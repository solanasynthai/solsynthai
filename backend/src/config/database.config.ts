import { DataSourceOptions } from 'typeorm';
import { CONFIG } from '../config';

export const databaseConfig: DataSourceOptions = {
  type: 'postgres',
  host: CONFIG.DATABASE.HOST,
  port: CONFIG.DATABASE.PORT,
  username: CONFIG.DATABASE.USERNAME,
  password: CONFIG.DATABASE.PASSWORD,
  database: CONFIG.DATABASE.DATABASE,
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.NODE_ENV === 'development',
  entities: ['src/models/**/*.ts'],
  migrations: ['src/migrations/**/*.ts'],
  subscribers: ['src/subscribers/**/*.ts'],
  ssl: CONFIG.DATABASE.SSL ? {
    rejectUnauthorized: false
  } : false,
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  }
};
