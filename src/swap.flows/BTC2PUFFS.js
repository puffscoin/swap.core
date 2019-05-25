import debug from 'debug'
import crypto from 'bitcoinjs-lib/src/crypto'
import SwapApp, { constants, util } from 'swap.app'
import { Flow } from 'swap.swap'
import { BigNumber } from 'bignumber.js'


class BTC2PUFFS extends Flow {

  static getName() {
    return `${this.getFromName()}2${this.getToName()}`
  }
  static getFromName() {
    return constants.COINS.btc
  }
  static getToName() {
    return constants.COINS.puffs
  }

  constructor(swap) {
    super(swap)

    this._flowName = BTC2PUFFS.getName()

    this.stepNumbers = {
      'sign': 1,
      'submit-secret': 2,
      'sync-balance': 3,
      'lock-btc': 4,
      'wait-lock-puffs': 5,
      'withdraw-puffs': 6,
      'finish': 7,
      'end': 8
    }

    this.puffsSwap = swap.ownerSwap
    this.btcSwap = swap.participantSwap

    if (!this.puffsSwap) {
      throw new Error('BTC2PUFFS: "puffsSwap" of type object required')
    }
    if (!this.btcSwap) {
      throw new Error('BTC2PUFFS: "btcSwap" of type object required')
    }

    this.state = {
      step: 0,

      isStoppedSwap: false,
      isEnoughMoney: false,

      signTransactionHash: null,
      isSignFetching: false,
      isParticipantSigned: false,

      btcScriptCreatingTransactionHash: null,
      puffsSwapCreationTransactionHash: null,

      secretHash: null,
      btcScriptValues: null,

      btcScriptVerified: false,

      isBalanceFetching: false,
      isBalanceEnough: false,
      balance: null,

      isPuffsContractFunded: false,

      puffsSwapWithdrawTransactionHash: null,
      canCreatePuffsTransaction: true,
      isPuffsWithdrawn: false,

      refundTransactionHash: null,
      isRefunded: false,
      withdrawFee: null,
      refundTxHex: null,
      isFinished: false,
      isSwapExist: false,
    }

    this.swap.room.once('swap was canceled for core', () => {
      console.error('Swap was stopped')
      this.setState({
        isStoppedSwap: true,
      })
    })

    super._persistSteps()
    this._persistState()
  }

  _persistState() {
    super._persistState()
  }

  _getSteps() {
    const flow = this

    return [

      // 1. Signs

      () => {
        flow.swap.room.once('swap sign', () => {
          flow.finishStep({
            isParticipantSigned: true,
          }, { step: 'sign', silentError: true })
        })

        flow.swap.room.once('swap exists', () => {
          flow.setState({
            isSwapExist: true,
          })
        })

        if (flow.state.isSwapExist) {
          flow.swap.room.once('refund completed', () => {
            flow.swap.room.sendMessage({
              event: 'request sign',
            })
          })
        } else {
          flow.swap.room.sendMessage({
            event: 'request sign',
          })
        }
      },
      // 2. Create secret, secret hash

      () => {
        // this.submitSecret()
      },

      // 3. Check balance

      () => {
        this.syncBalance()
      },

      // 4. Create BTC Script, fund, notify participant

      async () => {
        const { sellAmount } = flow.swap

        const onTransactionHash = (txID) => {
          if (flow.state.btcScriptCreatingTransactionHash) return

          flow.setState({
            btcScriptCreatingTransactionHash: txID,
          })

          flow.swap.room.on('request btc script', () => {
            flow.swap.room.sendMessage({
              event:  'create btc script',
              data: {
                scriptValues: flow.state.btcScriptValues,
                btcScriptCreatingTransactionHash: txID,
              }
            })
          })

          flow.swap.room.sendMessage({
            event: 'create btc script',
            data: {
              scriptValues : flow.state.btcScriptValues,
              btcScriptCreatingTransactionHash : txID,
            }
          })
        }

        // Balance on system wallet enough
        if (flow.state.isBalanceEnough) {
          await flow.btcSwap.fundScript({
            scriptValues: flow.state.btcScriptValues,
            amount: sellAmount,
          }, (hash) => {
            onTransactionHash(hash)

            flow.finishStep({
              isBtcScriptFunded: true,
            }, { step: 'lock-btc' })
          })
        } else {
          const { btcScriptValues: scriptValues } = flow.state

          const checkBTCScriptBalance = async () => {

            const { scriptAddress } = this.btcSwap.createScript(scriptValues)
            const unspents = await this.btcSwap.fetchUnspents(scriptAddress)

            if (unspents.length === 0) {
              return false
            }

            const txID = unspents[0].txid
            onTransactionHash(txID)

            const balance = await this.btcSwap.getBalance(scriptValues)

            flow.setState({
              scriptBalance: BigNumber(balance).div(1e8).dp(8),
            })

            const isEnoughMoney = BigNumber(balance).isGreaterThanOrEqualTo(sellAmount.times(1e8))

            this.setState({
              isEnoughMoney,
            })
          }


          await util.helpers.repeatAsyncUntilResult((stopRepeat) => {
            if (!this.state.isEnoughMoney && !this.state.isStoppedSwap) {
              checkBTCScriptBalance()
            } else {
              stopRepeat()
            }
          })
          if (!this.state.isStoppedSwap) {
            flow.finishStep({
              isBtcScriptFunded: true,
            }, { step: 'lock-btc' })
          }
        }
      },

      // 5. Wait participant creates PUFFScoin Contract

      () => {
        const { participant } = flow.swap
        let timer

        flow.swap.room.once('create PUFFScoin contract', ({ puffsSwapCreationTransactionHash }) => {
          flow.setState({
            ethSwapCreationTransactionHash,
          })
        })

        const checkPuffsBalance = () => {
          timer = setTimeout(async () => {
            const balance = await flow.puffsSwap.getBalance({
              ownerAddress: participant.puffs.address,
            })

            if (balance > 0) {
              if (!flow.state.isPuffsContractFunded) { // redundant condition but who cares :D
                flow.finishStep({
                  isEthContractFunded: true,
                }, { step: 'wait-lock-puffs' })
              }
            }
            else {
              checkPuffsBalance()
            }
          }, 5 * 1000)
        }

        checkEthBalance()

        flow.swap.room.once('create PUFFScoin contract', () => {
          if (!flow.state.isPuffsContractFunded) {
            clearTimeout(timer)
            timer = null

            flow.finishStep({
              isPuffsContractFunded: true,
            }, { step: 'wait-lock-puffs' })
          }
        })
      },

      // 6. Withdraw

      async () => {
        const { buyAmount, participant } = flow.swap
        const { secretHash, secret } = flow.state

        const data = {
          ownerAddress:   participant.puffs.address,
          secret,
        }

        const balanceCheckError = await flow.puffsSwap.checkBalance({
          ownerAddress: participant.puffs.address,
          participantAddress: this.app.services.auth.accounts.puffs.address,
          expectedValue: buyAmount,
          expectedHash: secretHash,
        })

        if (balanceCheckError) {
          console.error('Waiting until deposit: PUFFScoin balance check error:', balanceCheckError)
          flow.swap.events.dispatch('PUFFScoin balance check error', balanceCheckError)

          return
        }

        if (flow.puffsSwap.hasTargetWallet()) {
          const targetWallet = await flow.puffsSwap.getTargetWallet( participant.puffs.address )
          const needTargetWallet = (flow.swap.destinationBuyAddress)
            ? flow.swap.destinationBuyAddress
            : this.app.services.auth.accounts.puffs.address

          if (targetWallet !== needTargetWallet) {
            console.error(
              'Destination address for PUFFScoin does not match with necessary address. Stopping swap now!',
              needTargetWallet,
              targetWallet,
            )
            flow.swap.events.dispatch('address for PUFFScoin invalid', {
              needed: needTargetWallet,
              getted: targetWallet,
            })

            return
          }
        }

        const onWithdrawReady = () => {
          flow.swap.room.on('request puffsWithdrawTxHash', () => {
            // Spot where there was an a vulnerability
            flow.swap.room.sendMessage({
              event: 'puffsWithdrawTxHash',
              data: {
                puffsSwapWithdrawTransactionHash: flow.state.puffsSwapWithdrawTransactionHash,
              },
            })
          })

          flow.swap.room.sendMessage({
            event: 'finish PUFFScoin withdraw',
          })

          flow.finishStep({
            isPuffsWithdrawn,
          }, 'withdraw-puffs')
        }
        const tryWithdraw = async (stopRepeater) => {
          if (!flow.state.isPuffsWithdrawn) {
            try {
              const { withdrawFee } = flow.state

              if (!withdrawFee) {
                const withdrawNeededGas = await flow.puffsSwap.calcWithdrawGas({
                  ownerAddress: data.ownerAddress,
                  secret,
                })
                flow.setState({
                  withdrawFee: withdrawNeededGas,
                })
                debug('swap.core:flow')('withdraw gas fee', withdrawNeededGas)
              }

              await flow.puffsSwap.withdraw(data, (hash) => {
                flow.setState({
                  puffsSwapWithdrawTransactionHash: hash,
                  canCreatePuffsTransaction: true,
                })

                // Spot where there was an a vulnerability
                flow.swap.room.sendMessage({
                  event: 'puffsWithdrawTxHash',
                  data: {
                    puffsSwapWithdrawTransactionHash: hash,
                  }
                })
              })
            } catch (err) {
              if ( /known transaction/.test(err.message) ) {
                console.error(`known tx: ${err.message}`)
              } else if ( /out of gas/.test(err.message) ) {
                console.error(`tx failed (wrong secret?): ${err.message}`)
              } else if ( /insufficient funds for gas/.test(err.message) ) {
                console.error(`insufficient fund for gas: ${err.message}`)

                debug('swap.core:flow')('insufficient fund for gas... wait fund or request other side to withdraw')

                const { requireWithdrawFee } = this.state

                if (!requireWithdrawFee) {
                  flow.swap.room.once('withdraw ready', ({puffsSwapWithdrawTransactionHash}) => {
                    flow.setState({
                      puffsSwapWithdrawTransactionHash,
                    })

                    onWithdrawReady()
                  })

                  flow.setState({
                    requireWithdrawFee: true,
                    canCreatePuffsTransaction: true,
                  })
                  
                  stopRepeater()
                  return false
                }

              } else {
                console.error(err)
              }

              flow.setState({
                canCreatePuffsTransaction: false,
              })

              return null
            }
          }

          return true
        }

        const isPuffsWithdrawn = await util.helpers.repeatAsyncUntilResult((stopRepeater) =>
          tryWithdraw(stopRepeater),
        )

        if (isEthWithdrawn) {
          onWithdrawReady()
        }
      },

      // 7. Finish

      () => {
        flow.swap.room.once('swap finished', () => {
          flow.finishStep({
            isFinished: true,
          })
        })
      },

      // 8. Finished!
      () => {

      }
    ]
  }

  /**
   * TODO - backport version compatibility
   *  mapped to sendWithdrawRequestToAnotherParticipant
   *  remove at next iteration after client software update
   *  Used in swap.react
   */
  sendWithdrawRequest() {
    return this.sendWithdrawRequestToAnotherParticipant()
  }

  sendWithdrawRequestToAnotherParticipant() {
    const flow = this

    if (!this.state.requireWithdrawFee) return
    if (this.state.requireWithdrawFeeSended) return

    this.setState({
      requireWithdrawFeeSended: true,
    })

    this.swap.room.on('accept withdraw request', () => {
      flow.swap.room.sendMessage({
        event: 'do withdraw',
        data: {
          secret: flow.state.secret,
        }
      })
    })

    this.swap.room.sendMessage({
      event: 'request withdraw',
    })
  }

  submitSecret(secret) {
    if (this.state.secret) { return }

    if (!this.state.isParticipantSigned) {
      throw new Error(`Cannot proceed: participant not signed. step=${this.state.step}`)
    }

    const secretHash = crypto.ripemd160(Buffer.from(secret, 'hex')).toString('hex')

    /* Secret hash generated - create BTC script - and only after this notify other part */
    this.createWorkBTCScript(secretHash);

    const _secret = `0x${secret.replace(/^0x/, '')}`

    this.finishStep({
      secret: _secret,
      secretHash,
    }, { step: 'submit-secret' })
  }

  createWorkBTCScript(secretHash) {
    if (this.state.btcScriptValues) {
      debug('swap.core:flow')('BTC Script already generated', this.state.btcScriptValues)
      return
    }

    const { participant } = this.swap
    // TODO move this somewhere!
    const utcNow = () => Math.floor(Date.now() / 1000)
    const getLockTime = () => utcNow() + 3600 * 3 // 3 hours from now

    const scriptValues = {
      secretHash:         secretHash,
      ownerPublicKey:     this.app.services.auth.accounts.btc.getPublicKey(),
      recipientPublicKey: participant.btc.publicKey,
      lockTime:           getLockTime(),
    }
    const { scriptAddress } = this.btcSwap.createScript(scriptValues)

    this.setState({
      scriptAddress: scriptAddress,
      btcScriptValues: scriptValues,
      scriptBalance: 0,
      scriptUnspendBalance: 0
    })
  }

  async syncBalance() {
    const { sellAmount } = this.swap
    this.setState({
      isBalanceFetching: true,
    })

    const balance = await this.btcSwap.fetchBalance(this.app.services.auth.accounts.btc.getAddress())
    const isEnoughMoney = sellAmount.isLessThanOrEqualTo(balance)

    if (!isEnoughMoney) {
      console.error(`Not enough money: ${balance} < ${sellAmount}`)
    }
    this.finishStep({
      balance,
      isBalanceFetching: false,
      isBalanceEnough: isEnoughMoney,
    }, { step: 'sync-balance' })
  }

  stopSwapProcess() { 
    this.setState({
      isStoppedSwap: true,
    })
    this.sendMessageAboutClose()
  }

  getRefundTxHex = () => {
    this.btcSwap.getRefundHexTransaction({
      scriptValues: this.state.btcScriptValues,
      secret: this.state.secret,
    })
      .then((txHex) => {
        this.setState({
          refundTxHex: txHex,
        })
      })
  }

  tryRefund() {
    return this.btcSwap.refund({
      scriptValues: this.state.btcScriptValues,
      secret: this.state.secret,
    }, (hash) => {
      this.setState({
        refundTransactionHash: hash,
        isRefunded: true,
      })
    })
      .then(() => {
        this.setState({
          isSwapExist: false,
        })
      })
  }

  async tryWithdraw(_secret) {
    const { secret, secretHash, isPuffsWithdrawn, isBtcWithdrawn } = this.state

    if (!_secret)
      throw new Error(`Withdrawal is automatic. For manual withdrawal, provide a secret`)

    if (secret && secret != _secret)
      console.warn(`The secret key you have provided does not match what the contract requires. Are you certain you got that correct?`)

    if (isPuffsWithdrawn)
      console.warn(`Looks like the funds associated with this contract have been withdrawn already, are you sure?`)

    debug('swap.core:flow')(`WITHDRAW using secret = ${_secret}`)

    const _secretHash = crypto.ripemd160(Buffer.from(_secret, 'hex')).toString('hex')

    if (secretHash != _secretHash)
      console.warn(`Hash does not match! state: ${secretHash}, given: ${_secretHash}`)

    const { participant } = this.swap

    const data = {
      ownerAddress:   participant.puffs.address,
      secret:         _secret,
    }

    await this.puffsSwap.withdraw(data, (hash) => {
      debug('swap.core:flow')(`TX hash=${hash}`)
      this.setState({
        puffsSwapWithdrawTransactionHash: hash,
        canCreatePuffsTransaction: true,
      })
    }).then(() => {

      this.finishStep({
        isPuffsWithdrawn: true,
      }, 'withdraw-puffs')
    })
  }
}

export default BTC2PUFFS