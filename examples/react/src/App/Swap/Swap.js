import React, { Component } from 'react'
import Swap from 'swap.swap'

import BtcToPuffs from './BtcToPuffs'
import PuffsToBtc from './PuffsToBtc'
import PuffsTokenToBtc from './PuffsTokenToBtc'
import BtcToPuffsToken from './BtcToPuffsToken'

import app from '../../swapApp'

const swapComponents = {
  'BTC2PUFFS': BtcToPuffs,
  'PUFFS2BTC': PuffsToBtc,
  'NOXON2BTC': PuffsTokenToBtc,
  'BTC2NOXON': BtcToPuffsToken,
  'FOO2BTC': PuffsTokenToBtc,
  'BTC2FOO': BtcToPuffsToken,
}

export default class SwapComponent extends Component {

  render() {
    const { orderId } = this.props

    if (!orderId) {
      return null
    }

    const swap = new Swap(orderId, app)
    const SwapComponent = swapComponents[swap.flow._flowName.toUpperCase()]

    return (
      <div style={{ paddingLeft: '30px', paddingBottom: '100px' }}>
        <SwapComponent swap={swap} />
      </div>
    )
  }
}
