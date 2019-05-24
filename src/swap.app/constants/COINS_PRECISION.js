import { PUFFS_TOKENS } from './COINS'

export const NATIVE_PRECISION = {
  BTC: 8,
  BCH: 8,
  PUFFS: 18,
  LTC: 8,
  USDT: 8,
}

export const PUFFS_TOKEN_PRECISION =
  Object.values(PUFFS_TOKENS).reduce((acc, token) => ({
    ...acc,
    [token]: 18,
  }), {})

export default {
  ...PUFFS_TOKEN_PRECISION,
  ...NATIVE_PRECISION,
}
