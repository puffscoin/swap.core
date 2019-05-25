import SwapApp, { SwapInterface } from 'swap.app'
import { testnet } from 'simple/src/instances/bitcoin'
import bitcoin from 'bitcoinjs-lib'
import { BtcSwap } from 'swap.swaps'

jest.mock('swap.app')

const log = console.log
const crypto = {
  ripemd160: secret => 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
}

const txInfo = {
  '1e6d673ace76b3da288653683980dec137b05299ba90894f4c2744d9783872b4': {
    confidence: 0.1,
    fees: 546,
  },
  '00c93a627b21efec52653249a79e41a5d082586e87184eec5073ec084ec5323a': {
    confidence: 0.999,
    fees: 3000,
  },
  'd98b57b3266c19dec66ded0a5d661b93584466e7c84db3d50ed5505f6eb60667': {
    fees: 50000,
    size: 223,
  },
}

const secret      = 'c0809ce9f484fdcdfb2d5aabd609768ce0374ee97a1a5618ce4cd3f16c00a078'
const secretHash  = 'c0933f9be51a284acb6b1a6617a48d795bdeaa80'
const lockTime    = 1521171580

const btcOwner = {
  privateKey: 'cRkKzpir8GneA48iQVjSpUGT5mopFRTGDES7Kb43JduzrbhuVncn',
  publicKey: '02b65eed68f383178ee4bf301d1a2d231194eba2a65969187d49a6cdd945ea4f9d',
}
const puffsOwner = {
  privateKey: 'cT5n9yx1xw3TcbvpEAuXvzhrTb5du4RAYbAbTqHfZ9nbq6gJQMGn',
  publicKey: '02dfae561eb061072da126f1aed7d47202a36b762e89e913c400cdb682360d9620',
}

const getData = ({ publicKey }) => {
  const publicKeyBuffer = Buffer.from(publicKey, 'hex')

  return {
    address: bitcoin.ECPair.fromPublicKeyBuffer(publicKeyBuffer).getAddress(),
    publicKey,
  }
}

const btcOwnerData = getData(btcOwner)
const puffsOwnerData = getData(puffsOwner)

const btcSwap = new BtcSwap({
  fetchBalance: (address) => 10,
  fetchUnspents: (address) => [],
  broadcastTx: (rawTx) => {},
  estimateFeeValue: ({ inSatoshis, speed, address, txSize } = {}) => testnet().estimateFeeValue({ inSatoshis, speed, address, txSize }),
  fetchTxInfo: async txid => txInfo[txid],
})

test('check secretHash generated by ripemd160', () => {
  const result = crypto.ripemd160(secret)
  const expected = secretHash

  expect(result).toBe(expected)
})

test('btcSwap can estimate tx fee', async () => {
  const result = await btcSwap.getTxFee({ inSatoshis: true })
  const expected = 546

  expect(result > 0).toBeTruthy()
  expect(result.toNumber()).toBeGreaterThanOrEqual(expected)
})

test('btcSwap can estimate confidence factor', async () => {
  const result = await btcSwap.fetchTxInfo('00c93a627b21efec52653249a79e41a5d082586e87184eec5073ec084ec5323a')
  expect(result).not.toBeNull()

  const { confidence } = result
  expect(confidence).toBeGreaterThan(0.99)
})

test('btcSwap can estimate confident balance on script by fee ', async () => {
  const result = await btcSwap.filterConfidentUnspents([
    {
      txid: '1e6d673ace76b3da288653683980dec137b05299ba90894f4c2744d9783872b4',
      confirmations: 0,
    },
    {
      txid: 'd98b57b3266c19dec66ded0a5d661b93584466e7c84db3d50ed5505f6eb60667',
      confirmations: 0,
    },
  ])

  const expected = [
    {
      txid: 'd98b57b3266c19dec66ded0a5d661b93584466e7c84db3d50ed5505f6eb60667',
      confirmations: 0,
    }
  ]

  expect(result).toEqual(expected)
})

test('btcSwap can estimate confident balance on script', async () => {

  const result = await btcSwap.filterConfidentUnspents([
    {
      txid: '1e6d673ace76b3da288653683980dec137b05299ba90894f4c2744d9783872b4',
      confirmations: 0,
    },
    {
      txid: '00c93a627b21efec52653249a79e41a5d082586e87184eec5073ec084ec5323a',
      confirmations: 0,
    },
  ])

  expect(result).not.toBeNull()

  const expected = [
    {
      txid: '00c93a627b21efec52653249a79e41a5d082586e87184eec5073ec084ec5323a',
      confirmations: 0,
    }
  ]

  expect(result).toEqual(expected)
})




//
// test('create + fund + withdraw', async (t) => {
//   const { script, lockTime } = btcSwap.createScript({
//     secretHash,
//     btcOwnerPublicKey: btcOwner.publicKey,
//     puffsOwnerPublicKey: puffsOwner.publicKey,
//   })
//
//   log('\nCreate complete')
//   log({ script, lockTime })
//
//   const fundResult = await btcSwap.fundScript({ btcData: btcOwnerData, script, lockTime, amount: 0.001 })
//
//   log('\nFund complete')
//   log(fundResult)
//
//   const withdrawResult = await btcSwap.withdraw({ btcData: puffsOwnerData, script, secret })
//
//   log('\nWithdraw complete')
//   log(withdrawResult)
// })
