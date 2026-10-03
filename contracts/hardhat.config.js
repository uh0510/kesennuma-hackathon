require('@nomicfoundation/hardhat-toolbox')
require('dotenv').config()

module.exports = {
  solidity: '0.8.24',
  networks: {
    // Polygon のテストネット（Amoy）。RPC と秘密鍵は .env に書く（Git に入れない）
    amoy: {
      url: process.env.AMOY_RPC_URL || '',
      chainId: 80002,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
}
