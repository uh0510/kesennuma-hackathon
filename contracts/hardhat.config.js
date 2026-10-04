require('@nomicfoundation/hardhat-toolbox')
require('dotenv').config()

const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : []

module.exports = {
  solidity: '0.8.24',
  networks: {
    // テストネット。RPC と秘密鍵は .env に書く（Git に入れない）
    // プロトタイプは手数料が安く、無料配布で練習用の通貨を入手できた Base Sepolia を使う
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia-rpc.publicnode.com',
      chainId: 84532,
      accounts,
    },
    // Polygon のテストネット（最初の候補。手数料が高めで練習用の通貨が足りなかった）
    amoy: {
      url: process.env.AMOY_RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com',
      chainId: 80002,
      accounts,
    },
  },
}
