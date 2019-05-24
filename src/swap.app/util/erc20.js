import constants from '../constants'
import { isCoinAddress, isPublicKey } from './typeforce'

const register = (code, precision) => {
  constants.COINS[code] = code.toUpperCase()
  constants.COINS_PRECISION[code.toUpperCase()] = precision
  isCoinAddress[code.toUpperCase()] = isCoinAddress.PUFFS
  isPublicKey[code.toUpperCase()] = isPublicKey.PUFFS
}

export default {
  register
}
