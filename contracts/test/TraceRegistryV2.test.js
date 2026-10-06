const { expect } = require('chai')
const { ethers } = require('hardhat')

const k = (s) => ethers.keccak256(ethers.toUtf8Bytes(s))
const ZERO = ethers.ZeroHash
const R = { VESSEL: 1, MARKET: 2, PROCESSOR: 4, RETAILER: 8 }
const K = { CATCH: 1, LANDING: 2, AUCTION: 3, RECEIVE: 4, SHIP: 5, PROCESS: 6, SELL: 7, STORAGE: 8, FIX: 9 }

describe('TraceRegistryV2', () => {
  async function setup() {
    const [owner, vessel, market, processor, retailer, stranger] = await ethers.getSigners()
    const reg = await ethers.deployContract('TraceRegistryV2')
    await reg.setRoles(vessel.address, R.VESSEL)
    await reg.setRoles(market.address, R.MARKET)
    await reg.setRoles(processor.address, R.PROCESSOR)
    await reg.setRoles(retailer.address, R.RETAILER)
    return { reg, owner, vessel, market, processor, retailer, stranger }
  }

  it('申告 → 水揚げ → せり → 受け取り → 加工 → 販売開始。それぞれの役割の鍵だけが書ける', async () => {
    const { reg, vessel, market, processor, retailer } = await setup()
    const decl = k('DCL-1'), fish = k('KSN-PBF-261006-001'), loin = k('KSN-PBF-261006-001-P01')
    await reg.connect(vessel).issue(decl, ZERO, K.CATCH, k('catch'))
    await reg.connect(market).issue(fish, decl, K.LANDING, k('landing'))
    await reg.connect(market).record(fish, K.AUCTION, k('auction'))
    await reg.connect(processor).record(fish, K.RECEIVE, k('receive'))
    await reg.connect(processor).issue(loin, fish, K.PROCESS, k('born'))
    await reg.connect(processor).record(loin, K.SHIP, k('ship'))
    await reg.connect(retailer).record(loin, K.RECEIVE, k('receive2'))
    await reg.connect(retailer).recordBatch([loin], K.SELL, [k('sell')])

    expect(await reg.parentOf(fish)).to.equal(decl)
    expect(await reg.parentOf(loin)).to.equal(fish)
    expect(await reg.latestHash(loin)).to.equal(k('sell'))
    expect(await reg.issuerOf(decl)).to.equal(vessel.address)
  })

  it('役割の違う鍵は断る', async () => {
    const { reg, vessel, market, processor, retailer, stranger } = await setup()
    const fish = k('F')
    await expect(reg.connect(market).issue(k('D'), ZERO, K.CATCH, k('x'))).to.be.revertedWith('role not allowed')      // 市場は申告できない
    await expect(reg.connect(vessel).issue(fish, ZERO, K.LANDING, k('x'))).to.be.revertedWith('role not allowed')     // 漁船は水揚げを発行できない
    await reg.connect(market).issue(fish, ZERO, K.LANDING, k('landing'))
    await expect(reg.connect(vessel).issue(k('P'), fish, K.PROCESS, k('x'))).to.be.revertedWith('role not allowed')   // 漁船は加工できない
    await expect(reg.connect(processor).record(fish, K.AUCTION, k('x'))).to.be.revertedWith('role not allowed')      // 加工場はせりを書けない
    await expect(reg.connect(processor).recordBatch([fish], K.SELL, [k('x')])).to.be.revertedWith('role not allowed') // 販売開始は小売だけ
    await expect(reg.connect(stranger).record(fish, K.FIX, k('x'))).to.be.revertedWith('role not allowed')           // 役割のない鍵
    await expect(reg.connect(retailer).record(k('none'), K.RECEIVE, k('x'))).to.be.revertedWith('unknown item')
    await expect(reg.connect(market).issue(fish, ZERO, K.LANDING, k('x'))).to.be.revertedWith('already issued')
  })

  it('加工ロット：入れた魚の一覧を残す。加工場の鍵だけ', async () => {
    const { reg, market, processor } = await setup()
    const a = k('A'), b = k('B'), lot = k('M001')
    await reg.connect(market).issue(a, ZERO, K.LANDING, k('a'))
    await reg.connect(market).issue(b, ZERO, K.LANDING, k('b'))
    await expect(reg.connect(market).issueMix(lot, [a, b], k('x'))).to.be.revertedWith('role not allowed')
    await expect(reg.connect(processor).issueMix(lot, [a, k('none')], k('x'))).to.be.revertedWith('unknown input')
    await reg.connect(processor).issueMix(lot, [a, b], k('mix'))
    expect(await reg.inputsOf(lot)).to.deep.equal([a, b])
    expect(await reg.latestHash(lot)).to.equal(k('mix'))
  })

  it('役割と許す範囲を変えられるのは運営だけ', async () => {
    const { reg, market } = await setup()
    await expect(reg.connect(market).setRoles(market.address, 31)).to.be.revertedWith('not owner')
    await expect(reg.connect(market).setAllowed(K.SELL, 2)).to.be.revertedWith('not owner')
  })
})
