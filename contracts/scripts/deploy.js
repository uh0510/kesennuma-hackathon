// デプロイ：npx hardhat run scripts/deploy.js --network amoy
// ISSUERS=0xaaa,0xbbb のように事業者のアドレスを渡すと、記録権限もまとめて付与する
const hre = require('hardhat')

async function main() {
  const reg = await hre.ethers.deployContract('TraceRegistry')
  await reg.waitForDeployment()
  const addr = await reg.getAddress()
  console.log('TraceRegistry:', addr)
  for (const a of (process.env.ISSUERS || '').split(',').filter(Boolean)) {
    await (await reg.setIssuer(a.trim(), true)).wait()
    console.log('issuer added:', a.trim())
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
