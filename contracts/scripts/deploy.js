// デプロイ：npm run deploy:base-sepolia（中身は npx hardhat run scripts/deploy.js --network baseSepolia）
// ISSUERS=0xaaa,0xbbb のように事業者のアドレスを渡すと、記録の権限を付け、手数料の分の通貨も送る
// FUND_EACH（既定 0.0002）＝事業者1つに送る量。Base Sepolia なら記録 約500件分
// REGISTRY_ADDRESS を渡すと、配備済みのコントラクトを使って続き（権限・送金）だけを行う
const hre = require('hardhat')

async function main() {
  const [signer] = await hre.ethers.getSigners()
  // 公開 RPC は複数のサーバーに振り分けられ、直前の取引の通し番号（nonce）を知らないことがある。
  // 通し番号はこちらで数える
  const deployer = new hre.ethers.NonceManager(signer)
  const provider = hre.ethers.provider
  const net = await provider.getNetwork()
  console.log('network:', hre.network.name, `(chainId ${net.chainId})`)
  console.log('deployer:', signer.address, hre.ethers.formatEther(await provider.getBalance(signer.address)))

  let reg
  if (process.env.REGISTRY_ADDRESS) {
    reg = await hre.ethers.getContractAt('TraceRegistry', process.env.REGISTRY_ADDRESS, deployer)
  } else {
    reg = await hre.ethers.deployContract('TraceRegistry', deployer)
    await reg.waitForDeployment()
  }
  console.log('TraceRegistry:', await reg.getAddress())

  const fund = hre.ethers.parseEther(process.env.FUND_EACH || '0.0002')
  for (const a of (process.env.ISSUERS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(await reg.isIssuer(a))) await (await reg.setIssuer(a, true)).wait()
    if ((await provider.getBalance(a)) < fund) await (await deployer.sendTransaction({ to: a, value: fund })).wait()
    console.log('issuer:', a, 'isIssuer', await reg.isIssuer(a), 'balance', hre.ethers.formatEther(await provider.getBalance(a)))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
