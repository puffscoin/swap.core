import { NATIVE, PUFFS_TOKENS } from './COINS'

export default [
  'PUFFS-BTC',
  'EOS-BTC',
  'LTC-BTC',
  'PUFFS-LTC',

  ...Object.values(PUFFS_TOKENS).map(token => `${token}-BTC`),
  ...Object.values(PUFFS_TOKENS).map(token => `${token}-USDT`),
]
