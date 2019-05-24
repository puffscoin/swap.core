import Web3 from 'web3'
import { request } from '../util'


const web3 = new Web3(new Web3.providers.HttpProvider('https://rinkeby.infura.io/JCnK5ifEPH9qcQkX0Ahl'))

class Puffscoin {

  constructor() {
    this.core = web3
  }

  login(privateKey) {
    let account

    if (privateKey) {
      account = this.core.puffs.accounts.privateKeyToAccount(privateKey)
    }
    else {
      account = this.core.puffs.accounts.create()
      this.core.puffs.accounts.wallet.add(account)
    }

    this.core.puffs.accounts.wallet.add(account.privateKey)

    console.info('Logged in with PUFFScoin', account)

    return account
  }

  fetchBalance(address) {
    return this.core.puffs.getBalance(address)
      .then((wei) => {
        const balance = Number(this.core.utils.fromWei(wei))

        console.log('PUFFS balance:', balance)

        return balance
      })
  }

  fetchTokenBalance(tokenAddress, address) {
    return request.get(`https://rinkeby.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${tokenAddress}&address=${address}`)
      .then(({ result }) => result)
  }
}


export default new Puffscoin()

export {
  Puffscoin,
  web3,
}
