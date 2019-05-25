import SwapApp, { SwapInterface } from 'swap.app'
import { mainnet } from 'simple/src/instances/ethereum'
import bitcoin from 'bitcoinjs-lib'
import { PuffsSwap } from 'swap.swaps'
import config from './config'

jest.mock('swap.app')

const log = console.log
const crypto = {
  ripemd160: secret => 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
}

const secret      = 'c0809ce9f484fdcdfb2d5aabd609768ce0374ee97a1a5618ce4cd3f16c00a078'
const secretHash  = 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
const lockTime    = 1521171580

const puffsSwap = new PuffsSwap({
  ...config.puffsSwap,
  fetchBalance: (address) => 10,
  estimateGasPrice: ({ speed } = {}) => mainnet().estimateGasPrice({ speed }),
})

xtest('puffsSwaps can estimate tx fee', async () => {
  const result = await puffsSwap.estimateGasPrice({ speed: 'normal '})
  const expected = 1e9

  expect(result).toBeGreaterThanOrEqual(expected)
})

test('puffsSwaps can fetch faked balance', async () => {
  const result = await puffsSwap.fetchBalance('0x60c205722c6c797c725a996cf9cca11291f90749')
  expect(result).not.toBeNull()
  expect(result).toEqual(10)
})
