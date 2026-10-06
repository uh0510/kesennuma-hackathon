// TraceRegistryV2 の配備：npm run deploy-v2:base-sepolia（中身は npx hardhat run scripts/deploy-v2.js --network baseSepolia）
// ROLES=0xaaa:2,0xbbb:4 のように「アドレス:役割」を渡すと、役割を付け、手数料の分の通貨も送る
//   役割のビット：漁船 1・市場 2・加工 4・小売 8・輸出 16（足すと複数）
// FUND_EACH（既定 0.0002）＝1つの鍵に送る量
// REGISTRY_ADDRESS を渡すと、配備済みのコントラクトを使って続き（役割・送金）だけを行う
const hre = require('hardhat')

async function main() {
  const [signer] = await hre.ethers.getSigners()
  // 通し番号（nonce）はこちらで数える（公開 RPC が直前の取引を知らないことがあるため）
  const deployer = new hre.ethers.NonceManager(signer)
  const provider = hre.ethers.provider
  const net = await provider.getNetwork()
  console.log('network:', hre.network.name, `(chainId ${net.chainId})`)
  console.log('deployer:', signer.address, hre.ethers.formatEther(await provider.getBalance(signer.address)))

  let reg
  if (process.env.REGISTRY_ADDRESS) {
    reg = await hre.ethers.getContractAt('TraceRegistryV2', process.env.REGISTRY_ADDRESS, deployer)
  } else {
    reg = await hre.ethers.deployContract('TraceRegistryV2', deployer)
    await reg.waitForDeployment()
  }
  console.log('TraceRegistryV2:', await reg.getAddress())

  const fund = hre.ethers.parseEther(process.env.FUND_EACH || '0.0002')
  for (const pair of (process.env.ROLES || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [a, r] = pair.split(':')
    const roles = Number(r)
    if (Number(await reg.rolesOf(a)) !== roles) await (await reg.setRoles(a, roles)).wait()
    if ((await provider.getBalance(a)) < fund) await (await deployer.sendTransaction({ to: a, value: fund })).wait()
    console.log('roles:', a, Number(await reg.rolesOf(a)), 'balance', hre.ethers.formatEther(await provider.getBalance(a)))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
