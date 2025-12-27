/**
 * Configuration module for Scallop Liquidator
 */

import dotenv from 'dotenv';
import { Scallop } from '@scallop-io/sui-scallop-sdk';
import type { Config } from './types.js';

dotenv.config();

export function loadConfig(): Config {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required. Copy .env.example to .env and set your private key.');
  }

  return {
    privateKey,
    rpcUrl: process.env.RPC_URL,
    networkType: 'mainnet', // SDK only supports mainnet
  };
}

export async function createScallopSDK(config: Config): Promise<Scallop> {
  const scallop = new Scallop({
    networkType: config.networkType,
    secretKey: config.privateKey,
  });

  await scallop.init();

  return scallop;
}
