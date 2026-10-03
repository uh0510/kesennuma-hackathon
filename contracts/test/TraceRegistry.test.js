const { expect } = require('chai')
const { ethers } = require('hardhat')

const k = (s) => ethers.keccak256(ethers.toUtf8Bytes(s))
const ZERO = ethers.ZeroHash

describe('TraceRegistry', () => {
  it('個体→加工品の発行と追記、親子関係の記録', async () => {
    const [owner, market, processor, stranger] = await ethers.getSigners()
    const reg = await ethers.deployContract('TraceRegistry')
    await reg.setIssuer(market.address, true)
    await reg.setIssuer(processor.address, true)

    const fish = k('KSN-SWO-261002-001'), loin = k('KSN-SWO-261002-001-P01')
    await reg.connect(market).issue(fish, ZERO, k('landing'))
    await reg.connect(market).record(fish, k('auction'))
    await reg.connect(processor).issue(loin, fish, k('born'))

    expect(await reg.parentOf(loin)).to.equal(fish)
    expect(await reg.issuerOf(loin)).to.equal(processor.address)
    expect(await reg.latestHash(fish)).to.equal(k('auction'))

    await expect(reg.connect(processor).issue(loin, fish, k('x'))).to.be.revertedWith('already issued')
    await expect(reg.connect(stranger).record(fish, k('x'))).to.be.revertedWith('not issuer')
    await expect(reg.connect(processor).issue(k('orphan'), k('none'), k('x'))).to.be.revertedWith('unknown parent')
  })
})
